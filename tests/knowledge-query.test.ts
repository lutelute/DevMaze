import { describe, it, expect } from 'vitest'
import { buildKnowledgeGraph, nodeId } from '../shared/knowledge/graph'
import { queryGraph } from '../shared/knowledge/query'
import { resultFrom, richHistory } from './knowledge-helpers'

describe('queryGraph', () => {
  const result = resultFrom(richHistory())
  const graph = buildKnowledgeGraph(result)

  it('find: 種別と文字で絞れる', () => {
    const r = queryGraph(graph, { op: 'find', kind: 'struggle' })
    expect(r.nodes.length).toBe(result.struggles.length)
    expect(r.nodes.every(n => n.kind === 'struggle')).toBe(true)
    const x = queryGraph(graph, { op: 'find', kind: 'file', text: 'x.ts' })
    expect(x.nodes.map(n => n.id)).toEqual(['file:src/x.ts'])
  })

  it('find: limit を超えたら truncated', () => {
    const r = queryGraph(graph, { op: 'find', kind: 'commit', limit: 3 })
    expect(r.nodes.length).toBe(3)
    expect(r.total).toBe(result.graph.nodes.length)
    expect(r.truncated).toBe(true)
  })

  it('neighbors: ファイルを触ったコミットを in 方向で引ける', () => {
    const r = queryGraph(graph, { op: 'neighbors', node_id: 'file:src/x.ts', edge_kind: 'TOUCHES', direction: 'in' })
    const expected = result.graph.nodes.filter(n => n.files.includes('src/x.ts')).length
    expect(r.nodes.length - 1).toBe(expected)       // 起点を含む
    expect(r.edges.every(e => e.kind === 'TOUCHES')).toBe(true)
  })

  it('neighbors: depth 2 で沼 → コミット → ファイルまで届く', () => {
    const s = result.struggles[0]
    const r1 = queryGraph(graph, { op: 'neighbors', node_id: nodeId.struggle(s.id), depth: 1 })
    const r2 = queryGraph(graph, { op: 'neighbors', node_id: nodeId.struggle(s.id), depth: 2, limit: 500 })
    expect(r2.nodes.length).toBeGreaterThan(r1.nodes.length)
    expect(r2.nodes.some(n => n.kind === 'file')).toBe(true)
    // 返したエッジの両端は返したノードの中にある
    const ids = new Set(r2.nodes.map(n => n.id))
    expect(r2.edges.every(e => ids.has(e.from) && ids.has(e.to))).toBe(true)
  })

  it('neighbors: 無いノードは note を返す', () => {
    const r = queryGraph(graph, { op: 'neighbors', node_id: 'commit:nope' })
    expect(r.nodes.length).toBe(0)
    expect(r.note).toContain('nope')
  })

  it('path: 著者からファイルまでの経路が取れ、エッジ数は深さ以内', () => {
    const r = queryGraph(graph, { op: 'path', from: 'author:bob', to: 'file:src/x.ts', max_depth: 3 })
    expect(r.nodes[0].id).toBe('author:bob')
    expect(r.nodes[r.nodes.length - 1].id).toBe('file:src/x.ts')
    expect(r.edges.length).toBe(r.nodes.length - 1)
    expect(r.edges.length).toBeLessThanOrEqual(3)
  })

  it('path: 届かなければ note', () => {
    const r = queryGraph(graph, { op: 'path', from: 'tag:v0.1.0', to: 'tag:v0.2.0', max_depth: 1 })
    expect(r.nodes.length).toBe(0)
    expect(r.note).toBeDefined()
  })
})
