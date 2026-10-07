/**
 * DevMaze MCP サーバー（stdio）。
 *
 * 解析はアプリと同じキャッシュ（shared/cache.ts）を通す。HEAD が同じなら即返るので、
 * ツールを続けて呼んでも 900 コミットを毎回解析し直さない（元はそうなっていた）。
 *
 * 既存8ツール（scan_repo / get_summary / get_score / get_struggles / get_struggle_diff /
 * get_hotspots / export_report / get_maze_graph）は名前・引数・返す内容を v0.6 と揃えてある。
 * 他のセッションが今も使っているため。
 *
 * 追加3ツール（export_knowledge / query_graph / get_lesson_material）はナレッジ層の出力口。
 * 沼を「読み物」から「検索できる単位」「辿れる関係」「蒸留できる素材」にする。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import path from 'node:path'
import fs from 'node:fs'
import { analyzeWithCache } from '../shared/cache'
import { formatStruggles } from '../shared/analyzer/struggle'
import { formatHotspots } from '../shared/analyzer/hotspot'
import { buildReport } from '../shared/analyzer/report'
import { getPatches } from '../shared/analyzer/diff'
import {
  buildKnowledgeExport, buildKnowledgeGraph, queryGraph, buildLessonMaterial,
} from '../shared/knowledge/index'
import type { GraphQuery } from '../shared/knowledge/index'
import type { AnalysisResult, KnowledgeGraph, StruggleKind, KNodeKind, KEdgeKind } from '../shared/types'

const server = new McpServer({ name: 'devmaze', version: '1.0.0' })

// ── 共通 ───────────────────────────────────────────────────
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

const text = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] })
const json = (v: unknown): ToolResult => text(JSON.stringify(v, null, 2))
const fail = (err: unknown): ToolResult => ({
  content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
  isError: true,
})

/** 例外を isError に変換する。ツール本体は投げてよい */
function guarded<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async args => {
    try { return await fn(args) } catch (err) { return fail(err) }
  }
}

async function load(repoPath: string): Promise<AnalysisResult> {
  return (await analyzeWithCache(path.resolve(repoPath))).data
}

// グラフはリポジトリごとに1回だけ組む（query_graph を続けて呼ぶとき用）
const graphMemo = new Map<string, { key: string; graph: KnowledgeGraph }>()
function graphOf(result: AnalysisResult): KnowledgeGraph {
  const key = `${result.stats.totalCommits}|${result.stats.dateRange.end}|${result.struggles.length}`
  const hit = graphMemo.get(result.repoPath)
  if (hit && hit.key === key) return hit.graph
  const graph = buildKnowledgeGraph(result)
  graphMemo.set(result.repoPath, { key, graph })
  if (graphMemo.size > 8) graphMemo.delete(graphMemo.keys().next().value!)
  return graph
}

const repoPath = z.string().describe('Git リポジトリのパス（絶対パス。bare リポジトリでも可）')

const STRUGGLE_KINDS = ['revert_loop', 'fix_chain', 'file_churn', 'wip_drift', 'stall_burst'] as const
const NODE_KINDS = ['repo', 'commit', 'file', 'struggle', 'session', 'phase', 'author', 'tag'] as const
const EDGE_KINDS = [
  'PARENT', 'REVERTS', 'TOUCHES', 'AUTHORED', 'TAGGED', 'PART_OF', 'ESCAPED_BY',
  'INVOLVES', 'RECURS_ON', 'IN_SESSION', 'IN_PHASE', 'HOTSPOT_OF', 'FOLLOWS',
] as const

// ── 既存ツール（v0.6 互換）────────────────────────────────

server.registerTool('scan_repo', {
  title: 'リポジトリを解析',
  description:
    'Git リポジトリを解析して、統計・試行錯誤スコア・ノード数・沼の件数の概要を返す。' +
    '最初に呼んで、そのリポジトリがどのくらい荒れているかを掴むためのもの。',
  inputSchema: { repo_path: repoPath },
}, guarded(async ({ repo_path }) => {
  const r = await load(repo_path)
  return json({
    repoName: r.repoName,
    stats: r.stats,
    score: r.score,
    nodeCount: r.graph.nodes.length,
    edgeCount: r.graph.edges.length,
    struggleCount: r.struggles.length,
    hotspotCount: r.hotspots.length,
  })
}))

server.registerTool('get_summary', {
  title: '開発サマリー',
  description: '期間・コミット数・開発者・スコア・コミット分類の内訳を Markdown で返す。人に読ませる1枚目。',
  inputSchema: { repo_path: repoPath },
}, guarded(async ({ repo_path }) => text((await load(repo_path)).summary)))

server.registerTool('get_score', {
  title: '試行錯誤スコア',
  description: '試行錯誤スコア（revert×4 + fix×2 + WIP×1 + merge×1 + branch×2）と内訳を返す。',
  inputSchema: { repo_path: repoPath },
}, guarded(async ({ repo_path }) => {
  const s = (await load(repo_path)).score
  const levelEmoji = { clean: '✅', normal: '🟡', messy: '🟠', chaotic: '🔴' }[s.level]
  return text([
    `# 試行錯誤スコア: ${s.total} ${levelEmoji}`,
    `レベル: ${s.level}`,
    ``,
    `## 内訳`,
    ...s.details.map(d => `- ${d.label}: ${d.count}件 × ${d.weight}点 = **${d.subtotal}点**`),
  ].join('\n'))
}))

server.registerTool('get_struggles', {
  title: '沼（詰まった箇所）',
  description:
    '開発履歴から「詰まった箇所（沼）」を個別のエピソードとして返す。' +
    'やり直しの輪 / 修正の連鎖 / 同じファイルの往復 / WIP の漂流 / 停滞のあとの再開 を、' +
    '該当コミット・関与ファイル・判定根拠・抜けた印つきで。「どこで何回詰まったか」を知りたいときに。',
  inputSchema: {
    repo_path: repoPath,
    format: z.enum(['markdown', 'json']).optional().describe('出力形式（既定 markdown）'),
    min_severity: z.number().min(0).max(100).optional().describe('この深刻度未満を除外（0-100、既定 0）'),
    limit: z.number().int().min(1).optional().describe('最大件数（既定 10）'),
    kind: z.enum(STRUGGLE_KINDS).optional().describe('種別で絞る（省略時は全種別）'),
  },
}, guarded(async ({ repo_path, format, min_severity, limit, kind }) => {
  const r = await load(repo_path)
  const episodes = r.struggles
    .filter(e => e.severity >= (min_severity ?? 0))
    .filter(e => !kind || e.kind === (kind as StruggleKind))
    .slice(0, limit ?? 10)
  if (format === 'json') return json(episodes)
  return text(formatStruggles(episodes, r.repoName, r.stats.fileStatsCoverage))
}))

const diffArgs = {
  struggle_id: z.string().optional().describe('対象の沼の id（get_struggles の id）。省略時は最も深刻なもの'),
  only_struggle_files: z.boolean().optional().describe('その沼の関与ファイルだけに絞る（既定 true）。false だと量が数倍になる'),
  max_commits: z.number().int().min(1).optional().describe('差分を読むコミット数の上限（既定 12）'),
  max_lines_per_file: z.number().int().min(10).optional().describe('1ファイルあたりの最大行数（既定 200）'),
  context: z.number().int().min(0).optional().describe('差分の文脈行数（既定 1）'),
}

async function episodeAndPatches(
  r: AnalysisResult, a: {
    struggle_id?: string; only_struggle_files?: boolean
    max_commits?: number; max_lines_per_file?: number; context?: number
  },
) {
  const episode = a.struggle_id
    ? r.struggles.find(e => e.id === a.struggle_id)
    : [...r.struggles].sort((x, y) => y.severity - x.severity)[0]
  if (!episode) {
    const why = a.struggle_id
      ? `沼 ${a.struggle_id} が見つかりません。get_struggles で id を確認してください。`
      : '沼は検出されていません。' + (r.stats.fileStatsCoverage < 0.5
        ? `ただしファイル差分の取得率が ${Math.round(r.stats.fileStatsCoverage * 100)}% しかないため、` +
          '「無い」のか「見えていない」のか判断できません（shallow clone の可能性）。'
        : '')
    return { episode: undefined, patches: [], maxCommits: 0, why }
  }
  const maxCommits = a.max_commits ?? 12
  const onlyPaths = (a.only_struggle_files ?? true) ? episode.files.map(f => f.path) : undefined
  const used = episode.commits.map(c => c.hash).slice(0, maxCommits)
  const patches = await getPatches(r.repoPath, used, {
    onlyPaths,
    maxLinesPerFile: a.max_lines_per_file ?? 200,
    context: a.context ?? 1,
  })
  return { episode, patches, maxCommits, why: '' }
}

server.registerTool('get_struggle_diff', {
  title: '沼の差分',
  description:
    '沼で実際に書かれたコードの差分を返す。get_struggles は「どこで何回詰まったか」まで、' +
    'こちらは「技術的に何を試して何が効いたか」。ノイズ（lock・dist）は除き、量が多ければ削って削ったことを明記する。' +
    '取れなかったファイルは理由つきで返す（GitHub キャッシュは 100KB 以上の中身を持たない）。',
  inputSchema: { repo_path: repoPath, ...diffArgs },
}, guarded(async ({ repo_path, ...a }) => {
  const r = await load(repo_path)
  const { episode, patches, maxCommits, why } = await episodeAndPatches(r, a)
  if (!episode) return text(why)
  return text(buildLessonMaterial(r, episode, patches, {
    includeTimeline: false, includeTemplate: false, maxCommits,
  }))
}))

server.registerTool('get_hotspots', {
  title: 'ホットスポット',
  description:
    '荒れているファイル（よく変わる × 直してばかり × 触る人が多い）を risk 順に返す。' +
    '沼が時間軸の詰まりなのに対し、こちらは場所の軸。',
  inputSchema: {
    repo_path: repoPath,
    format: z.enum(['markdown', 'json']).optional().describe('出力形式（既定 markdown）'),
    limit: z.number().int().min(1).optional().describe('最大件数（既定 15）'),
  },
}, guarded(async ({ repo_path, format, limit }) => {
  const r = await load(repo_path)
  const hotspots = r.hotspots.slice(0, limit ?? 15)
  if (format === 'json') return json(hotspots)
  return text(formatHotspots(hotspots, r.repoName))
}))

server.registerTool('export_report', {
  title: '開発過程レポート',
  description:
    'サマリー・スコア・沼・ホットスポット・働き方を1本の Markdown にまとめて返す。' +
    '開発過程をノートや記憶に資産として取り込むための出力口。',
  inputSchema: {
    repo_path: repoPath,
    struggle_limit: z.number().int().min(0).optional().describe('沼の最大件数（既定 10）'),
    hotspot_limit: z.number().int().min(0).optional().describe('ホットスポットの最大件数（既定 15）'),
  },
}, guarded(async ({ repo_path, struggle_limit, hotspot_limit }) => {
  const r = await load(repo_path)
  return text(buildReport(r, { struggleLimit: struggle_limit ?? 10, hotspotLimit: hotspot_limit ?? 15 }))
}))

server.registerTool('get_maze_graph', {
  title: '迷路グラフ',
  description: 'コミットグラフ（ノードとエッジ）を JSON で返す。自前で描画や集計をしたいときに。',
  inputSchema: {
    repo_path: repoPath,
    limit: z.number().int().min(1).optional().describe('最大ノード数（既定 200）'),
  },
}, guarded(async ({ repo_path, limit }) => {
  const r = await load(repo_path)
  const nodes = r.graph.nodes.slice(0, limit ?? 200)
  const ids = new Set(nodes.map(n => n.id))
  const edges = r.graph.edges.filter(e => {
    const s = typeof e.source === 'string' ? e.source : e.source.id
    const t = typeof e.target === 'string' ? e.target : e.target.id
    return ids.has(s) && ids.has(t)
  })
  return json({ nodes, edges })
}))

// ── ナレッジ層 ─────────────────────────────────────────────

const INLINE_LIMIT = 200 * 1024

server.registerTool('export_knowledge', {
  title: 'ナレッジ出力（RAG / GraphRAG）',
  description:
    '解析結果を知識の形で出す。vault は Obsidian 向けの Markdown（沼・ホットスポット1枚ずつ＋索引）、' +
    'jsonl は property graph（nodes / edges）と RAG 用 chunks。out_dir を渡せばそこへ書き、' +
    '無ければインラインで返す（200KB を超える分は削って、削ったことを明記する）。' +
    '開発履歴をベクトル DB やグラフ DB に入れたいとき、Obsidian で読みたいときに。',
  inputSchema: {
    repo_path: repoPath,
    out_dir: z.string().optional().describe('書き出し先のフォルダ（絶対パス）。その下に <repo>/ が作られる'),
    format: z.enum(['vault', 'jsonl', 'both']).optional().describe('vault=Markdown だけ / jsonl=graph と chunks だけ / both（既定）'),
  },
}, guarded(async ({ repo_path, out_dir, format }) => {
  const r = await load(repo_path)
  const fmt = format ?? 'both'
  const k = buildKnowledgeExport(r)
  const wanted = k.vault.filter(f =>
    fmt === 'both' ? true : fmt === 'vault' ? f.path.endsWith('.md') : f.path.endsWith('.jsonl'))

  if (out_dir) {
    const root = path.resolve(out_dir)
    const written: { path: string; bytes: number }[] = []
    for (const f of wanted) {
      const full = path.join(root, f.path)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, f.content, 'utf-8')
      written.push({ path: f.path, bytes: Buffer.byteLength(f.content, 'utf-8') })
    }
    return json({
      repo: r.repoName,
      outDir: root,
      files: written.length,
      bytes: written.reduce((a, w) => a + w.bytes, 0),
      counts: { nodes: k.graph.nodes.length, edges: k.graph.edges.length, chunks: k.chunks.length },
      written,
    })
  }

  // インライン: 大きければ段階的に削る。まず vault の本文、次に「いちばん大きい配列」を半分に。
  // 削った配列は元の件数とともに truncated に書く（黙って減らさない）
  const payload: Record<string, unknown> = {
    repo: r.repoName,
    generatedAt: k.graph.generatedAt,
    counts: { nodes: k.graph.nodes.length, edges: k.graph.edges.length, chunks: k.chunks.length, vaultFiles: wanted.length },
    truncated: [] as string[],
  }
  if (fmt !== 'vault') { payload.graph = { nodes: k.graph.nodes, edges: k.graph.edges }; payload.chunks = k.chunks }
  if (fmt !== 'jsonl') payload.vault = wanted.filter(f => f.path.endsWith('.md'))

  // インラインは詰めた JSON で返す（整形すると同じ中身で 25% 太る）
  const size = () => Buffer.byteLength(JSON.stringify(payload), 'utf-8')
  const cuts = payload.truncated as string[]
  if (size() > INLINE_LIMIT && Array.isArray(payload.vault) && payload.vault.length > 0) {
    payload.vault = (payload.vault as { path: string }[]).map(f => ({ path: f.path }))
    cuts.push('vault の本文を落としてパス一覧だけにした（out_dir を渡せば全文を書き出す）')
  }
  const arrays: { label: string; obj: Record<string, unknown>; key: string; orig: number }[] = []
  const graph = payload.graph as Record<string, unknown> | undefined
  if (graph) {
    arrays.push({ label: 'graph.edges', obj: graph, key: 'edges', orig: k.graph.edges.length })
    arrays.push({ label: 'graph.nodes', obj: graph, key: 'nodes', orig: k.graph.nodes.length })
  }
  if (payload.chunks) arrays.push({ label: 'chunks', obj: payload, key: 'chunks', orig: k.chunks.length })
  const cutIndex = new Map<string, number>()
  for (let guard = 0; guard < 40 && size() > INLINE_LIMIT; guard++) {
    // 今いちばん場所を食っている配列を半分にする
    let best: typeof arrays[number] | null = null
    let bestBytes = 0
    for (const a of arrays) {
      const arr = a.obj[a.key] as unknown[]
      if (arr.length <= 1) continue
      const bytes = JSON.stringify(arr).length
      if (bytes > bestBytes) { best = a; bestBytes = bytes }
    }
    if (!best) break
    const arr = best.obj[best.key] as unknown[]
    const next = Math.max(1, Math.floor(arr.length / 2))
    best.obj[best.key] = arr.slice(0, next)
    const msg = `${best.label} を先頭 ${next} 件に切った（全 ${best.orig} 件。out_dir を渡せば全部書き出す）`
    const i = cutIndex.get(best.label)
    if (i === undefined) { cutIndex.set(best.label, cuts.length); cuts.push(msg) } else cuts[i] = msg
  }
  return text(JSON.stringify(payload))
}))

server.registerTool('query_graph', {
  title: 'ナレッジグラフを辿る',
  description:
    '解析結果の property graph をプロセス内で辿る。op=find（種別・文字でノード検索）、' +
    'op=neighbors（あるノードの近傍。edge_kind / direction / depth で絞る）、op=path（2ノード間の最短経路）。' +
    '「このファイルを触った沼は」「この著者からこのファイルまでどうつながるか」のような多段の問いに。' +
    'ノード id は commit:<hash> / file:<path> / struggle:<id> / session:<id> / phase:<id> / author:<name> / tag:<name> / repo:<name>。',
  inputSchema: {
    repo_path: repoPath,
    op: z.enum(['find', 'neighbors', 'path']).describe('操作'),
    node_id: z.string().optional().describe('neighbors の起点ノード id'),
    kind: z.enum(NODE_KINDS).optional().describe('find のノード種別'),
    edge_kind: z.enum(EDGE_KINDS).optional().describe('neighbors で辿るエッジ種別'),
    direction: z.enum(['out', 'in', 'both']).optional().describe('neighbors の方向（既定 both）'),
    depth: z.number().int().min(1).max(3).optional().describe('neighbors の深さ 1〜3（既定 1）'),
    text: z.string().optional().describe('find の部分一致（label / id）'),
    from: z.string().optional().describe('path の始点ノード id'),
    to: z.string().optional().describe('path の終点ノード id'),
    max_depth: z.number().int().min(1).max(8).optional().describe('path の最大段数（既定 4）'),
    limit: z.number().int().min(1).max(500).optional().describe('返すノード数の上限（既定 50）'),
  },
}, guarded(async ({ repo_path, op, ...a }) => {
  const r = await load(repo_path)
  const graph = graphOf(r)
  let q: GraphQuery
  if (op === 'find') {
    q = { op, kind: a.kind as KNodeKind | undefined, text: a.text, limit: a.limit }
  } else if (op === 'neighbors') {
    if (!a.node_id) throw new Error('neighbors には node_id が要る')
    q = { op, node_id: a.node_id, edge_kind: a.edge_kind as KEdgeKind | undefined,
          direction: a.direction, depth: a.depth, limit: a.limit }
  } else {
    if (!a.from || !a.to) throw new Error('path には from と to が要る')
    q = { op, from: a.from, to: a.to, max_depth: a.max_depth }
  }
  return json(queryGraph(graph, q))
}))

server.registerTool('get_lesson_material', {
  title: '教訓の素材',
  description:
    '沼を「教訓」に蒸留するための素材を1本の Markdown で返す。沼の要約と根拠、関与ファイルと risk、' +
    'コミット列、実際の差分、最後に埋めるべき雛形（状況 / 症状 / 試したこと / 効いたこと / 一般化した規則 / 根拠へのリンク）。' +
    '受け取った側が雛形を埋めると、次に同じ場所を触るときに効く形になる。',
  inputSchema: { repo_path: repoPath, ...diffArgs },
}, guarded(async ({ repo_path, ...a }) => {
  const r = await load(repo_path)
  const { episode, patches, maxCommits, why } = await episodeAndPatches(r, a)
  if (!episode) return text(why)
  return text(buildLessonMaterial(r, episode, patches, { maxCommits }))
}))

// ── 起動 ───────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('DevMaze MCP server running (stdio)\n')
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`)
  process.exit(1)
})
