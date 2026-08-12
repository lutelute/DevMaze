import {
  useEffect, useRef, useCallback, useMemo, useState, forwardRef, useImperativeHandle,
} from 'react'
import * as d3 from 'd3'
import type {
  MazeGraph, MazeNode, MazeEdge, CommitType, Zone, StruggleEpisode,
} from '../../shared/types'
import { buildSessions, shouldAggregate } from '../../shared/analyzer/session'
import { COMMIT_TYPE, severityColor, STRUGGLE_META } from '../../shared/theme'

interface Props {
  graph: MazeGraph
  filterTypes: Set<string>
  onNodeClick: (node: MazeNode) => void
  selectedNodeId?: string
  /** 沼エピソードに属するコミット。指定すると他のノードを沈める */
  highlightIds?: Set<string>
  /** 何らかの沼に属するコミット全体。常時マーカーを出す */
  struggleIds?: Set<string>
  /** コミットごとの沼の深刻度（0-100）。印の強さに使う */
  struggleSeverity?: Map<string, number>
  /** 沼エピソード。廊下に「ぬかるみ」の帯として敷く */
  struggles?: StruggleEpisode[]
  /** まとまりを開いたとき（そのまとまりに属するコミットを強調させる） */
  onDrillDown?: (hashes: string[]) => void
  /** 表示単位を手で切り替えたときに、注目を解除する */
  onClearFocus?: () => void
  /** 表示単位。戻る操作で巻き戻せるよう App が持つ */
  unitOverride?: 'commit' | 'session' | null
  onUnitChange?: (unit: 'commit' | 'session') => void
}

/** 戻る操作のために、カメラ（拡大位置）を外から読み書きする口 */
export interface MazeGraphHandle {
  getCamera: () => { x: number; y: number; k: number } | null
  /** 次に描き直すとき、全体表示ではなくこの位置を復元する */
  queueCamera: (c: { x: number; y: number; k: number } | null) => void
}

// まとまり表示のときは、複数コミットを1つのノードとして扱う（count > 1）
type Aggregatable = MazeNode & { count?: number; memberHashes?: string[] }
type D3Node = Aggregatable & d3.SimulationNodeDatum
type D3Link = { id: string; source: D3Node; target: D3Node; type: MazeEdge['type'] }

// 色は shared/theme.ts が唯一の出どころ（5箇所に写して食い違わせないため）
const TYPE_COLOR = Object.fromEntries(
  Object.entries(COMMIT_TYPE).map(([k, v]) => [k, v.hex]),
) as Record<CommitType, string>

const EDGE_COLOR: Record<MazeEdge['type'], string> = {
  parent:       '#5A3D1E',
  merge_parent: '#C8A060',
  revert_of:    '#C88B3A',
}

const EDGE_DASH: Record<MazeEdge['type'], string> = {
  parent:       'none',
  merge_parent: '6,3',
  revert_of:    '3,4',
}

const DISPLAY_LIMITS = [80, 150, 300, 1000] as const

// 行頭の日付・フェーズ名は行の外側に出る（実測 89px）。ここを見込まずに全体表示を
// 計算すると、横は詰まりすぎ・縦は余りすぎになる。画面の縁との余白は上下左右そろえる。
const FIT_SIDE = 96
const FIT_PAD = 40

/** 全体表示の縮尺。折り返し方の探索と実際の fit で同じ式を使う */
function fitScale(width: number, height: number, viewportW: number, viewportH: number): number {
  return Math.min(
    (viewportW - FIT_PAD * 2) / (width + FIT_SIDE * 2),
    (viewportH - FIT_PAD * 2) / height,
  )
}

const HOUR = 3600_000
const DAY = 24 * HOUR

// ── 時間軸 ─────────────────────────────────────────────────
//
// コミットを実時間で並べると、開発が集中した数日に全部が固まり、
// 残りが空白になる。そこでコミット間隔を対数で圧縮した「体感時間」の軸を作る。
// 密度が均されて読めるようになり、長い空白は縮んでも消えずに残る。
interface TimeTick { x: number; label: string; major: boolean }

interface TimeAxis {
  pos: (t: number) => number
  time: (x: number) => number
  total: number
  ticksIn: (t0: number, t1: number) => TimeTick[]
  gaps: { at: number; days: number }[]
}

// 1件ごとの前進はごく小さくして、時間が近いコミットは重なるようにする。
// 均等に並べると読めるが、のっぺりして「いつ集中していたか」が消える。
// 重ねておけば、衝突判定が塊（クラスタ）に押し広げてくれる。
const STEP_PX = 3         // コミット1件ぶんの基本間隔（ほぼ0にして重なりを許す）
const GAP_K = 24          // 空白時間の効き
const GAP_MAX = 200       // 1つの空白が占められる最大幅

interface AxisOptions { step: number; gapK: number; gapMax: number }

// まとまり表示では、1つ1つが大きい塊なので重ねる意味がない。
// 素直に等間隔で並べ、空白の効きも抑える（そうしないと縦に伸びて全体が読めない）
const COMMIT_AXIS: AxisOptions  = { step: STEP_PX, gapK: GAP_K, gapMax: GAP_MAX }
const SESSION_AXIS: AxisOptions = { step: 62, gapK: 8, gapMax: 60 }

function buildTimeAxis(timestamps: number[], opts: AxisOptions = COMMIT_AXIS): TimeAxis {
  const ts = [...new Set(timestamps)].sort((a, b) => a - b)
  if (ts.length === 0) {
    return { pos: () => 0, time: () => 0, total: 1, ticksIn: () => [], gaps: [] }
  }

  const xs: number[] = [0]
  const gaps: TimeAxis['gaps'] = []

  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1]
    const extra = Math.min(opts.gapMax, opts.gapK * Math.log1p(gap / HOUR))
    const x = xs[i - 1] + opts.step + extra
    xs.push(x)
    if (gap >= 3 * DAY) gaps.push({ at: (xs[i - 1] + x) / 2, days: Math.round(gap / DAY) })
  }

  const total = xs[xs.length - 1] || 1

  const interp = (v: number, from: number[], to: number[]): number => {
    if (v <= from[0]) return to[0]
    if (v >= from[from.length - 1]) return to[to.length - 1]
    let lo = 0, hi = from.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (from[mid] <= v) lo = mid
      else hi = mid
    }
    const span = from[hi] - from[lo] || 1
    return to[lo] + ((v - from[lo]) / span) * (to[hi] - to[lo])
  }

  const ticksIn: TimeAxis['ticksIn'] = (t0, t1) => {
    const spanDays = Math.max(0, t1 - t0) / DAY
    const unit: 'hour' | 'day' | 'week' | 'month' | 'year' =
      spanDays > 1100 ? 'year' :
      spanDays > 200  ? 'month' :
      spanDays > 30   ? 'week' :
      spanDays > 2    ? 'day' : 'hour'

    const out: TimeTick[] = []
    let prevKey = ''
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] < t0 || ts[i] > t1) continue
      const d = new Date(ts[i])
      const key =
        unit === 'year'  ? `${d.getFullYear()}` :
        unit === 'month' ? `${d.getFullYear()}-${d.getMonth()}` :
        unit === 'week'  ? `${d.getFullYear()}-${weekOf(d)}` :
        unit === 'day'   ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` :
                           `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
      if (key === prevKey) continue
      prevKey = key
      out.push({
        x: xs[i],
        label:
          unit === 'year'  ? `${d.getFullYear()}` :
          unit === 'month' ? `${d.getFullYear()}/${d.getMonth() + 1}` :
          unit === 'hour'  ? `${d.getHours()}:00` :
                             `${d.getMonth() + 1}/${d.getDate()}`,
        major: unit === 'hour' ? d.getHours() === 0 : d.getDate() === 1,
      })
    }
    return out
  }

  return {
    pos: t => interp(t, ts, xs),
    time: x => interp(x, xs, ts),
    total,
    ticksIn,
    gaps,
  }
}

function weekOf(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.floor((d.getTime() - start.getTime()) / (7 * DAY))
}

// ── 蛇行レイアウト ─────────────────────────────────────────
//
// 一直線の履歴を一直線に描くと、画面の縦がまるごと余り、
// 横に細長い帯にしかならない。時間軸を一定幅で折り返して蛇行させると、
// 画面を使い切れて、道として読めるようになる（= 迷路）。
interface Layout {
  rowW: number
  /** 行ごとの高さ。枝の無い行は低い */
  rowH: (row: number) => number
  /** 行の上端。高さが行ごとに違うので累積和で持つ */
  rowTop: (row: number) => number
  /** その行のレーン0の線。枝が片側にしか出ていない行では行の中心とずれる */
  rowMid: (row: number) => number
  laneGap: number
  rows: number
  pos: (t: number, lane: number) => { x: number; y: number }
  rowOf: (t: number) => number
  rowStart: (row: number) => { x: number; y: number; time: number } | null
  width: number
  height: number
}

function buildLayout(
  axis: TimeAxis, items: { t: number; lane: number }[],
  viewportW: number, viewportH: number, aggregated = false,
): Layout {
  const laneGap = aggregated ? 40 : 46
  // コミット表示は塊が縦に膨らむので余白を厚く、まとまり表示は薄くて足りる
  const padV = aggregated ? 58 : 130

  // 行の高さを「全体の最大レーン」で左右対称に取ると、二重に空間を捨てる。
  // (1) 枝が1本も出ていない行にも枝ぶんを確保する
  // (2) 枝が片側にしか出ていなくても、反対側にも同じだけ確保する
  // 実測（897件・6行）: 確保178px に対して点は118pxぶんしかなく、
  // しかも空きは全部「上側」に寄っていた（上76px / 下0px）＝上のレーンが未使用。
  // 行ごと・上下別々に、実際に使っているレーンだけで高さを決める。
  const measure = (r: number) => {
    const rowW = Math.max(560, axis.total / r)
    const ups = new Array<number>(r).fill(0)     // lane < 0（上に出る枝）
    const downs = new Array<number>(r).fill(0)   // lane > 0（下に出る枝）
    for (const it of items) {
      const row = Math.min(r - 1, Math.floor(axis.pos(it.t) / rowW))
      if (it.lane < 0) ups[row] = Math.max(ups[row], -it.lane)
      else if (it.lane > 0) downs[row] = Math.max(downs[row], it.lane)
    }
    const heights = ups.map((u, i) => (u + downs[i] + 1) * laneGap + padV)
    // その行の「レーン0の線」が行の上端から何pxの位置に来るか
    const mids = ups.map(u => padV / 2 + (u + 0.5) * laneGap)
    return { rowW, heights, mids, total: heights.reduce((a, b) => a + b, 0) }
  }

  // 行の長さを画面幅に固定すると、行数が増えて縦に長くなり、
  // 全体表示のときに縮尺が縦で頭打ちになる（実測: 9行で48%）。
  // 行数を変えながら「いちばん大きく映せる分け方」を選ぶ。横長の行も許す。
  let rows = 1
  let rowW = axis.total
  let heights: number[] = [padV + laneGap]
  let mids: number[] = [padV / 2 + laneGap / 2]
  let bestScale = -1
  for (let r = 1; r <= 16; r++) {
    const m = measure(r)
    const scale = fitScale(m.rowW, m.total, viewportW, viewportH)
    if (scale > bestScale) {
      bestScale = scale; rows = r; rowW = m.rowW; heights = m.heights; mids = m.mids
    }
  }

  const tops: number[] = []
  let acc = 0
  for (const h of heights) { tops.push(acc); acc += h }
  const height = acc

  const clamp = (row: number) => Math.max(0, Math.min(rows - 1, row))
  const rowH = (row: number) => heights[clamp(row)]
  const rowTop = (row: number) => tops[clamp(row)]
  /** その行のレーン0の線（行の中心ではない。枝が片側だけなら中心からずれる） */
  const rowMid = (row: number) => tops[clamp(row)] + mids[clamp(row)]

  const place = (ax: number) => {
    const row = Math.min(rows - 1, Math.floor(ax / rowW))
    const off = ax - row * rowW
    // 偶数行は左→右、奇数行は右→左（牛耕式）。行の変わり目が短い縦移動で済む
    return { row, x: row % 2 === 0 ? off : rowW - off }
  }

  return {
    rowW, rowH, rowTop, rowMid, laneGap, rows,
    width: rowW,
    height,
    pos: (t, lane) => {
      const { row, x } = place(axis.pos(t))
      return { x, y: rowMid(row) + lane * laneGap }
    },
    rowOf: t => place(axis.pos(t)).row,
    rowStart: row => {
      if (row < 0 || row >= rows) return null
      const ax = row * rowW
      return {
        x: row % 2 === 0 ? 0 : rowW,
        y: rowMid(row),
        time: axis.time(ax),
      }
    },
  }
}

/**
 * 使われているレーンだけを 0 を中心に詰め直し、外側は畳む。
 *
 * 元のレーン番号のまま高さを取ると、枝が9本あるだけで1行が470pxになり、
 * 全体表示が 19% まで縮んで何も読めなくなる（実測）。
 * 枝の本数を正確に見せる場ではないので、外側は寄せてしまってよい。
 */
function compactLanes(lanes: number[], maxDepth: number): Map<number, number> {
  const used = [...new Set(lanes)]
  const below = used.filter(l => l < 0).sort((a, b) => b - a)   // -1, -2, ...
  const above = used.filter(l => l > 0).sort((a, b) => a - b)   //  1,  2, ...
  const map = new Map<number, number>([[0, 0]])
  below.forEach((l, i) => map.set(l, -Math.min(maxDepth, i + 1)))
  above.forEach((l, i) => map.set(l, Math.min(maxDepth, i + 1)))
  return map
}

function nodeRadius(n: D3Node): number {
  // まとまりは件数で大きさを変える。どこに労力が寄っていたかが形で分かる
  if (n.count && n.count > 1) return Math.min(30, 9 + Math.sqrt(n.count) * 3.2)
  if (n.type === 'merge')   return 9
  if (n.type === 'release') return 10
  const base = n.isMainBranch ? 8 : 5.5
  return base + Math.min(4, Math.sqrt(n.filesChanged ?? 0))
}

function diamond(r: number): string {
  return `M0,${-r} L${r * 0.8},0 L0,${r} L${-r * 0.8},0 Z`
}

function hexagon(r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3 - Math.PI / 6
    return `${i === 0 ? 'M' : 'L'}${Math.cos(a) * r},${Math.sin(a) * r}`
  }).join(' ') + 'Z'
}

const ZONE_LABEL_COLOR = (theme: CommitType) => TYPE_COLOR[theme] ?? '#D4A84A'

// ── Component ──────────────────────────────────────────────
const MazeGraph = forwardRef<MazeGraphHandle, Props>(function MazeGraph({
  graph, filterTypes, onNodeClick, selectedNodeId, highlightIds, struggleIds, struggleSeverity,
  struggles,
  onDrillDown, onClearFocus, unitOverride = null, onUnitChange,
}: Props, ref) {
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const nodesRef = useRef<D3Node[]>([])
  const layoutRef = useRef<Layout | null>(null)
  const pendingCamera = useRef<{ x: number; y: number; k: number } | null>(null)
  // 前回どの「地図」を描いたか。同じ地図なら拡大位置を保つ（作り直すたびに
  // 全体表示へ戻していたので、沼を1件選んだだけで拡大が解除されていた）
  const genRef = useRef<string>('')
  const [displayLimit, setDisplayLimit] = useState<number>(150)
  const [zoomPct, setZoomPct] = useState(100)
  // キャンバスの大きさ。サイドバーを畳んだり詳細パネルを開いたりすると変わるので、
  // 変わったら折り返し方を選び直す（元は起動時に一度計算したきりだった）
  const [size, setSize] = useState({ w: 0, h: 0 })

  useImperativeHandle(ref, () => ({
    getCamera: () => {
      if (!svgRef.current) return null
      const t = d3.zoomTransform(svgRef.current)
      return { x: t.x, y: t.y, k: t.k }
    },
    queueCamera: c => { pendingCamera.current = c },
  }), [])

  // 大きさの変化を拾う。小さな揺れで作り直さないよう 24px の閾値を置く
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => {
      const r = el.getBoundingClientRect()
      setSize(prev =>
        Math.abs(prev.w - r.width) > 24 || Math.abs(prev.h - r.height) > 24
          ? { w: r.width, h: r.height } : prev)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { nodes, links, totalCount, unit, sessionCount } = useMemo(() => {
    const filtered = filterTypes.size === 0
      ? graph.nodes
      : graph.nodes.filter(n => filterTypes.has(n.type))

    const sessions = buildSessions(filtered)
    const unit: 'commit' | 'session' =
      unitOverride ?? (shouldAggregate(filtered.length) ? 'session' : 'commit')

    if (unit === 'session') {
      // まとまり表示では表示件数の上限をかけない。集約が volume を引き受ける
      const activeNodes: D3Node[] = sessions.map(ses => ({
        id: ses.id,
        label: `${ses.commitCount}`,
        type: ses.type,
        timestamp: ses.startTimestamp,
        filesChanged: ses.fileCount,
        insertions: ses.insertions,
        deletions: ses.deletions,
        authorName: '',
        message: ses.label,
        branchNames: [],
        tagNames: ses.tagNames,
        files: [],
        refs: [],
        isMainBranch: ses.isMainBranch,
        lane: ses.lane,
        isMilestone: ses.hasMilestone,
        milestoneReason: ses.tagNames.length > 0 ? 'tag' : undefined,
        count: ses.commitCount,
        memberHashes: ses.commitHashes,
      })) as D3Node[]

      // まとまり同士は時間順につなぐ（1本の道として読めるように）
      const activeLinks: D3Link[] = activeNodes.slice(1).map((n, i) => ({
        id: `ses_${i}`,
        source: activeNodes[i],
        target: n,
        type: 'parent' as const,
      }))

      return {
        nodes: activeNodes, links: activeLinks,
        totalCount: filtered.length, unit, sessionCount: sessions.length,
      }
    }

    const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp)
    const limited = sorted.slice(0, displayLimit)

    // 強調対象は表示件数の外にあっても必ず出す。
    // これが無いと、古いまとまり・沼・ファイルを開いたとき全部が沈んで
    // 何も見えない画面になる（実測: 150件表示で 150件すべてが沈んだ）。
    if (highlightIds && highlightIds.size > 0) {
      const shown = new Set(limited.map(n => n.id))
      for (const n of sorted) {
        if (highlightIds.has(n.id) && !shown.has(n.id)) limited.push(n)
      }
    }

    const activeNodes: D3Node[] = limited.map(n => ({ ...n })) as D3Node[]
    const byId = new Map(activeNodes.map(n => [n.id, n]))

    const activeLinks = graph.edges
      .map(e => {
        const sId = typeof e.source === 'string' ? e.source : (e.source as MazeNode).id
        const tId = typeof e.target === 'string' ? e.target : (e.target as MazeNode).id
        const source = byId.get(sId)
        const target = byId.get(tId)
        if (!source || !target) return null
        return { id: e.id, source, target, type: e.type }
      })
      .filter((l): l is D3Link => l !== null)

    return {
      nodes: activeNodes, links: activeLinks,
      totalCount: filtered.length, unit, sessionCount: sessions.length,
    }
  }, [graph, filterTypes, displayLimit, unitOverride, highlightIds])

  // 強調対象はコミットのハッシュで来る。まとまり表示では ID が別物なので、
  // メンバーを見て読み替える。読み替えないと、まとまりに戻った瞬間に
  // どれも一致せず、画面全部が沈む。
  const effectiveHighlight = useMemo(() => {
    if (!highlightIds || highlightIds.size === 0) return undefined
    if (unit === 'commit') return highlightIds
    const mapped = new Set<string>()
    for (const n of nodes) {
      if (n.memberHashes?.some(h => highlightIds.has(h))) mapped.add(n.id)
    }
    return mapped.size > 0 ? mapped : undefined
  }, [highlightIds, nodes, unit])

  // 沼マーカーも同じ読み替えが要る。struggleIds はコミットのハッシュで来るので、
  // まとまり表示（200件超は自動でこちら）では ID が session_N になって1件も一致せず、
  // **既定の画面から沼の印が丸ごと消える**（897件のリポジトリで実測: 0個）。
  // ただし「1件でも含む」で付けると、荒れたリポジトリでは 102 中 85 に付いて
  // ミニマップが真っ赤になり、印として何も言わなくなる（実測）。
  // そのまとまりの**過半**が沼のコミットのときだけ「ここで詰まっていた」と見なす。
  // 値は深刻度(0-100)。有無だけだと 66件に一様な印が付いて「どこで詰まったか」を指せない。
  const effectiveStruggle = useMemo(() => {
    if (!struggleIds || struggleIds.size === 0) return undefined
    const sev = (h: string) => struggleSeverity?.get(h) ?? 50
    const mapped = new Map<string, number>()
    if (unit === 'commit') {
      for (const n of nodes) if (struggleIds.has(n.id)) mapped.set(n.id, sev(n.id))
      return mapped
    }
    for (const n of nodes) {
      const members = n.memberHashes
      if (!members || members.length === 0) continue
      const hits = members.filter(h => struggleIds.has(h))
      // そのまとまりの過半が沼のコミットのときだけ「ここで詰まっていた」と見なす
      if (hits.length * 2 > members.length) {
        mapped.set(n.id, Math.max(...hits.map(sev)))
      }
    }
    return mapped
  }, [struggleIds, struggleSeverity, nodes, unit])

  const handleNodeClick = useCallback((node: D3Node) => {
    // まとまりをクリックしたら、その中のコミットに降りる（意味的なズーム）。
    // 表示単位の切替も App 側でまとめてやる（履歴に2件積まれないように）
    if (node.memberHashes && node.memberHashes.length > 0) {
      onDrillDown?.(node.memberHashes)
      return
    }
    onNodeClick(node as MazeNode)
  }, [onNodeClick, onDrillDown])

  const zoomBy = useCallback((factor: number) => {
    if (!svgRef.current || !zoomRef.current) return
    d3.select(svgRef.current).transition().duration(220)
      .call(zoomRef.current.scaleBy, factor)
  }, [])

  const handleFitView = useCallback(() => {
    if (!svgRef.current || !zoomRef.current || !layoutRef.current) return
    fitLayout(d3.select(svgRef.current), zoomRef.current, layoutRef.current,
      svgRef.current.clientWidth, svgRef.current.clientHeight)
  }, [])

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()

    const container = svgRef.current!
    const W = Math.round(size.w) || container.clientWidth || 900
    const H = Math.round(size.h) || container.clientHeight || 600
    if (nodes.length === 0) return

    const aggregated = unit === 'session'
    const axis = buildTimeAxis(nodes.map(n => n.timestamp), aggregated ? SESSION_AXIS : COMMIT_AXIS)

    // 俯瞰では枝を ±1 に畳む（道として読ませたい）。コミット表示は ±3 まで残す
    const laneIndex = compactLanes(nodes.map(n => n.lane), aggregated ? 1 : 3)
    const laneOf = (lane: number) => laneIndex.get(lane) ?? 0
    const layoutItems = nodes.map(n => ({ t: n.timestamp, lane: laneOf(n.lane) }))
    const layout = buildLayout(axis, layoutItems, W, H, aggregated)
    layoutRef.current = layout
    nodesRef.current = nodes

    // ── defs ──────────────────────────────────────────────
    const defs = svg.append('defs')
    const glow = defs.append('filter').attr('id', 'glow')
      .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%')
    glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur')
    const fm = glow.append('feMerge')
    fm.append('feMergeNode').attr('in', 'coloredBlur')
    fm.append('feMergeNode').attr('in', 'SourceGraphic')

    ;(['parent', 'merge_parent', 'revert_of'] as MazeEdge['type'][]).forEach(type => {
      defs.append('marker')
        .attr('id', `arr-${type}`)
        .attr('viewBox', '0 -4 8 8').attr('refX', 18).attr('refY', 0)
        .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', EDGE_COLOR[type])
        .attr('opacity', type === 'parent' ? 0.6 : 0.9)
    })

    svg.style('background', '#1A1107')
    const g = svg.append('g').attr('class', 'zoom-layer')

    let onZoom: (t: d3.ZoomTransform) => void = () => {}

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.12, 6])
      // ホイールは拡大縮小。ただし Shift 併用は横移動に回す（下の wheel.pan が拾う）
      .filter((event: MouseEvent | WheelEvent) =>
        !(event.type === 'wheel' && event.shiftKey) && !(event as MouseEvent).button)
      .on('zoom', event => {
        const t = event.transform as d3.ZoomTransform
        g.attr('transform', t.toString())
        const k = t.k
        const lOp = k > 0.42 ? Math.min(1, (k - 0.42) * 3) : 0
        g.selectAll<SVGTextElement, unknown>('text.commit-label').attr('opacity', lOp)
        g.selectAll<SVGTextElement, unknown>('.hash-label').attr('opacity', k > 0.9 ? Math.min(0.75, (k - 0.9) * 2) : 0)
        g.selectAll<SVGTextElement, unknown>('.milestone-label').attr('opacity', Math.min(1, k * 1.6))
        g.selectAll<SVGTextElement, unknown>('.lane-label').attr('opacity', Math.min(0.8, k))
        onZoom(t)
      })
    svg.call(zoom)
    zoomRef.current = zoom

    // Shift + ホイールで横移動。蛇行させたぶん横に長いので、行を横に追える必要がある
    svg.on('wheel.pan', (event: WheelEvent) => {
      if (!event.shiftKey) return
      event.preventDefault()
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const k = d3.zoomTransform(svg.node()!).k
      zoom.translateBy(svg, -delta / k, 0)
    })

    // ── 行（廊下）────────────────────────────────────────
    const corridors = g.append('g').attr('class', 'corridors')
    const zones: Zone[] = graph.zones ?? []

    for (let row = 0; row < layout.rows; row++) {
      const start = layout.rowStart(row)!
      const endTime = layout.rowStart(row + 1)?.time ?? axis.time(axis.total)
      const top = layout.rowTop(row)
      const h = layout.rowH(row)
      // その行の期間を支配する開発フェーズの色で廊下を染める
      const zone = zones.find(z => z.startTimestamp <= endTime && z.endTimestamp >= start.time)
      const tint = zone ? ZONE_LABEL_COLOR(zone.theme) : '#D4A84A'

      corridors.append('rect')
        .attr('x', -26)
        .attr('y', top + 14)
        .attr('width', layout.rowW + 52)
        .attr('height', h - 28)
        .attr('rx', 14)
        .attr('fill', tint)
        .attr('opacity', row % 2 === 0 ? 0.045 : 0.03)

      corridors.append('rect')
        .attr('x', -26)
        .attr('y', top + 14)
        .attr('width', layout.rowW + 52)
        .attr('height', h - 28)
        .attr('rx', 14)
        .attr('fill', 'none')
        .attr('stroke', tint)
        .attr('stroke-width', 1)
        .attr('opacity', 0.10)

      // 行の始まりに日付。折り返した先が「いつ」なのかが分からないと道を追えない
      const d = new Date(start.time)
      const leftToRight = row % 2 === 0
      corridors.append('text')
        .attr('x', leftToRight ? -30 : layout.rowW + 30)
        .attr('y', layout.rowMid(row) - 4)
        .attr('text-anchor', leftToRight ? 'end' : 'start')
        .attr('fill', tint)
        .attr('font-size', 11)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '600')
        .attr('opacity', 0.75)
        .text(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`)

      corridors.append('text')
        .attr('x', leftToRight ? -30 : layout.rowW + 30)
        .attr('y', layout.rowMid(row) + 10)
        .attr('text-anchor', leftToRight ? 'end' : 'start')
        // 元は text-dim(2.37) に opacity 0.5 を重ねて実効 1.46 だった。
        // 暗いテーマでは重ね掛けをやめて色を直接置くほうが読める
        .attr('fill', 'var(--text-dim)')
        .attr('font-size', 9)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(zone ? zone.label : leftToRight ? '→' : '←')
    }

    // ── 沼を「廊下のぬかるみ」として敷く ────────────────────
    //
    // 元は該当コミットに同じ赤い破線の輪を1つずつ付けるだけだった。
    // 12件の沼は同じ輪が12個並ぶだけで、「1つのエピソード」という単位が画面に無く、
    // 深刻度・抜けたかどうか・再発も全部そこで潰れていた。
    // エピソードを1つの帯として描き、変数ごとに別のチャネルに載せる。
    if (struggles && struggles.length > 0) {
      const bands = g.append('g').attr('class', 'struggle-bands')
      const t0 = axis.time(0)
      const t1 = axis.time(axis.total)
      const bandH = layout.laneGap * 0.9

      for (const e of struggles) {
        // 表示範囲と重ならないエピソードは描かない。
        // axis.pos は範囲外を端に丸めるので、そのまま描くと端に偽の帯が生える
        if (e.endTimestamp < t0 || e.startTimestamp > t1) continue

        const ax0 = axis.pos(Math.max(e.startTimestamp, t0))
        const ax1 = Math.max(ax0 + 6, axis.pos(Math.min(e.endTimestamp, t1)))
        const color = severityColor(e.severity)
        const r0 = Math.min(layout.rows - 1, Math.floor(ax0 / layout.rowW))
        const r1 = Math.min(layout.rows - 1, Math.floor(ax1 / layout.rowW))

        for (let r = r0; r <= r1; r++) {
          const segA = Math.max(ax0, r * layout.rowW) - r * layout.rowW
          const segB = Math.min(ax1, (r + 1) * layout.rowW) - r * layout.rowW
          // 奇数行は右→左に進むので、行内の位置を反転する
          const xa = r % 2 === 0 ? segA : layout.rowW - segB
          const xb = r % 2 === 0 ? segB : layout.rowW - segA
          const y = layout.rowMid(r) - bandH / 2

          // 箱で囲むと、30件が重なって赤い壁になり道が見えなくなる（実測）。
          // ノードの下に敷く「ぬかるんだ地面」にする。縁取りはせず、
          // 下端の線の太さだけに深刻度を載せる
          bands.append('rect')
            .attr('x', xa).attr('y', y)
            .attr('width', Math.max(6, xb - xa)).attr('height', bandH)
            .attr('rx', 6)
            .attr('fill', color).attr('opacity', 0.05)
            .attr('pointer-events', 'none')

          bands.append('line')
            .attr('x1', xa).attr('y1', y + bandH)
            .attr('x2', Math.max(xa + 6, xb)).attr('y2', y + bandH)
            .attr('stroke', color)
            .attr('stroke-width', 1 + e.severity / 70)
            .attr('stroke-linecap', 'round')
            .attr('opacity', 0.45)
            .attr('pointer-events', 'none')

          // 終端の形が「抜けたかどうか」。閉じている＝門をくぐった、
          // 開いている＝まだ抜けていない。凡例なしで読める唯一の符号化
          if (r === r1) {
            const endX = r % 2 === 0 ? xb : xa
            if (e.escape) {
              bands.append('line')
                .attr('x1', endX).attr('y1', y + 3)
                .attr('x2', endX).attr('y2', y + bandH - 3)
                .attr('stroke', color).attr('stroke-width', 2.5)
                .attr('opacity', 0.75).attr('pointer-events', 'none')
            }
          }

          // 頭に種別の記号。再発しているなら「2/3」を添える
          if (r === r0) {
            const headX = r % 2 === 0 ? xa : xb
            const meta = STRUGGLE_META[e.kind]
            bands.append('text')
              .attr('class', 'lane-label')
              .attr('x', headX).attr('y', y - 3)
              .attr('text-anchor', r % 2 === 0 ? 'start' : 'end')
              .attr('fill', color).attr('font-size', 10)
              .attr('font-family', 'JetBrains Mono, monospace')
              .attr('opacity', 0).attr('pointer-events', 'none')
              .text(e.recurrence
                ? `${meta.icon} ${e.recurrence.index}/${e.recurrence.times}`
                : meta.icon)
          }
        }
      }
    }

    // ── 止まっていた時間 ───────────────────────────────────
    const gapsG = g.append('g').attr('class', 'gaps')
    for (const gap of axis.gaps) {
      const row = Math.min(layout.rows - 1, Math.floor(gap.at / layout.rowW))
      const off = gap.at - row * layout.rowW
      const x = row % 2 === 0 ? off : layout.rowW - off
      const rh = layout.rowH(row)
      const top = layout.rowTop(row)
      const y = layout.rowMid(row)

      gapsG.append('line')
        .attr('x1', x).attr('y1', top + 18)
        .attr('x2', x).attr('y2', top + rh - 18)
        .attr('stroke', '#6B5537')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,4')
        .attr('opacity', 0.5)
      gapsG.append('text')
        .attr('class', 'lane-label')
        .attr('x', x).attr('y', top + 14)
        .attr('text-anchor', 'middle')
        .attr('fill', '#8B7355')
        .attr('font-size', 9)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('opacity', 0)
        .text(`⏸ ${gap.days}日`)
    }

    // ── Edges ─────────────────────────────────────────────
    const linkGroup = g.append('g').attr('class', 'links')
    const linkElems = linkGroup.selectAll<SVGLineElement, D3Link>('line')
      .data(links).join('line')
      .attr('stroke', d => EDGE_COLOR[d.type])
      .attr('stroke-width', d => {
        if (d.type === 'merge_parent') return 2.2
        if (d.type === 'revert_of')   return 1.8
        return d.source.isMainBranch && d.target.isMainBranch ? 2.4 : 1.3
      })
      .attr('stroke-dasharray', d => EDGE_DASH[d.type])
      .attr('opacity', d => d.type === 'parent' ? 0.55 : 0.85)
      .attr('marker-end', d => `url(#arr-${d.type})`)

    // ── Nodes ─────────────────────────────────────────────
    const nodeGroup = g.append('g').attr('class', 'nodes')
    const nodeElems = nodeGroup.selectAll<SVGGElement, D3Node>('g.node')
      .data(nodes, d => d.id).join('g')
      .attr('class', 'node').style('cursor', 'pointer')

    nodeElems.append('circle')
      .attr('class', 'glow')
      .attr('r', d => nodeRadius(d) + 6)
      .attr('fill', d => TYPE_COLOR[d.type])
      .attr('opacity', 0)

    nodeElems.each(function(d) {
      const sel = d3.select(this)
      const c   = TYPE_COLOR[d.type]
      const r   = nodeRadius(d)

      if (d.type === 'merge') {
        sel.append('path').attr('class', 'main-circle').attr('d', diamond(r))
          .attr('fill', `${c}33`).attr('stroke', c).attr('stroke-width', 2)
      } else if (d.type === 'release') {
        sel.append('path').attr('class', 'main-circle').attr('d', hexagon(r))
          .attr('fill', `${c}40`).attr('stroke', c).attr('stroke-width', 2.5)
          .attr('filter', 'url(#glow)')
      } else {
        sel.append('circle').attr('class', 'main-circle').attr('r', r)
          .attr('fill', d.isMainBranch ? `${c}55` : `${c}2A`)
          .attr('stroke', c)
          .attr('stroke-width', d.isMainBranch ? 2.4 : 1.5)
          .attr('filter', d.isMainBranch ? 'url(#glow)' : 'none')
      }
    })

    // まとまりの件数（大きさだけでは何件か分からない）
    nodeElems.filter(d => (d.count ?? 1) > 1)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 3.5)
      .attr('fill', '#1A1107')
      .attr('font-size', d => Math.min(13, 8 + Math.sqrt(d.count ?? 1)))
      .attr('font-weight', '700')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')
      .text(d => String(d.count))

    // 沼マーカー。帯を出しているときは重ねない（同じことを二重に言わない）。
    // 帯が無いとき（沼データが渡っていないとき）だけ、輪で最低限を示す。
    if (effectiveStruggle && effectiveStruggle.size > 0 && !(struggles && struggles.length > 0)) {
      nodeElems.filter(d => effectiveStruggle.has(d.id))
        .append('circle')
        .attr('class', 'struggle-ring')
        .attr('r', d => nodeRadius(d) + 4)
        .attr('fill', 'none')
        // 上限は控えめに。荒れたリポジトリでは深刻度100が大半で、
        // 目一杯まで振ると 66件すべてが最大の太さになって画面が赤く沈む（実測）
        .attr('stroke', d => severityColor(effectiveStruggle.get(d.id) ?? 50))
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', d =>
          (effectiveStruggle.get(d.id) ?? 50) >= 75 ? '4,2.5' : '2,2.5')
        .attr('opacity', 0.4)
        .attr('pointer-events', 'none')
    }

    // マイルストーン（タグ・バージョンのみ。大規模変更まで出すとラベルが潰れる）
    nodeElems.filter(d => d.isMilestone && d.milestoneReason !== 'large_change')
      .each(function(d) {
        const label = d.tagNames[0] ?? d.message.match(/v\d+[\d.]+/)?.[0] ?? d.label
        const sel = d3.select(this)
        sel.append('rect')
          .attr('class', 'milestone-label')
          .attr('x', -label.length * 3.2 - 5).attr('y', -nodeRadius(d) - 26)
          .attr('width', label.length * 6.4 + 10).attr('height', 15)
          .attr('rx', 4).attr('fill', '#3D2810').attr('opacity', 0.9)
        sel.append('text')
          .attr('class', 'milestone-label')
          .attr('y', -nodeRadius(d) - 15)
          .attr('text-anchor', 'middle')
          .attr('fill', '#E8C060')
          .attr('font-size', 9.5)
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('font-weight', '600')
          .text(label)
      })

    if (aggregated) {
      nodeElems.filter(d => d.tagNames.length === 0)
        .append('text')
        .attr('class', 'commit-label')
        .attr('dy', d => nodeRadius(d) + 13)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--text-dim)')
        .attr('font-size', 8.5)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('pointer-events', 'none')
        .attr('opacity', 0)
        .text(d => {
          const dt = new Date(d.timestamp)
          return `${dt.getMonth() + 1}/${dt.getDate()}`
        })
    }

    nodeElems.filter(d => d.milestoneReason === 'large_change')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => -nodeRadius(d) - 5)
      .attr('font-size', 9)
      .attr('pointer-events', 'none')
      .attr('fill', '#C0624B')
      .attr('opacity', 0.9)
      .text('⚡')

    nodeElems.append('text')
      .attr('class', 'hash-label')
      .attr('dy', d => nodeRadius(d) + 11)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8B7355')
      .attr('font-size', 8)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .text(d => d.label)

    nodeElems
      // まとまり表示では上のタグ札と同じ内容になるので出さない（二重に見える）
      .filter(d => !aggregated &&
        (d.type === 'merge' || d.type === 'release' || d.tagNames.length > 0))
      .append('text')
      .attr('class', 'commit-label')
      .attr('dy', d => nodeRadius(d) + 22)
      .attr('text-anchor', 'middle')
      .attr('fill', d => TYPE_COLOR[d.type])
      .attr('font-size', 8.5)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .text(d => {
        const msg = d.message.split('\n')[0]
        return msg.length > 26 ? msg.slice(0, 24) + '…' : msg
      })

    // ── Events ────────────────────────────────────────────
    nodeElems
      .on('mouseenter', function(event, d) {
        d3.select(this).select('.glow').attr('opacity', 0.28)
        showTooltip(event, d)
      })
      .on('mousemove', event => moveTooltip(event))
      .on('mouseleave', function(_, d) {
        d3.select(this).select('.glow').attr('opacity', d.id === selectedNodeId ? 0.3 : 0)
        hideTooltip()
      })
      .on('click', (_, d) => handleNodeClick(d))

    // ── 位置決め ──────────────────────────────────────────
    // 蛇行の座標を目標に、重なりだけを力学で逃がす。
    // 力任せの配置にすると、時間も行も読めない塊になる。
    const sim = d3.forceSimulation<D3Node>(nodes)
      // x は「その時刻の位置」に引く。時間が近いコミットは同じ場所に引かれ、
      // 反発と衝突がそれを塊に押し広げる —— 集中して書いた時期が塊として見える
      .force('x', d3.forceX<D3Node>(d => layout.pos(d.timestamp, laneOf(d.lane)).x)
        .strength(aggregated ? 0.9 : 0.6))
      // y のしばりは弱くする。強く縛ると1本の線に戻り、
      // 集中して書いた時期が「線の上の密な部分」にしか見えなくなる
      .force('y', d3.forceY<D3Node>(d => layout.pos(d.timestamp, laneOf(d.lane)).y)
        .strength(d => d.isMainBranch ? 0.3 : 0.2))
      .force('charge', d3.forceManyBody<D3Node>()
        .strength(aggregated ? -40 : -120).distanceMax(220))
      .force('link', d3.forceLink<D3Node, D3Link>(links).id(d => d.id)
        .distance(26).strength(0.25))
      .force('collision', d3.forceCollide<D3Node>(d => nodeRadius(d) + 3.5).strength(0.95))
      .velocityDecay(0.45)
      .alphaDecay(0.035)

    const applyPositions = () => {
      linkElems
        .attr('x1', d => d.source.x ?? 0).attr('y1', d => d.source.y ?? 0)
        .attr('x2', d => d.target.x ?? 0).attr('y2', d => d.target.y ?? 0)
      nodeElems.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    }
    sim.on('tick', applyPositions)

    const drag = d3.drag<SVGGElement, D3Node>()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag',  (ev, d) => { d.fx = ev.x; d.fy = ev.y })
      .on('end',   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
    nodeElems.call(drag)

    // ── ミニマップ ────────────────────────────────────────
    const MM_W = 148, MM_H = 106, MM_PAD = 7
    const mmScale = Math.min(
      (MM_W - MM_PAD * 2) / Math.max(1, layout.width),
      (MM_H - MM_PAD * 2) / Math.max(1, layout.height),
    )
    const mm = svg.append('g')
      .attr('class', 'minimap')
      .attr('transform', `translate(${W - MM_W - 16},${H - MM_H - 52})`)
      .style('cursor', 'pointer')

    mm.append('rect')
      .attr('width', MM_W).attr('height', MM_H).attr('rx', 8)
      .attr('fill', 'rgba(12,8,3,0.9)')
      .attr('stroke', '#3A2A15').attr('stroke-width', 1)

    // 枠からはみ出さないように切り抜く
    defs.append('clipPath').attr('id', 'minimap-clip')
      .append('rect')
      .attr('x', 1).attr('y', 1).attr('width', MM_W - 2).attr('height', MM_H - 2).attr('rx', 7)
    mm.attr('clip-path', 'url(#minimap-clip)')

    const mmInner = mm.append('g').attr('transform', `translate(${MM_PAD},${MM_PAD}) scale(${mmScale})`)
    mmInner.selectAll('circle')
      .data(nodes).join('circle')
      .attr('cx', d => layout.pos(d.timestamp, laneOf(d.lane)).x)
      .attr('cy', d => layout.pos(d.timestamp, laneOf(d.lane)).y)
      .attr('r', Math.max(2.5, 3 / mmScale))
      .attr('fill', d => effectiveStruggle?.has(d.id)
        ? severityColor(effectiveStruggle.get(d.id)!) : TYPE_COLOR[d.type])
      .attr('opacity', 0.75)

    const mmView = mm.append('rect')
      .attr('fill', 'rgba(212,168,74,0.12)')
      .attr('stroke', '#D4A84A').attr('stroke-width', 1).attr('rx', 2)
      .attr('pointer-events', 'none')

    // ミニマップのクリックでその位置へ飛ぶ
    mm.on('click', event => {
      const [mx, my] = d3.pointer(event, mm.node())
      const gx = (mx - MM_PAD) / mmScale
      const gy = (my - MM_PAD) / mmScale
      const k = d3.zoomTransform(svg.node()!).k
      svg.transition().duration(320).call(
        zoom.transform,
        d3.zoomIdentity.translate(W / 2 - k * gx, H / 2 - k * gy).scale(k),
      )
    })

    // 全体が収まっているあいだ、ミニマップは何も足さない上に最終行の点に重なる。
    // 拡大して画面から溢れたときだけ出す。
    const fitK = Math.max(0.12, Math.min(1.2, fitScale(layout.width, layout.height, W, H)))

    onZoom = (t: d3.ZoomTransform) => {
      setZoomPct(Math.round(t.k * 100))
      mm.attr('opacity', t.k > fitK * 1.12 ? 1 : 0)
        .attr('pointer-events', t.k > fitK * 1.12 ? 'auto' : 'none')
      // 画面がレイアウトより広いときは矩形が枠を食い破るので、枠内に収める
      const x0 = MM_PAD + t.invertX(0) * mmScale
      const y0 = MM_PAD + t.invertY(0) * mmScale
      const x1 = MM_PAD + t.invertX(W) * mmScale
      const y1 = MM_PAD + t.invertY(H) * mmScale
      const cx0 = Math.max(MM_PAD, Math.min(MM_W - MM_PAD, x0))
      const cy0 = Math.max(MM_PAD, Math.min(MM_H - MM_PAD, y0))
      const cx1 = Math.max(MM_PAD, Math.min(MM_W - MM_PAD, x1))
      const cy1 = Math.max(MM_PAD, Math.min(MM_H - MM_PAD, y1))
      mmView
        .attr('x', cx0).attr('y', cy0)
        .attr('width', Math.max(3, cx1 - cx0))
        .attr('height', Math.max(3, cy1 - cy0))
    }

    // ── 初期表示 ──────────────────────────────────────────
    // 目標位置が決まっているので、落ち着くまで先に回してから止める。
    // 回し続けると 900 件では毎フレーム再描画になって操作が重くなる。
    sim.tick(nodes.length > 400 ? 160 : 110)
    applyPositions()
    sim.stop()

    // 「地図」が同じなら、拡大位置はユーザーのもの。勝手に全体表示へ戻さない。
    // 沼やファイルを選ぶと nodes は作り直されるが、地図の形は変わっていない。
    // 形が変わるのは 表示単位・表示件数・絞り込み・画面サイズ・リポジトリ が変わったときだけ。
    const gen = [
      unit, displayLimit, [...filterTypes].sort().join(','), W, H,
      graph.nodes.length, graph.nodes[0]?.id ?? '',
    ].join('|')
    const sameMap = gen === genRef.current
    genRef.current = gen

    const restore = pendingCamera.current
    pendingCamera.current = null
    const kept = d3.zoomTransform(svg.node()!)   // __zoom はノードに残るので前回の位置が取れる

    if (restore) {
      // 戻る操作で「さっき見ていた場所」が指定されている
      svg.transition().duration(320).call(
        zoom.transform, d3.zoomIdentity.translate(restore.x, restore.y).scale(restore.k))
    } else if (sameMap && kept.k !== 1) {
      g.attr('transform', kept.toString())
      onZoom(kept)
    } else {
      fitLayout(svg, zoom, layout, W, H)
    }

    if (selectedNodeId || effectiveHighlight) {
      applyHighlight(nodeElems, selectedNodeId, effectiveHighlight)
    }

    return () => { sim.stop() }
  }, [nodes, links, handleNodeClick, effectiveStruggle, struggles, unit, size.w, size.h])

  useEffect(() => {
    if (!svgRef.current) return
    const nodeElems = d3.select(svgRef.current).selectAll<SVGGElement, D3Node>('g.node')
    applyHighlight(nodeElems, selectedNodeId, effectiveHighlight)
  }, [selectedNodeId, effectiveHighlight])

  // 選択されたコミットが画面外なら、そこまで運ぶ（沼や検索から飛んだとき用）
  useEffect(() => {
    if (!selectedNodeId || !svgRef.current || !zoomRef.current) return
    const node = nodesRef.current.find(n => n.id === selectedNodeId)
    if (!node || node.x === undefined || node.y === undefined) return

    const svg = d3.select(svgRef.current)
    const W = svgRef.current.clientWidth
    const H = svgRef.current.clientHeight
    const t = d3.zoomTransform(svgRef.current)
    const sx = t.applyX(node.x), sy = t.applyY(node.y)
    const margin = 80
    if (sx > margin && sx < W - margin && sy > margin && sy < H - margin) return

    // 倍率は動かさない。運ぶのは位置だけ。
    // 元は Math.max(t.k, 0.6) で勝手に拡大していて、「見ていた縮尺」が失われていた
    const k = t.k
    svg.transition().duration(420).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(W / 2 - k * node.x, H / 2 - k * node.y).scale(k),
    )
  }, [selectedNodeId])

  return (
    <div ref={wrapRef}
      style={{ position: 'relative', width: '100%', height: '100%', background: '#1A1107' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block', background: '#1A1107' }} />

      {/* 凡例 */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        display: 'flex', flexDirection: 'column', gap: 4,
        background: 'rgba(26,17,7,0.88)', backdropFilter: 'blur(8px)',
        border: '1px solid var(--border)', borderRadius: 8,
        padding: '8px 12px', fontSize: 10,
      }}>
        <div style={{ color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.8px', marginBottom: 2 }}>凡例</div>
        {([
          { label: 'Main',      color: TYPE_COLOR.normal,    shape: 'circle',  main: true },
          { label: 'Feature',   color: TYPE_COLOR.feature,   shape: 'circle',  main: false },
          { label: 'Bugfix',    color: TYPE_COLOR.error_fix, shape: 'circle',  main: false },
          { label: 'Merge',     color: TYPE_COLOR.merge,     shape: 'diamond', main: false },
          { label: 'Release',   color: TYPE_COLOR.release,   shape: 'hex',     main: false },
          { label: '沼',        color: '#C0624B',            shape: 'ring',    main: false },
        ]).map(({ label, color, shape, main }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="-7 -7 14 14">
              {shape === 'diamond' ? (
                <path d={diamond(5)} fill={`${color}30`} stroke={color} strokeWidth="1.5"/>
              ) : shape === 'hex' ? (
                <path d={hexagon(5)} fill={`${color}30`} stroke={color} strokeWidth="1.5"/>
              ) : shape === 'ring' ? (
                <circle r={5} fill="none" stroke={color} strokeWidth="1.3" strokeDasharray="2,2"/>
              ) : (
                <circle r={main ? 5 : 4} fill={`${color}33`} stroke={color} strokeWidth={main ? 2 : 1.5}/>
              )}
            </svg>
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ズーム操作 */}
      <div style={{
        position: 'absolute', left: 14, bottom: 14,
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'rgba(26,17,7,0.88)', backdropFilter: 'blur(8px)',
        border: '1px solid var(--border)', borderRadius: 8, padding: '4px 6px',
      }}>
        <ZoomBtn onClick={() => zoomBy(1 / 1.4)} title="縮小">−</ZoomBtn>
        <span style={{
          minWidth: 42, textAlign: 'center', fontSize: 10.5,
          color: 'var(--text-secondary)', fontFamily: 'monospace',
        }}>
          {zoomPct}%
        </span>
        <ZoomBtn onClick={() => zoomBy(1.4)} title="拡大">＋</ZoomBtn>
        <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 3px' }} />
        <ZoomBtn onClick={handleFitView} title="全体を表示">⤢</ZoomBtn>
      </div>

      {/* 表示件数 */}
      <div style={{
        position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 5,
        background: 'rgba(26,17,7,0.88)', backdropFilter: 'blur(8px)',
        border: '1px solid var(--border)', borderRadius: 8,
        padding: '5px 10px', fontSize: 11, color: 'var(--text-secondary)',
        // 詳細パネルを開くとキャンバスが狭まり、ボタンの文字が2行に折り返していた
        maxWidth: 'calc(100% - 28px)', whiteSpace: 'nowrap',
      }}>
        {/* まとまり / コミット の切り替え。900件を1件ずつ描いても全体は読めない */}
        {(['session', 'commit'] as const).map(u => (
          <button key={u} onClick={() => { onUnitChange?.(u); onClearFocus?.() }} style={{
            background: unit === u ? 'var(--accent)' : 'transparent',
            border: `1px solid ${unit === u ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 4, padding: '2px 8px',
            color: unit === u ? '#1A1107' : 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 11,
            fontWeight: unit === u ? 600 : 400,
            flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            {u === 'session' ? `まとまり ${sessionCount}` : 'コミット'}
          </button>
        ))}

        <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 3px' }} />

        {unit === 'commit' ? (
          <>
            <span style={{ color: 'var(--text-dim)' }}>表示</span>
            {DISPLAY_LIMITS.map(n => (
              <button key={n} onClick={() => setDisplayLimit(n)} style={{
                background: displayLimit === n ? 'var(--accent)' : 'transparent',
                border: `1px solid ${displayLimit === n ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 4, padding: '2px 7px',
                color: displayLimit === n ? '#1A1107' : 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 11,
                fontWeight: displayLimit === n ? 600 : 400,
              }}>
                {n >= 1000 ? '全件' : n}
              </button>
            ))}
            <span style={{ color: 'var(--text-dim)', marginLeft: 2 }}>/ {totalCount}</span>
          </>
        ) : (
          <span style={{
            color: 'var(--text-dim)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          }}>
            {totalCount} コミットを {sessionCount} のまとまりに · クリックで中へ
          </span>
        )}
      </div>

      <Tooltip />
    </div>
  )
})

export default MazeGraph

function ZoomBtn({ onClick, title, children }: {
  onClick: () => void; title: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent', border: '1px solid var(--border-interactive)', borderRadius: 5,
        width: 22, height: 22, cursor: 'pointer', color: 'var(--text-secondary)',
        fontSize: 12, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  )
}

// ── Utilities ──────────────────────────────────────────────
/** 蛇行レイアウト全体を画面に収める */
function fitLayout(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
  layout: Layout, W: number, H: number,
) {
  const scale = Math.max(0.12, Math.min(1.2, fitScale(layout.width, layout.height, W, H)))
  const tx = W / 2 - scale * (layout.width / 2)
  const ty = H / 2 - scale * (layout.height / 2)
  svg.transition().duration(600).call(
    zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale))
}

function applyHighlight(
  nodeElems: d3.Selection<SVGGElement, D3Node, SVGGElement, unknown>,
  selectedId?: string,
  highlightIds?: Set<string>
) {
  // 該当が1つも無いのに暗くすると、画面全部が沈んで「壊れた」ようにしか見えない
  const dimming = !!highlightIds && highlightIds.size > 0 &&
    nodeElems.data().some(d => highlightIds.has(d.id))
  nodeElems.attr('opacity', (d: D3Node) =>
    !dimming || highlightIds!.has(d.id) ? 1 : 0.14)
  nodeElems.select('.glow').attr('opacity', (d: D3Node) =>
    d.id === selectedId ? 0.35 : (dimming && highlightIds!.has(d.id) ? 0.2 : 0))
  nodeElems.select('.main-circle')
    .attr('stroke', (d: D3Node) => d.id === selectedId ? '#fff' : TYPE_COLOR[d.type])
    .attr('stroke-width', (d: D3Node) => {
      if (d.id === selectedId) return 3
      if (d.type === 'merge' || d.type === 'release') return 2.5
      return d.isMainBranch ? 2.4 : 1.5
    })
}

// ── Tooltip ────────────────────────────────────────────────
let tooltipEl: HTMLDivElement | null = null
function Tooltip() {
  return <div id="maze-tooltip" style={{
    position: 'fixed', pointerEvents: 'none', display: 'none',
    background: 'rgba(22,14,6,0.96)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '9px 13px', zIndex: 1000,
    fontSize: 12, color: 'var(--text-primary)',
    boxShadow: '0 6px 28px rgba(0,0,0,0.7)', maxWidth: 340,
    backdropFilter: 'blur(10px)',
  }} />
}

function getTooltipEl() {
  if (!tooltipEl) tooltipEl = document.getElementById('maze-tooltip') as HTMLDivElement
  return tooltipEl!
}

function showTooltip(event: MouseEvent, d: D3Node) {
  const el = getTooltipEl()
  if (!el) return
  const date = new Date(d.timestamp)
  el.innerHTML = `
    <div style="font-weight:600;margin-bottom:4px;line-height:1.4">${escapeHtml(d.message.split('\n')[0])}</div>
    <div style="color:#8B7355;font-family:monospace;font-size:11px">
      ${d.label} · ${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}
    </div>
    <div style="color:#8B7355;font-size:11px;margin-top:3px">
      ${escapeHtml(d.authorName)} · ${d.filesChanged} files · <span style="color:#7B9E5A">+${d.insertions}</span> <span style="color:#C0624B">-${d.deletions}</span>
    </div>
  `
  el.style.display = 'block'
  moveTooltip(event)
}

function moveTooltip(event: MouseEvent) {
  const el = getTooltipEl()
  if (!el) return
  const pad = 14
  const w = el.offsetWidth, h = el.offsetHeight
  let x = event.clientX + pad
  let y = event.clientY + pad
  if (x + w > window.innerWidth - 10) x = event.clientX - w - pad
  if (y + h > window.innerHeight - 10) y = event.clientY - h - pad
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}

function hideTooltip() {
  const el = getTooltipEl()
  if (el) el.style.display = 'none'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
