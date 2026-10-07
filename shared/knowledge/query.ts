/**
 * property graph をプロセス内で辿る。
 *
 * 1000 コミット規模のグラフは数千ノード・1万エッジ程度なので、Neo4j のような外部 DB は要らない。
 * 隣接の索引を一度作って使い回し、neighbors（近傍）・find（検索）・path（経路）の3つに答える。
 */
import type { KnowledgeGraph, KNode, KEdge, KNodeKind, KEdgeKind } from '../types'

export type GraphQuery =
  | {
      op: 'neighbors'
      node_id: string
      edge_kind?: KEdgeKind
      direction?: 'out' | 'in' | 'both'
      /** 1〜3。既定 1 */
      depth?: number
      limit?: number
    }
  | {
      op: 'find'
      kind?: KNodeKind
      /** label / id の部分一致（大文字小文字を無視） */
      text?: string
      limit?: number
    }
  | {
      op: 'path'
      from: string
      to: string
      /** 既定 4 */
      max_depth?: number
    }

export interface GraphQueryResult {
  op: GraphQuery['op']
  nodes: KNode[]
  edges: KEdge[]
  /** 絞り込む前の該当数 */
  total: number
  truncated: boolean
  note?: string
}

export class GraphIndex {
  readonly nodes = new Map<string, KNode>()
  readonly out = new Map<string, KEdge[]>()
  readonly in = new Map<string, KEdge[]>()

  constructor(readonly graph: KnowledgeGraph) {
    for (const n of graph.nodes) this.nodes.set(n.id, n)
    for (const e of graph.edges) {
      if (!this.out.has(e.from)) this.out.set(e.from, [])
      this.out.get(e.from)!.push(e)
      if (!this.in.has(e.to)) this.in.set(e.to, [])
      this.in.get(e.to)!.push(e)
    }
  }

  /** ノードから出入りするエッジ。direction と kind で絞る */
  edgesOf(id: string, direction: 'out' | 'in' | 'both' = 'both', kind?: KEdgeKind): KEdge[] {
    const list: KEdge[] = []
    if (direction !== 'in') for (const e of this.out.get(id) ?? []) if (!kind || e.kind === kind) list.push(e)
    if (direction !== 'out') for (const e of this.in.get(id) ?? []) if (!kind || e.kind === kind) list.push(e)
    return list
  }
}

const indexCache = new WeakMap<KnowledgeGraph, GraphIndex>()

export function indexOf(graph: KnowledgeGraph): GraphIndex {
  let idx = indexCache.get(graph)
  if (!idx) { idx = new GraphIndex(graph); indexCache.set(graph, idx) }
  return idx
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

function clampLimit(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)))
}

export function queryGraph(graph: KnowledgeGraph, q: GraphQuery): GraphQueryResult {
  const idx = indexOf(graph)

  if (q.op === 'find') {
    const text = q.text?.trim().toLowerCase()
    const hits = graph.nodes
      .filter(n => !q.kind || n.kind === q.kind)
      .filter(n => !text || n.label.toLowerCase().includes(text) || n.id.toLowerCase().includes(text))
      .sort((a, b) => a.id.localeCompare(b.id))
    const limit = clampLimit(q.limit)
    return {
      op: 'find',
      nodes: hits.slice(0, limit),
      edges: [],
      total: hits.length,
      truncated: hits.length > limit,
    }
  }

  if (q.op === 'neighbors') {
    const start = idx.nodes.get(q.node_id)
    if (!start) {
      return { op: 'neighbors', nodes: [], edges: [], total: 0, truncated: false, note: `ノードが無い: ${q.node_id}` }
    }
    const depth = Math.max(1, Math.min(3, Math.floor(q.depth ?? 1)))
    const direction = q.direction ?? 'both'
    const limit = clampLimit(q.limit)

    const seenNodes = new Map<string, KNode>([[start.id, start]])
    const seenEdges = new Map<string, KEdge>()
    let frontier = [start.id]
    let total = 0
    let truncated = false

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const e of idx.edgesOf(id, direction, q.edge_kind)) {
          const other = e.from === id ? e.to : e.from
          if (!seenEdges.has(e.id)) { seenEdges.set(e.id, e); total++ }
          if (seenNodes.has(other)) continue
          if (seenNodes.size - 1 >= limit) { truncated = true; continue }
          const n = idx.nodes.get(other)
          if (!n) continue
          seenNodes.set(other, n)
          next.push(other)
        }
      }
      frontier = next
    }

    const nodes = [...seenNodes.values()]
    const keep = new Set(nodes.map(n => n.id))
    const edges = [...seenEdges.values()].filter(e => keep.has(e.from) && keep.has(e.to))
    return { op: 'neighbors', nodes, edges, total: seenNodes.size - 1, truncated }
  }

  // path: 無向 BFS で最短の1本
  const from = idx.nodes.get(q.from)
  const to = idx.nodes.get(q.to)
  if (!from || !to) {
    return {
      op: 'path', nodes: [], edges: [], total: 0, truncated: false,
      note: `ノードが無い: ${!from ? q.from : q.to}`,
    }
  }
  const maxDepth = Math.max(1, Math.min(8, Math.floor(q.max_depth ?? 4)))
  if (from.id === to.id) return { op: 'path', nodes: [from], edges: [], total: 0, truncated: false }

  const prev = new Map<string, { node: string; edge: KEdge } | null>([[from.id, null]])
  let frontier = [from.id]
  let found = false
  for (let d = 0; d < maxDepth && frontier.length > 0 && !found; d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const e of idx.edgesOf(id, 'both')) {
        const other = e.from === id ? e.to : e.from
        if (prev.has(other)) continue
        prev.set(other, { node: id, edge: e })
        if (other === to.id) { found = true; break }
        next.push(other)
      }
      if (found) break
    }
    frontier = next
  }

  if (!found) {
    return {
      op: 'path', nodes: [], edges: [], total: 0, truncated: false,
      note: `${maxDepth} 段以内に経路が無い`,
    }
  }

  const nodes: KNode[] = []
  const edges: KEdge[] = []
  let cur: string | null = to.id
  while (cur) {
    nodes.unshift(idx.nodes.get(cur)!)
    const p: { node: string; edge: KEdge } | null = prev.get(cur) ?? null
    if (!p) break
    edges.unshift(p.edge)
    cur = p.node
  }
  return { op: 'path', nodes, edges, total: edges.length, truncated: false }
}
