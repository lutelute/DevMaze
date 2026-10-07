/**
 * 蛇行レイアウト。
 *
 * 一直線の履歴を一直線に描くと、画面の縦がまるごと余り、横に細長い帯にしかならない。
 * 時間軸を一定幅で折り返して蛇行させると、画面を使い切れて、道として読める（= 迷路）。
 *
 * 位置決めは決定的。目標座標（x = 時刻の蛇行位置、y = レーンの線）に対して時刻順に置き、
 * 既に置いた円と重なるなら y を目標に近い側から空く場所へずらす（ビースウォーム）。
 * 力学シミュレーションは使わない。同じ入力なら同じ出力になり、テストで固定できる。
 *
 * ここは純粋関数。DOM・d3・React に依存しない。
 */
import type { StruggleEpisode } from '../types'
import type {
  BandSegment, GapMark, LayoutOptions, MazeItem, MazeLayout, Placed, RowGeometry,
} from './types'
import { buildTimeAxis, COMMIT_AXIS, SESSION_AXIS, type TimeAxis } from './axis'
import { nodeRadius, type Unit } from './items'

// 行頭の日付・フェーズ名は行の外側に出る（実測 89px）。ここを見込まずに全体表示を
// 計算すると、横は詰まりすぎ・縦は余りすぎになる。画面の縁との余白は上下左右そろえる。
export const FIT_SIDE = 96
export const FIT_PAD = 40

/** 全体表示のときの倍率の上下限（描画側で使う） */
export const FIT_MIN_K = 0.12
export const FIT_MAX_K = 1.2

/** 円と円のあいだに最低限あける距離 */
export const PADDING = 3.5

/** 行の上下の余白。廊下の縁と、空白の日数ラベルのぶん */
const ROW_PAD = 26

/** 行の最小幅。これより短く折り返すと行数ばかり増えて縦に伸びる */
const MIN_ROW_W = 560

const DEFAULT_MAX_ROWS = 16

/** 全体表示の縮尺。折り返し方の探索と実際の fit で同じ式を使う */
export function fitScaleFor(width: number, height: number, viewportW: number, viewportH: number): number {
  return Math.min(
    (viewportW - FIT_PAD * 2) / (width + FIT_SIDE * 2),
    (viewportH - FIT_PAD * 2) / height,
  )
}

/** 全体を画面に収める変換。倍率は FIT_MIN_K〜FIT_MAX_K に収める */
export function fitTransform(
  layout: Pick<MazeLayout, 'width' | 'height'>, viewportW: number, viewportH: number,
): { k: number; x: number; y: number } {
  const k = Math.max(FIT_MIN_K, Math.min(FIT_MAX_K, fitScaleFor(layout.width, layout.height, viewportW, viewportH)))
  return {
    k,
    x: viewportW / 2 - k * (layout.width / 2),
    y: viewportH / 2 - k * (layout.height / 2),
  }
}

/**
 * 使われているレーンだけを 0 を中心に詰め直し、外側は畳む。
 *
 * 元のレーン番号のまま高さを取ると、枝が9本あるだけで1行が470pxになり、
 * 全体表示が 19% まで縮んで何も読めなくなる（実測）。
 * 枝の本数を正確に見せる場ではないので、外側は寄せてしまってよい。
 */
export function compactLanes(lanes: number[], maxDepth: number): Map<number, number> {
  const used = [...new Set(lanes)]
  const below = used.filter(l => l < 0).sort((a, b) => b - a)   // -1, -2, ...
  const above = used.filter(l => l > 0).sort((a, b) => a - b)   //  1,  2, ...
  const map = new Map<number, number>([[0, 0]])
  below.forEach((l, i) => map.set(l, -Math.min(maxDepth, i + 1)))
  above.forEach((l, i) => map.set(l, Math.min(maxDepth, i + 1)))
  return map
}

export interface LayoutInput {
  items: MazeItem[]
  struggles?: StruggleEpisode[]
  unit: Unit
}

interface Circle { x: number; dy: number; r: number }

const EPS = 1e-9

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
/** 接する位置に置くと距離が丸めで足りなくなるので、ほんの少し外に置く */
const MARGIN = 1e-6

/**
 * 禁止区間（既に置いた円と重なる dy の範囲）を避けて、目標にいちばん近い dy を返す。
 * 同じ距離なら下（+）を取る。
 */
function freeDy(target: number, forbidden: [number, number][]): number {
  if (forbidden.length === 0) return target
  const inside = (y: number) => {
    for (const [lo, hi] of forbidden) if (y > lo + EPS && y < hi - EPS) return true
    return false
  }
  if (!inside(target)) return target

  let best = target
  let bestD = Infinity
  for (const [lo, hi] of forbidden) {
    const down = hi + MARGIN
    const up = lo - MARGIN
    for (const c of [down, up]) {
      if (inside(c)) continue
      const d = Math.abs(c - target)
      if (d < bestD - EPS) { bestD = d; best = c }
    }
  }
  return best
}

/** 時刻順（同時刻は ID 順） */
function sortItems(items: MazeItem[]): MazeItem[] {
  return [...items].sort((a, b) =>
    a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

interface Trial {
  rowW: number
  rowsUsed: number
  /** item index → 行 */
  row: number[]
  /** item index → 行内の x */
  x: number[]
  /** item index → レーン0の線からの縦のずれ */
  dy: number[]
  /** 行ごとの上側・下側の広がり */
  up: number[]
  down: number[]
  heights: number[]
  mids: number[]
  totalH: number
}

/**
 * 行数 r で実際に置いてみる。
 * 行の高さは「実際に置いた円の広がり」から決める。上下別々に測るのは、
 * 枝が片側にしか出ていない行で反対側にも同じだけ確保すると空間を二重に捨てるため
 * （実測: 確保178px に対して点は118px、空きは全部上側に寄っていた）。
 */
function placeWithRows(
  r: number,
  ax: number[], radius: number[], laneDy: number[],
  axisTotal: number, laneGap: number, maxR: number,
): Trial {
  const rowW = Math.max(MIN_ROW_W, axisTotal / r)
  const n = ax.length
  const row = new Array<number>(n)
  const x = new Array<number>(n)
  const dy = new Array<number>(n)
  const placed: Circle[][] = Array.from({ length: r }, () => [])
  let rowsUsed = 1

  for (let i = 0; i < n; i++) {
    const ri = Math.min(r - 1, Math.floor(ax[i] / rowW))
    const off = clamp(ax[i] - ri * rowW, 0, rowW)
    // 偶数行は左→右、奇数行は右→左（牛耕式）。行の変わり目が短い縦移動で済む
    const xi = ri % 2 === 0 ? off : rowW - off
    const rad = radius[i]
    const list = placed[ri]

    // 行内で x は時刻に対して単調なので、新しいほうから遡って届かなくなったら打ち切れる
    const reach = rad + maxR + PADDING
    const forbidden: [number, number][] = []
    for (let j = list.length - 1; j >= 0; j--) {
      const c = list[j]
      const dx = Math.abs(c.x - xi)
      if (dx >= reach) break
      const need = c.r + rad + PADDING
      if (dx >= need) continue
      const h = Math.sqrt(need * need - dx * dx)
      forbidden.push([c.dy - h, c.dy + h])
    }

    const d = freeDy(laneDy[i], forbidden)
    list.push({ x: xi, dy: d, r: rad })
    row[i] = ri
    x[i] = xi
    dy[i] = d
    if (ri + 1 > rowsUsed) rowsUsed = ri + 1
  }

  const up = new Array<number>(rowsUsed).fill(laneGap / 2)
  const down = new Array<number>(rowsUsed).fill(laneGap / 2)
  for (let i = 0; i < n; i++) {
    const ri = row[i]
    up[ri] = Math.max(up[ri], radius[i] - dy[i])
    down[ri] = Math.max(down[ri], dy[i] + radius[i])
  }
  const heights = up.map((u, i) => u + down[i] + ROW_PAD * 2)
  const mids = up.map(u => ROW_PAD + u)
  const totalH = heights.reduce((a, b) => a + b, 0)

  return { rowW, rowsUsed, row, x, dy, up, down, heights, mids, totalH }
}

function emptyLayout(unit: Unit, axis: TimeAxis): MazeLayout {
  return {
    unit, width: 1, height: 1, rowW: 1, laneGap: 1,
    rows: [], placed: [], byId: new Map(), gaps: [], bands: [],
    pos: () => ({ x: 0, y: 0, row: 0 }),
    fitScale: () => 1,
    axis,
    laneOf: () => 0,
  }
}

export function buildMazeLayout(input: LayoutInput, opts: LayoutOptions): MazeLayout {
  const aggregated = input.unit === 'session'
  const laneGap = aggregated ? 40 : 46
  const maxRows = Math.max(1, opts.maxRows ?? DEFAULT_MAX_ROWS)

  const items = sortItems(input.items)
  const axis = buildTimeAxis(items.map(it => it.timestamp), aggregated ? SESSION_AXIS : COMMIT_AXIS)
  if (items.length === 0) return emptyLayout(input.unit, axis)

  // 俯瞰では枝を ±1 に畳む（道として読ませたい）。コミット表示は ±3 まで残す
  const laneIndex = compactLanes(items.map(it => it.lane), aggregated ? 1 : 3)
  const laneOf = (lane: number) => laneIndex.get(lane) ?? 0

  // 行数に依らない量は一度だけ計算して使い回す
  const ax = items.map(it => axis.pos(it.timestamp))
  const radius = items.map(nodeRadius)
  const laneDy = items.map(it => laneOf(it.lane) * laneGap)
  const maxR = Math.max(...radius)

  // 行の長さを画面幅に固定すると、行数が増えて縦に長くなり、
  // 全体表示のときに縮尺が縦で頭打ちになる（実測: 9行で48%）。
  // 行数を変えながら「いちばん大きく映せる分け方」を選ぶ。横長の行も許す。
  let best: Trial | null = null
  let bestScale = -Infinity
  for (let r = 1; r <= maxRows; r++) {
    const t = placeWithRows(r, ax, radius, laneDy, axis.total, laneGap, maxR)
    const scale = fitScaleFor(t.rowW, t.totalH, opts.viewportW, opts.viewportH)
    if (scale > bestScale + EPS) { bestScale = scale; best = t }
    // 行数を増やしても使われる行が増えないなら、以降は同じ結果になる
    if (t.rowsUsed < r) break
  }
  const trial = best!

  const tops: number[] = []
  let acc = 0
  for (const h of trial.heights) { tops.push(acc); acc += h }
  const height = acc
  const rowW = trial.rowW
  const rowsUsed = trial.rowsUsed
  const clampRow = (row: number) => Math.max(0, Math.min(rowsUsed - 1, row))

  const rows: RowGeometry[] = []
  for (let i = 0; i < rowsUsed; i++) {
    rows.push({
      index: i,
      top: tops[i],
      height: trial.heights[i],
      mid: tops[i] + trial.mids[i],   // 絶対座標（描画側は row.mid をそのまま y に使う）
      leftToRight: i % 2 === 0,
      startTime: axis.time(i * rowW),
      endTime: axis.time(Math.min((i + 1) * rowW, axis.total)),
    })
  }

  const placed: Placed[] = items.map((it, i) => {
    const ri = trial.row[i]
    return { id: it.id, x: trial.x[i], y: tops[ri] + trial.mids[ri] + trial.dy[i], r: radius[i], row: ri }
  })
  const byId = new Map(placed.map(p => [p.id, p]))

  /** 軸上の位置 → 行と行内の x */
  const place = (a: number) => {
    const row = clampRow(Math.floor(a / rowW))
    const off = clamp(a - row * rowW, 0, rowW)
    return { row, x: row % 2 === 0 ? off : rowW - off }
  }

  const pos: MazeLayout['pos'] = (t, lane = 0) => {
    const { row, x } = place(axis.pos(t))
    return { x, y: tops[row] + trial.mids[row] + laneOf(lane) * laneGap, row }
  }

  const gaps: GapMark[] = axis.gaps.map(g => {
    const { row, x } = place(g.at)
    return { x, row, days: g.days }
  })

  // 沼を行ごとの区間に切る。表示範囲と重ならないエピソードは描かない。
  // axis.pos は範囲外を端に丸めるので、そのまま描くと端に偽の帯が生える
  const bands: BandSegment[] = []
  const t0 = axis.times[0]
  const t1 = axis.times[axis.times.length - 1]
  for (const e of input.struggles ?? []) {
    if (e.endTimestamp < t0 || e.startTimestamp > t1) continue
    const ax0 = axis.pos(Math.max(e.startTimestamp, t0))
    const ax1 = Math.max(ax0 + 6, axis.pos(Math.min(e.endTimestamp, t1)))
    const r0 = clampRow(Math.floor(ax0 / rowW))
    const r1 = Math.max(r0, clampRow(Math.floor((ax1 - EPS) / rowW)))
    for (let r = r0; r <= r1; r++) {
      const segA = clamp(Math.max(ax0, r * rowW) - r * rowW, 0, rowW)
      const segB = clamp(Math.min(ax1, (r + 1) * rowW) - r * rowW, 0, rowW)
      // 奇数行は右→左に進むので、行内の位置を反転する
      const x0 = r % 2 === 0 ? segA : rowW - segB
      const x1 = r % 2 === 0 ? segB : rowW - segA
      bands.push({ struggleId: e.id, row: r, x0, x1, isHead: r === r0, isTail: r === r1 })
    }
  }

  return {
    unit: input.unit,
    width: rowW,
    height,
    rowW,
    laneGap,
    rows,
    placed,
    byId,
    gaps,
    bands,
    pos,
    fitScale: (vw, vh) => fitScaleFor(rowW, height, vw, vh),
    axis,
    laneOf,
  }
}
