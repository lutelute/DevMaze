import { describe, it, expect } from 'vitest'
import { buildMazeItems } from '../shared/maze/items'
import { buildMazeLayout, compactLanes, fitTransform, fitScaleFor, PADDING, FIT_MIN_K, FIT_MAX_K } from '../shared/maze/layout'
import type { MazeLayout } from '../shared/maze/types'
import type { StruggleEpisode } from '../shared/types'
import { mazeNode, realisticHistory, MIN, HOUR, DAY, BASE } from './maze-helpers'

const VIEW = { viewportW: 1200, viewportH: 800 }

function layoutOf(count: number, unit: 'commit' | 'session' = 'commit', seed = 1, struggles?: StruggleEpisode[]): MazeLayout {
  const nodes = realisticHistory(count, seed)
  const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit, displayLimit: 10_000 })
  return buildMazeLayout({ items, unit, struggles }, VIEW)
}

function placedSnapshot(l: MazeLayout) {
  return l.placed.map(p => `${p.id}:${p.x.toFixed(4)},${p.y.toFixed(4)},${p.r},${p.row}`).join('\n')
}

describe('compactLanes', () => {
  it('使われているレーンだけを 0 の両側に詰め、外側は畳む', () => {
    const m = compactLanes([0, 3, 7, -2, -5, -9], 2)
    expect(m.get(0)).toBe(0)
    expect(m.get(3)).toBe(1)
    expect(m.get(7)).toBe(2)
    expect(m.get(-2)).toBe(-1)
    expect(m.get(-5)).toBe(-2)
    expect(m.get(-9)).toBe(-2)   // 深さ2で畳まれる
  })
})

describe('buildMazeLayout', () => {
  it('空なら空のレイアウト', () => {
    const l = buildMazeLayout({ items: [], unit: 'commit' }, VIEW)
    expect(l.placed).toEqual([])
    expect(l.rows).toEqual([])
    expect(l.fitScale(1200, 800)).toBe(1)
    expect(l.pos(0)).toEqual({ x: 0, y: 0, row: 0 })
  })

  it('置いた円は互いに重ならない（同じ行で距離 ≥ r1 + r2 + PADDING）', () => {
    for (const [count, unit] of [[400, 'commit'], [1000, 'commit'], [1000, 'session']] as const) {
      const l = layoutOf(count, unit)
      const byRow = new Map<number, typeof l.placed>()
      for (const p of l.placed) {
        if (!byRow.has(p.row)) byRow.set(p.row, [])
        byRow.get(p.row)!.push(p)
      }
      let pairs = 0
      for (const list of byRow.values()) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j]
            const d = Math.hypot(a.x - b.x, a.y - b.y)
            expect(d).toBeGreaterThanOrEqual(a.r + b.r + PADDING - 1e-6)
            pairs++
          }
        }
      }
      expect(pairs).toBeGreaterThan(0)
    }
  })

  it('密集した時期でも重ならず、縦に押し広げられる', () => {
    // 同じ分に20件（x が完全に一致する最悪ケース）
    const nodes = Array.from({ length: 20 }, () => mazeNode({ timestamp: BASE }))
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 1000 })
    const l = buildMazeLayout({ items, unit: 'commit' }, VIEW)
    const ys = l.placed.map(p => p.y)
    expect(new Set(ys.map(y => y.toFixed(3))).size).toBe(20)
    for (let i = 0; i < l.placed.length; i++) {
      for (let j = i + 1; j < l.placed.length; j++) {
        const a = l.placed[i], b = l.placed[j]
        expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r + PADDING - 1e-6)
      }
    }
    // 行の高さは広がりを含んでいる
    const row = l.rows[0]
    for (const p of l.placed) {
      expect(p.y - p.r).toBeGreaterThanOrEqual(row.top)
      expect(p.y + p.r).toBeLessThanOrEqual(row.top + row.height)
    }
  })

  it('各ノードは自分の行の範囲に収まり、行は隙間なく積まれる', () => {
    const l = layoutOf(600)
    expect(l.rows.length).toBeGreaterThan(1)
    let acc = 0
    for (const r of l.rows) {
      expect(r.top).toBeCloseTo(acc, 6)
      acc += r.height
      // mid は絶対座標。行の内側に収まっていること
      expect(r.mid).toBeGreaterThan(r.top)
      expect(r.mid).toBeLessThan(r.top + r.height)
    }
    expect(l.height).toBeCloseTo(acc, 6)
    for (const p of l.placed) {
      const r = l.rows[p.row]
      expect(p.y - p.r).toBeGreaterThanOrEqual(r.top - 1e-6)
      expect(p.y + p.r).toBeLessThanOrEqual(r.top + r.height + 1e-6)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(l.rowW)
    }
  })

  it('偶数行は時刻順に x が増え、奇数行は減る（牛耕式）', () => {
    const nodes = realisticHistory(600, 1)
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 10_000 })
    const l = buildMazeLayout({ items, unit: 'commit' }, VIEW)
    const time = new Map(nodes.map(n => [n.id, n.timestamp]))
    const byRow = new Map<number, typeof l.placed>()
    for (const p of l.placed) {
      if (!byRow.has(p.row)) byRow.set(p.row, [])
      byRow.get(p.row)!.push(p)
    }
    expect(byRow.size).toBeGreaterThan(1)
    for (const [row, list] of byRow) {
      const sorted = [...list].sort((a, b) => time.get(a.id)! - time.get(b.id)!)
      for (let i = 1; i < sorted.length; i++) {
        if (row % 2 === 0) expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x)
        else expect(sorted[i].x).toBeLessThanOrEqual(sorted[i - 1].x)
      }
      expect(l.rows[row].leftToRight).toBe(row % 2 === 0)
    }
    // 行の開始・終了時刻は単調
    for (let i = 1; i < l.rows.length; i++) {
      expect(l.rows[i].startTime).toBeGreaterThanOrEqual(l.rows[i - 1].endTime - 1)
    }
  })

  it('1000件でも 300ms 以内', () => {
    const nodes = realisticHistory(1000, 7)
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 10_000 })
    const t0 = performance.now()
    const l = buildMazeLayout({ items, unit: 'commit' }, VIEW)
    const ms = performance.now() - t0
    expect(l.placed).toHaveLength(1000)
    expect(ms).toBeLessThan(300)
  })

  it('同じ入力なら同じ出力', () => {
    const nodes = realisticHistory(500, 3)
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 10_000 })
    const a = buildMazeLayout({ items, unit: 'commit' }, VIEW)
    const b = buildMazeLayout({ items: [...items].reverse(), unit: 'commit' }, VIEW)   // 入力の並びにも依らない
    expect(placedSnapshot(a)).toBe(placedSnapshot(b))
    expect(a.rows).toEqual(b.rows)
    expect(a.gaps).toEqual(b.gaps)
    expect(a.width).toBe(b.width)
    expect(a.height).toBe(b.height)
  })

  it('折り返しは全体表示がいちばん大きくなる行数を選ぶ', () => {
    const l = layoutOf(800)
    const chosen = fitScaleFor(l.width, l.height, VIEW.viewportW, VIEW.viewportH)
    expect(l.fitScale(VIEW.viewportW, VIEW.viewportH)).toBeCloseTo(chosen, 9)
    // 1行に伸ばしたものより大きく映る
    const nodes = realisticHistory(800, 1)
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 10_000 })
    const one = buildMazeLayout({ items, unit: 'commit' }, { ...VIEW, maxRows: 1 })
    expect(one.rows).toHaveLength(1)
    expect(chosen).toBeGreaterThan(one.fitScale(VIEW.viewportW, VIEW.viewportH))
    expect(l.rows.length).toBeGreaterThan(1)
  })

  it('画面の大きさが変われば折り返し方が変わる', () => {
    const nodes = realisticHistory(800, 1)
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 10_000 })
    const wide = buildMazeLayout({ items, unit: 'commit' }, { viewportW: 3000, viewportH: 600 })
    const tall = buildMazeLayout({ items, unit: 'commit' }, { viewportW: 800, viewportH: 2000 })
    expect(wide.rows.length).toBeLessThan(tall.rows.length)
  })

  it('3日以上の空白は行と位置つきの印になる', () => {
    const nodes = [
      mazeNode({ timestamp: BASE }),
      mazeNode({ timestamp: BASE + HOUR }),
      mazeNode({ timestamp: BASE + HOUR + 6 * DAY }),
      mazeNode({ timestamp: BASE + HOUR + 6 * DAY + 30 * MIN }),
    ]
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 1000 })
    const l = buildMazeLayout({ items, unit: 'commit' }, VIEW)
    expect(l.gaps).toHaveLength(1)
    expect(l.gaps[0].days).toBe(6)
    expect(l.gaps[0].row).toBe(0)
    const a = l.byId.get(nodes[1].id)!
    const b = l.byId.get(nodes[2].id)!
    expect(l.gaps[0].x).toBeGreaterThan(Math.min(a.x, b.x))
    expect(l.gaps[0].x).toBeLessThan(Math.max(a.x, b.x))
  })

  it('pos は置かれたノードの目標位置（衝突なし）と一致する', () => {
    const nodes = [
      mazeNode({ timestamp: BASE }),
      mazeNode({ timestamp: BASE + 5 * HOUR }),
      mazeNode({ timestamp: BASE + 2 * DAY }),
      mazeNode({ timestamp: BASE + 3 * DAY, lane: 4, isMainBranch: false }),
    ]
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 1000 })
    const l = buildMazeLayout({ items, unit: 'commit' }, VIEW)
    for (const n of nodes) {
      const p = l.byId.get(n.id)!
      const q = l.pos(n.timestamp, n.lane)
      expect(q.x).toBeCloseTo(p.x, 6)
      expect(q.y).toBeCloseTo(p.y, 6)
      expect(q.row).toBe(p.row)
    }
    // 使われている枝はレーン幅ぶんずれ、使われていないレーンは 0 に畳まれる
    expect(l.laneOf(4)).toBe(1)
    expect(l.pos(BASE, 4).y - l.pos(BASE, 0).y).toBeCloseTo(l.laneGap, 6)
    expect(l.laneOf(-7)).toBe(0)
    expect(l.pos(BASE, -7).y).toBeCloseTo(l.pos(BASE, 0).y, 6)
  })

  describe('沼の帯', () => {
    const episode = (id: string, start: number, end: number): StruggleEpisode => ({
      id, kind: 'fix_chain', title: id, severity: 60, startTimestamp: start, endTimestamp: end,
      durationHours: (end - start) / HOUR, commits: [], files: [], evidence: [], nightRatio: 0,
    })

    it('表示範囲と重ならないエピソードは帯にならない', () => {
      const nodes = realisticHistory(50, 2)
      const first = Math.min(...nodes.map(n => n.timestamp))
      const last = Math.max(...nodes.map(n => n.timestamp))
      const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 1000 })
      const l = buildMazeLayout({ items, unit: 'commit', struggles: [
        episode('before', first - 10 * DAY, first - 5 * DAY),
        episode('after', last + DAY, last + 3 * DAY),
        episode('inside', first + HOUR, first + 2 * HOUR),
      ] }, VIEW)
      expect(l.bands.map(b => b.struggleId)).toEqual(['inside'])
      expect(l.bands[0].isHead).toBe(true)
      expect(l.bands[0].isTail).toBe(true)
      expect(l.bands[0].x1).toBeGreaterThan(l.bands[0].x0)
    })

    it('行をまたぐエピソードは行ごとの区間に分かれ、奇数行は反転する', () => {
      const nodes = realisticHistory(600, 1)
      const first = Math.min(...nodes.map(n => n.timestamp))
      const last = Math.max(...nodes.map(n => n.timestamp))
      const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 10_000 })
      const l = buildMazeLayout({ items, unit: 'commit', struggles: [episode('all', first, last)] }, VIEW)
      expect(l.rows.length).toBeGreaterThan(1)
      expect(l.bands).toHaveLength(l.rows.length)
      expect(l.bands[0].isHead).toBe(true)
      expect(l.bands[l.bands.length - 1].isTail).toBe(true)
      expect(l.bands.slice(1, -1).every(b => !b.isHead && !b.isTail)).toBe(true)
      for (const b of l.bands) {
        expect(b.x0).toBeGreaterThanOrEqual(0)
        expect(b.x1).toBeLessThanOrEqual(l.rowW + 1e-6)
        expect(b.x1).toBeGreaterThan(b.x0)
      }
      // 先頭の行は左端から、奇数の2行目は右端から始まる
      expect(l.bands[0].x0).toBeCloseTo(0, 6)
      expect(l.bands[1].x1).toBeCloseTo(l.rowW, 6)
    })
  })
})

describe('fitTransform', () => {
  it('全体を画面の中央に置き、倍率は上下限に収める', () => {
    const l = layoutOf(300)
    const t = fitTransform(l, 1200, 800)
    expect(t.k).toBeGreaterThanOrEqual(FIT_MIN_K)
    expect(t.k).toBeLessThanOrEqual(FIT_MAX_K)
    // 中心が画面中央
    expect(t.x + t.k * l.width / 2).toBeCloseTo(600, 6)
    expect(t.y + t.k * l.height / 2).toBeCloseTo(400, 6)
    // 小さい図は拡大しすぎない
    expect(fitTransform({ width: 100, height: 50 }, 1200, 800).k).toBe(FIT_MAX_K)
    expect(fitTransform({ width: 100_000, height: 50_000 }, 1200, 800).k).toBe(FIT_MIN_K)
  })
})
