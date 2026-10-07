/**
 * 解析結果を property graph にする。
 *
 * DevMaze のデータは最初からグラフ（コミットがファイルを触り、沼に属し、沼をコミットが抜け、
 * 沼がファイルで再発する）。平らな一覧のままでは「CSS で3回詰まって毎回効いたのは何か」
 * のような多段の問いに答えられないので、関係を明示的に持たせる。
 *
 * ID は決定的（同じ解析結果からは同じ ID）。外部の DB に入れ直しても突き合わせられる。
 * エッジは両端のノードが存在するものだけを出す（壊れた参照を外へ出さない）。
 */
import type {
  AnalysisResult, KnowledgeGraph, KNode, KEdge, KEdgeKind, KProps, MazeNode,
} from '../types'
import { buildSessions } from '../maze/sessions'
import { isSignalFile } from '../analyzer/paths'

export const nodeId = {
  repo:     (name: string) => `repo:${name}`,
  commit:   (hash: string) => `commit:${hash}`,
  file:     (path: string) => `file:${path}`,
  struggle: (id: string)   => `struggle:${id}`,
  session:  (id: string)   => `session:${id}`,
  phase:    (id: string)   => `phase:${id}`,
  author:   (name: string) => `author:${name}`,
  tag:      (name: string) => `tag:${name}`,
}

const iso = (ts: number) => new Date(ts).toISOString()
const subject = (message: string) => message.split('\n')[0].trim()

class Builder {
  nodes = new Map<string, KNode>()
  edges = new Map<string, KEdge>()

  node(n: KNode): void {
    if (!this.nodes.has(n.id)) this.nodes.set(n.id, n)
  }

  edge(kind: KEdgeKind, from: string, to: string, props?: KProps): void {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return
    const id = `${kind}:${from}->${to}`
    if (this.edges.has(id)) return
    this.edges.set(id, props ? { id, kind, from, to, props } : { id, kind, from, to })
  }
}

export function buildKnowledgeGraph(result: AnalysisResult): KnowledgeGraph {
  const b = new Builder()
  const nodes: MazeNode[] = result.graph.nodes
  const byHash = new Map(nodes.map(n => [n.id, n]))
  const repoId = nodeId.repo(result.repoName)

  // ── repo ───────────────────────────────────────────────
  b.node({
    id: repoId, kind: 'repo', label: result.repoName,
    props: {
      path: result.repoPath,
      remoteUrl: result.remoteUrl ?? null,
      totalCommits: result.stats.totalCommits,
      score: result.score.total,
      level: result.score.level,
      authors: result.stats.authors,
      start: result.stats.dateRange.start,
      end: result.stats.dateRange.end,
      fileStatsCoverage: result.stats.fileStatsCoverage,
      struggleCount: result.struggles.length,
      hotspotCount: result.hotspots.length,
    },
  })

  // ── commit / file / author / tag ──────────────────────
  const riskByPath = new Map(result.hotspots.map(h => [h.path, h]))

  for (const n of nodes) {
    b.node({
      id: nodeId.commit(n.id), kind: 'commit', label: subject(n.message),
      props: {
        hash: n.id, shortHash: n.label, type: n.type, timestamp: iso(n.timestamp),
        author: n.authorName, filesChanged: n.filesChanged,
        insertions: n.insertions, deletions: n.deletions,
        isMainBranch: n.isMainBranch, lane: n.lane,
        isMilestone: n.isMilestone, milestoneReason: n.milestoneReason ?? null,
        refs: n.refs.map(String),
      },
    })
    b.node({ id: nodeId.author(n.authorName), kind: 'author', label: n.authorName, props: {} })
    for (const t of n.tagNames) b.node({ id: nodeId.tag(t), kind: 'tag', label: t, props: {} })
    for (const f of n.files) {
      if (!isSignalFile(f)) continue
      b.node({ id: nodeId.file(f), kind: 'file', label: f, props: fileProps(f, riskByPath.get(f)?.risk) })
    }
  }
  for (const h of result.hotspots) {
    b.node({ id: nodeId.file(h.path), kind: 'file', label: h.path, props: fileProps(h.path, h.risk) })
  }

  // 著者の統計は activity が持っている
  for (const a of result.activity.authors) {
    const n = b.nodes.get(nodeId.author(a.name))
    if (!n) continue
    n.props = {
      commits: a.commits, fixCommits: a.fixCommits,
      insertions: a.insertions, deletions: a.deletions,
      firstSeen: iso(a.firstSeen), lastSeen: iso(a.lastSeen),
    }
  }

  // ── struggle / session / phase ────────────────────────
  for (const e of result.struggles) {
    b.node({
      id: nodeId.struggle(e.id), kind: 'struggle', label: e.title,
      props: {
        kind: e.kind, severity: e.severity, title: e.title,
        start: iso(e.startTimestamp), end: iso(e.endTimestamp),
        durationHours: e.durationHours, commitCount: e.commits.length,
        nightRatio: e.nightRatio, escaped: !!e.escape,
        recurrenceIndex: e.recurrence?.index ?? null,
        recurrenceTimes: e.recurrence?.times ?? null,
        evidence: e.evidence,
      },
    })
  }

  const sessions = buildSessions(nodes)
  for (const s of sessions) {
    b.node({
      id: nodeId.session(s.id), kind: 'session', label: s.label,
      props: {
        start: iso(s.startTimestamp), end: iso(s.endTimestamp),
        commitCount: s.commitCount, type: s.type, lane: s.lane,
        isMainBranch: s.isMainBranch, insertions: s.insertions, deletions: s.deletions,
        fileCount: s.fileCount, hasMilestone: s.hasMilestone, tagNames: s.tagNames,
      },
    })
  }

  for (const z of result.graph.zones) {
    b.node({
      id: nodeId.phase(z.id), kind: 'phase', label: z.label,
      props: {
        theme: z.theme, start: iso(z.startTimestamp), end: iso(z.endTimestamp),
        nodeCount: z.nodeCount,
      },
    })
  }

  // ── edges ──────────────────────────────────────────────
  for (const e of result.graph.edges) {
    const src = typeof e.source === 'string' ? e.source : e.source.id
    const tgt = typeof e.target === 'string' ? e.target : e.target.id
    if (e.type === 'revert_of') {
      b.edge('REVERTS', nodeId.commit(src), nodeId.commit(tgt))
    } else {
      // graph.edges は 親 → 子。PARENT は 子 → 親 で持つ（「この commit の親は」で辿れるように）
      b.edge('PARENT', nodeId.commit(tgt), nodeId.commit(src), { merge: e.type === 'merge_parent' })
    }
  }

  for (const n of nodes) {
    const cid = nodeId.commit(n.id)
    b.edge('AUTHORED', nodeId.author(n.authorName), cid)
    for (const t of n.tagNames) b.edge('TAGGED', nodeId.tag(t), cid)
    for (const f of n.files) if (isSignalFile(f)) b.edge('TOUCHES', cid, nodeId.file(f))
  }

  for (const e of result.struggles) {
    const sid = nodeId.struggle(e.id)
    for (const c of e.commits) b.edge('PART_OF', nodeId.commit(c.hash), sid)
    if (e.escape && byHash.has(e.escape.hash)) {
      b.edge('ESCAPED_BY', sid, nodeId.commit(e.escape.hash), { message: e.escape.message })
    }
    for (const f of e.files) b.edge('INVOLVES', sid, nodeId.file(f.path), { touches: f.touches })
    if (e.recurrence) {
      b.node({
        id: nodeId.file(e.recurrence.file), kind: 'file', label: e.recurrence.file,
        props: fileProps(e.recurrence.file, riskByPath.get(e.recurrence.file)?.risk),
      })
      b.edge('RECURS_ON', sid, nodeId.file(e.recurrence.file), {
        index: e.recurrence.index, times: e.recurrence.times, firstAt: iso(e.recurrence.firstAt),
      })
    }
  }

  const zones = result.graph.zones
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]
    const sid = nodeId.session(s.id)
    for (const h of s.commitHashes) b.edge('IN_SESSION', nodeId.commit(h), sid)
    const zone = zones.find(z => s.startTimestamp >= z.startTimestamp && s.startTimestamp <= z.endTimestamp)
    if (zone) b.edge('IN_PHASE', sid, nodeId.phase(zone.id))
    if (i > 0) b.edge('FOLLOWS', nodeId.session(sessions[i - 1].id), sid)
  }

  for (const h of result.hotspots) {
    b.edge('HOTSPOT_OF', nodeId.file(h.path), repoId, {
      risk: h.risk, commits: h.commits, fixCommits: h.fixCommits, fixRatio: h.fixRatio,
    })
  }

  return {
    repo: result.repoName,
    repoPath: result.repoPath,
    generatedAt: new Date().toISOString(),
    nodes: [...b.nodes.values()],
    edges: [...b.edges.values()],
  }
}

function fileProps(path: string, risk?: number): KProps {
  const name = path.split('/').pop() ?? path
  return {
    path,
    name,
    dir: path.slice(0, path.length - name.length).replace(/\/$/, ''),
    ext: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '',
    hotspotRisk: risk ?? null,
  }
}
