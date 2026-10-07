import { describe, it, expect } from 'vitest'
import {
  buildMazeItems, mapHighlightToItems, mapStruggleToItems, nodeRadius, HIGHLIGHT_OVERFLOW,
} from '../shared/maze/items'
import type { MazeEdge, MazeNode } from '../shared/types'
import { mazeNode, MIN, HOUR, BASE } from './maze-helpers'

function series(count: number, gapMs: number, extra: Partial<MazeNode> = {}): MazeNode[] {
  return Array.from({ length: count }, (_, i) => mazeNode({ timestamp: BASE + i * gapMs, ...extra }))
}

function chain(nodes: MazeNode[]): MazeEdge[] {
  return nodes.slice(1).map((n, i) => ({
    id: `${nodes[i].id}→${n.id}`, source: nodes[i].id, target: n.id, type: 'parent' as const,
  }))
}

describe('buildMazeItems', () => {
  it('200件以下は自動でコミット表示、超えたらまとまり表示', () => {
    const small = series(200, 5 * MIN)
    const big = series(201, 5 * MIN)
    expect(buildMazeItems({ nodes: small, edges: [], filterTypes: new Set(), unit: null, displayLimit: 1000 }).unit).toBe('commit')
    expect(buildMazeItems({ nodes: big, edges: [], filterTypes: new Set(), unit: null, displayLimit: 1000 }).unit).toBe('session')
  })

  it('unit を指定したら件数に関わらずそれに従う', () => {
    const big = series(300, 5 * MIN)
    expect(buildMazeItems({ nodes: big, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 1000 }).unit).toBe('commit')
    const small = series(10, 5 * MIN)
    expect(buildMazeItems({ nodes: small, edges: [], filterTypes: new Set(), unit: 'session', displayLimit: 1000 }).unit).toBe('session')
  })

  it('コミット表示は新しい順に displayLimit 件だけ', () => {
    const nodes = series(300, 5 * MIN)
    const r = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 80 })
    expect(r.items).toHaveLength(80)
    expect(r.totalCount).toBe(300)
    const newest = nodes.slice(-80).map(n => n.id).sort()
    expect(r.items.map(i => i.id).sort()).toEqual(newest)
    // 時刻順に並んでいる
    for (let i = 1; i < r.items.length; i++) expect(r.items[i].timestamp).toBeGreaterThanOrEqual(r.items[i - 1].timestamp)
  })

  it('強調対象は表示件数の外でも追い出して出す（上限あり）', () => {
    const nodes = series(500, 5 * MIN)
    const oldest = new Set(nodes.slice(0, 10).map(n => n.id))
    const r = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 80, highlightHashes: oldest })
    expect(r.items).toHaveLength(90)
    for (const id of oldest) expect(r.items.some(i => i.id === id)).toBe(true)

    const tooMany = new Set(nodes.slice(0, 400).map(n => n.id))
    const r2 = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 80, highlightHashes: tooMany })
    expect(r2.items).toHaveLength(80 + HIGHLIGHT_OVERFLOW)
  })

  it('種別で絞ると件数と自動判定の母数が変わる', () => {
    const nodes = [...series(150, 5 * MIN, { type: 'normal' }), ...series(100, 5 * MIN, { type: 'error_fix' })]
    const r = buildMazeItems({ nodes, edges: [], filterTypes: new Set(['error_fix']), unit: null, displayLimit: 1000 })
    expect(r.totalCount).toBe(100)
    expect(r.unit).toBe('commit')
    expect(r.items.every(i => i.type === 'error_fix')).toBe(true)
  })

  it('コミット表示のリンクは両端が表示中のものだけ', () => {
    const nodes = series(10, 5 * MIN)
    const edges = chain(nodes)
    const r = buildMazeItems({ nodes, edges, filterTypes: new Set(), unit: 'commit', displayLimit: 5 })
    expect(r.items).toHaveLength(5)
    expect(r.links).toHaveLength(4)
    const shown = new Set(r.items.map(i => i.id))
    for (const l of r.links) {
      expect(shown.has(l.source)).toBe(true)
      expect(shown.has(l.target)).toBe(true)
    }
  })

  it('まとまり表示は時間順に数珠つなぎで、count と memberHashes を持つ', () => {
    // 3つの作業（2時間以上あける）
    const nodes = [
      ...series(5, 10 * MIN),
      ...Array.from({ length: 4 }, (_, i) => mazeNode({ timestamp: BASE + 10 * HOUR + i * 10 * MIN })),
      ...Array.from({ length: 3 }, (_, i) => mazeNode({ timestamp: BASE + 30 * HOUR + i * 10 * MIN })),
    ]
    const r = buildMazeItems({ nodes, edges: chain(nodes), filterTypes: new Set(), unit: 'session', displayLimit: 1 })
    expect(r.items).toHaveLength(3)
    expect(r.sessionCount).toBe(3)
    expect(r.items.map(i => i.count)).toEqual([5, 4, 3])
    expect(r.items[0].memberHashes).toHaveLength(5)
    expect(r.links).toHaveLength(2)
    expect(r.links[0].source).toBe(r.items[0].id)
    expect(r.links[0].target).toBe(r.items[1].id)
    expect(r.links[1].target).toBe(r.items[2].id)
    // 表示上限は効かない
    expect(r.totalCount).toBe(12)
  })
})

describe('mapHighlightToItems', () => {
  it('コミット表示では表示中のものとの交わり、無ければ undefined', () => {
    const nodes = series(5, 5 * MIN)
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 1000 })
    const hit = mapHighlightToItems(items, new Set([nodes[1].id, 'nope']))
    expect(hit).toEqual(new Set([nodes[1].id]))
    expect(mapHighlightToItems(items, new Set(['nope']))).toBeUndefined()
    expect(mapHighlightToItems(items, new Set())).toBeUndefined()
    expect(mapHighlightToItems(items, undefined)).toBeUndefined()
  })

  it('まとまり表示ではメンバーで読み替える', () => {
    const nodes = [...series(4, 10 * MIN), ...Array.from({ length: 3 }, (_, i) => mazeNode({ timestamp: BASE + 10 * HOUR + i * 10 * MIN }))]
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'session', displayLimit: 1 })
    const hit = mapHighlightToItems(items, new Set([nodes[5].id]))
    expect(hit).toEqual(new Set([items[1].id]))
  })
})

describe('mapStruggleToItems', () => {
  it('コミット表示は1対1で深刻度を持つ（無ければ 50）', () => {
    const nodes = series(3, 5 * MIN)
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'commit', displayLimit: 1000 })
    const m = mapStruggleToItems(items, new Set([nodes[0].id, nodes[2].id]), new Map([[nodes[0].id, 90]]))
    expect(m.get(nodes[0].id)).toBe(90)
    expect(m.get(nodes[2].id)).toBe(50)
    expect(m.has(nodes[1].id)).toBe(false)
    expect(mapStruggleToItems(items, undefined).size).toBe(0)
  })

  it('まとまり表示は過半が沼のときだけ、最大の深刻度で印をつける', () => {
    const nodes = series(4, 10 * MIN)
    const { items } = buildMazeItems({ nodes, edges: [], filterTypes: new Set(), unit: 'session', displayLimit: 1 })
    expect(items).toHaveLength(1)
    // 4件中2件 = 過半ではない
    expect(mapStruggleToItems(items, new Set([nodes[0].id, nodes[1].id])).size).toBe(0)
    // 4件中3件
    const sev = new Map([[nodes[0].id, 40], [nodes[1].id, 85], [nodes[2].id, 60]])
    const m = mapStruggleToItems(items, new Set([nodes[0].id, nodes[1].id, nodes[2].id]), sev)
    expect(m.get(items[0].id)).toBe(85)
  })
})

describe('nodeRadius', () => {
  const base = { id: 'x', type: 'normal' as const, timestamp: 0, lane: 0, isMainBranch: true, filesChanged: 0,
    label: '', message: '', tagNames: [], isMilestone: false, authorName: '', insertions: 0, deletions: 0 }

  it('メインラインは大きく、枝は小さく、変更ファイル数で少し育つ（上限+4）', () => {
    expect(nodeRadius({ ...base, filesChanged: 0 })).toBe(8)
    expect(nodeRadius({ ...base, filesChanged: 4 })).toBe(10)
    expect(nodeRadius({ ...base, filesChanged: 100 })).toBe(12)
    expect(nodeRadius({ ...base, isMainBranch: false, filesChanged: 0 })).toBe(5.5)
  })

  it('マージとリリースは固定、まとまりは件数の平方根で大きくなる（上限30）', () => {
    expect(nodeRadius({ ...base, type: 'merge' })).toBe(9)
    expect(nodeRadius({ ...base, type: 'release' })).toBe(10)
    expect(nodeRadius({ ...base, count: 4 })).toBeCloseTo(9 + 2 * 3.2, 6)
    expect(nodeRadius({ ...base, count: 1000 })).toBe(30)
    expect(nodeRadius({ ...base, count: 1 })).toBe(8)
  })
})
