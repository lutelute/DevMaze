import { describe, it, expect } from 'vitest'
import { buildKnowledgeGraph, nodeId } from '../shared/knowledge/graph'
import { resultFrom, richHistory } from './knowledge-helpers'

describe('buildKnowledgeGraph', () => {
  const result = resultFrom(richHistory())
  const graph = buildKnowledgeGraph(result)
  const ids = new Set(graph.nodes.map(n => n.id))

  it('ノードの種類が一通り出る', () => {
    const kinds = new Set(graph.nodes.map(n => n.kind))
    for (const k of ['repo', 'commit', 'file', 'struggle', 'session', 'phase', 'author', 'tag']) {
      expect(kinds.has(k as never), k).toBe(true)
    }
  })

  it('ID は決定的で、2回作っても同じ', () => {
    const again = buildKnowledgeGraph(result)
    expect(again.nodes.map(n => n.id)).toEqual(graph.nodes.map(n => n.id))
    expect(again.edges.map(e => e.id)).toEqual(graph.edges.map(e => e.id))
  })

  it('ノード ID に重複が無い', () => {
    expect(ids.size).toBe(graph.nodes.length)
    expect(new Set(graph.edges.map(e => e.id)).size).toBe(graph.edges.length)
  })

  it('エッジの両端は必ず存在する', () => {
    for (const e of graph.edges) {
      expect(ids.has(e.from), `${e.id} from`).toBe(true)
      expect(ids.has(e.to), `${e.id} to`).toBe(true)
    }
  })

  it('PARENT は子 → 親、マージは props.merge', () => {
    const parents = graph.edges.filter(e => e.kind === 'PARENT')
    expect(parents.length).toBeGreaterThan(0)
    const merge = parents.filter(e => e.props?.merge === true)
    expect(merge.length).toBe(1)
    // 子 → 親: 2番目のコミットの親は最初のコミット
    const commits = result.graph.nodes
    const second = commits.find(n => n.message.includes('機能A') && n.type === 'feature')!
    expect(parents.some(e => e.from === nodeId.commit(second.id))).toBe(true)
  })

  it('REVERTS / TOUCHES / AUTHORED / TAGGED が張られる', () => {
    const kinds = new Set(graph.edges.map(e => e.kind))
    expect(kinds.has('REVERTS')).toBe(true)
    expect(kinds.has('TOUCHES')).toBe(true)
    expect(kinds.has('AUTHORED')).toBe(true)
    expect(kinds.has('TAGGED')).toBe(true)
    expect(graph.edges.filter(e => e.kind === 'TAGGED').length).toBe(2)
  })

  it('沼は PART_OF / INVOLVES を持ち、抜けたものは ESCAPED_BY を持つ', () => {
    expect(result.struggles.length).toBeGreaterThan(0)
    const partOf = graph.edges.filter(e => e.kind === 'PART_OF')
    expect(partOf.length).toBeGreaterThan(0)
    const involves = graph.edges.filter(e => e.kind === 'INVOLVES')
    expect(involves.every(e => typeof e.props?.touches === 'number')).toBe(true)
    const escaped = result.struggles.filter(e => e.escape)
    const escapedBy = graph.edges.filter(e => e.kind === 'ESCAPED_BY')
    expect(escapedBy.length).toBe(escaped.length)
  })

  it('セッションは IN_SESSION / FOLLOWS / IN_PHASE でつながる', () => {
    const sessions = graph.nodes.filter(n => n.kind === 'session')
    expect(sessions.length).toBeGreaterThan(1)
    const follows = graph.edges.filter(e => e.kind === 'FOLLOWS')
    expect(follows.length).toBe(sessions.length - 1)
    const inSession = graph.edges.filter(e => e.kind === 'IN_SESSION')
    expect(inSession.length).toBe(result.graph.nodes.length)
    if (result.graph.zones.length > 0) {
      expect(graph.edges.some(e => e.kind === 'IN_PHASE')).toBe(true)
    }
  })

  it('ホットスポットは HOTSPOT_OF で repo につながり risk を持つ', () => {
    const hot = graph.edges.filter(e => e.kind === 'HOTSPOT_OF')
    expect(hot.length).toBe(result.hotspots.length)
    expect(hot.every(e => e.to === nodeId.repo('fixture') && typeof e.props?.risk === 'number')).toBe(true)
  })

  it('ノイズファイル（lock・dist）はノードにしない', () => {
    const r = resultFrom([
      ...richHistory().slice(0, 3).map(c => ({ ...c, files: [...c.files, 'package-lock.json', 'dist/a.js'] })),
    ])
    const g = buildKnowledgeGraph(r)
    expect(g.nodes.some(n => n.id === 'file:package-lock.json')).toBe(false)
    expect(g.nodes.some(n => n.id === 'file:dist/a.js')).toBe(false)
  })

  it('空の履歴でも落ちない', () => {
    const g = buildKnowledgeGraph(resultFrom([]))
    expect(g.nodes.length).toBe(1)
    expect(g.edges.length).toBe(0)
  })
})
