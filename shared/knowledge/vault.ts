/**
 * Obsidian 向けの vault を組み立てる。
 *
 * 1リポジトリ = 1フォルダ。沼・ホットスポットはノート1枚ずつ、索引（README）から辿れる。
 * frontmatter は YAML。題名に `:` や `#` が入ると壊れるので文字列は必ず引用符で囲む。
 * wikilink は vault ルートからのパスで書く（`[[repo/struggles/id|題名]]`）。
 * 複数リポジトリを同じ vault に入れると `struggle_fix_chain_0` のような basename が
 * 衝突するので、basename だけのリンクにはしない。
 */
import type {
  AnalysisResult, KnowledgeGraph, KnowledgeChunk, VaultFile, StruggleEpisode, FileHotspot,
} from '../types'
import { struggleKindLabel } from '../analyzer/struggle'

type YamlValue = string | number | boolean | null | undefined | YamlValue[]

function yamlScalar(v: YamlValue): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(yamlScalar).join(', ')}]`
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
}

export function frontmatter(fields: Record<string, YamlValue>): string {
  const lines = ['---']
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    lines.push(`${k}: ${yamlScalar(v)}`)
  }
  lines.push('---')
  return lines.join('\n')
}

/** ファイルパスを1つのファイル名に畳む（`src/a.ts` → `src__a.ts`） */
export const fileSlug = (path: string): string =>
  path.replace(/\//g, '__').replace(/[^\w.\-　-鿿]/g, '_')

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10)
const when = (ts: number) => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')

export function buildVault(
  result: AnalysisResult, graph: KnowledgeGraph, chunks: KnowledgeChunk[],
): VaultFile[] {
  const repo = result.repoName
  const root = repo
  const link = {
    repo: () => `[[${root}/README|${repo}]]`,
    struggle: (e: StruggleEpisode) => `[[${root}/struggles/${e.id}|${e.title}]]`,
    hotspot: (path: string) => `[[${root}/hotspots/${fileSlug(path)}|${path}]]`,
    phases: () => `[[${root}/phases|開発フェーズ]]`,
    activity: () => `[[${root}/activity|働き方]]`,
  }
  const riskByPath = new Map(result.hotspots.map(h => [h.path, h]))
  const chunkById = new Map(chunks.map(c => [c.id, c]))
  const files: VaultFile[] = []
  const seen = new Set<string>()
  const push = (f: VaultFile) => {
    if (seen.has(f.path)) throw new Error(`vault のパスが重複: ${f.path}`)
    seen.add(f.path)
    files.push(f)
  }

  // ── README（索引）─────────────────────────────────────
  const s = result.stats
  const readme = [
    frontmatter({
      type: 'devmaze-repo', repo, kind: 'repo',
      path: result.repoPath, remote: result.remoteUrl ?? null,
      start: s.dateRange.start, end: s.dateRange.end,
      commits: s.totalCommits, score: result.score.total, level: result.score.level,
      struggles: result.struggles.length, hotspots: result.hotspots.length,
      generated: graph.generatedAt,
    }),
    '',
    `# ${repo}`,
    '',
    `DevMaze が ${graph.generatedAt.slice(0, 10)} に解析した開発過程。`,
    `${s.dateRange.start.slice(0, 10)} 〜 ${s.dateRange.end.slice(0, 10)}、${s.totalCommits} コミット、試行錯誤スコア ${result.score.total}（${result.score.level}）。`,
    s.fileStatsCoverage < 0.5
      ? `\n> ⚠️ ファイル差分の取得率が ${Math.round(s.fileStatsCoverage * 100)}% しかない。ファイルに依る沼・ホットスポットは出ていない可能性がある。`
      : '',
    '',
    `- ${link.phases()}`,
    `- ${link.activity()}`,
    `- グラフ: \`graph.nodes.jsonl\`（${graph.nodes.length} ノード）/ \`graph.edges.jsonl\`（${graph.edges.length} エッジ）`,
    `- RAG 用: \`chunks.jsonl\`（${chunks.length} 件）`,
    '',
    `## 沼（${result.struggles.length}件）`,
    '',
    result.struggles.length === 0 ? '- 検出なし' : '| 深刻度 | 種別 | 沼 | 期間 | 抜けた |',
    result.struggles.length === 0 ? '' : '|---:|---|---|---|:---:|',
    ...result.struggles.map(e =>
      `| ${e.severity} | ${struggleKindLabel(e.kind)} | ${link.struggle(e)} | ${day(e.startTimestamp)}〜${day(e.endTimestamp)} | ${e.escape ? '✓' : '−'} |`),
    '',
    `## ホットスポット（${result.hotspots.length}件）`,
    '',
    result.hotspots.length === 0 ? '- 検出なし' : '| risk | ファイル | 変更 | 修正率 |',
    result.hotspots.length === 0 ? '' : '|---:|---|---:|---:|',
    ...result.hotspots.map(h =>
      `| ${h.risk} | ${link.hotspot(h.path)} | ${h.commits} | ${Math.round(h.fixRatio * 100)}% |`),
    '',
    '## サマリー',
    '',
    result.summary,
  ].join('\n').replace(/\n{3,}/g, '\n\n')
  push({ path: `${root}/README.md`, content: readme })

  // ── 沼 ────────────────────────────────────────────────
  for (const e of result.struggles) {
    const chunk = chunkById.get(`chunk:struggle:${e.id}`)
    const body = chunk?.text ?? `# ${e.title}`
    const related = result.struggles
      .filter(o => o.id !== e.id && o.files.some(f => e.files.some(g => g.path === f.path)))
    const content = [
      frontmatter({
        type: 'devmaze-struggle', repo, kind: e.kind, id: e.id,
        title: e.title, severity: e.severity,
        files: e.files.map(f => f.path),
        start: new Date(e.startTimestamp).toISOString(),
        end: new Date(e.endTimestamp).toISOString(),
        escaped: !!e.escape,
        recurrence: e.recurrence?.times ?? 0,
        nightRatio: e.nightRatio,
        hashes: e.commits.map(c => c.hash),
      }),
      '',
      body,
      '',
      '## 関連',
      `- リポジトリ: ${link.repo()}`,
      ...e.files.filter(f => riskByPath.has(f.path)).map(f => `- ホットスポット: ${link.hotspot(f.path)}（risk ${riskByPath.get(f.path)!.risk}）`),
      ...related.slice(0, 8).map(o => `- 同じファイルの沼: ${link.struggle(o)}`),
      '',
      '## 教訓',
      '',
      '> まだ蒸留していない。`get_lesson_material` の出力から「状況 / 症状 / 試したこと / 効いたこと / 一般化した規則」を埋める。',
      '',
    ].join('\n')
    push({ path: `${root}/struggles/${e.id}.md`, content })
  }

  // ── ホットスポット ─────────────────────────────────────
  for (const h of result.hotspots) {
    const chunk = chunkById.get(`chunk:hotspot:${h.path}`)
    const related = result.struggles.filter(e => e.files.some(f => f.path === h.path))
    const content = [
      frontmatter({
        type: 'devmaze-hotspot', repo, kind: 'hotspot', file: h.path,
        risk: h.risk, commits: h.commits, fixCommits: h.fixCommits, fixRatio: h.fixRatio,
        authors: h.authors,
        start: new Date(h.firstTouched).toISOString(),
        end: new Date(h.lastTouched).toISOString(),
      }),
      '',
      chunk?.text ?? `# ${h.path}`,
      '',
      '## 関連',
      `- リポジトリ: ${link.repo()}`,
      ...related.map(e => `- 沼: ${link.struggle(e)}（深刻度 ${e.severity}）`),
      '',
    ].join('\n')
    push({ path: `${root}/hotspots/${fileSlug(h.path)}.md`, content })
  }

  // ── フェーズ・働き方 ───────────────────────────────────
  const phases = [
    frontmatter({ type: 'devmaze-phases', repo, kind: 'phase', count: result.graph.zones.length }),
    '',
    `# ${repo} の開発フェーズ`,
    '',
    `${link.repo()} に戻る`,
    '',
    ...result.graph.zones.flatMap(z => {
      const c = chunkById.get(`chunk:phase:${z.id}`)
      return [c ? c.text.replace(/^# .*\n/, `## ${z.label}（${day(z.startTimestamp)} 〜 ${day(z.endTimestamp)}）\n`) : `## ${z.label}`, '']
    }),
  ].join('\n')
  push({ path: `${root}/phases.md`, content: phases })

  const act = chunkById.get(`chunk:activity:${repo}`)
  push({
    path: `${root}/activity.md`,
    content: [
      frontmatter({
        type: 'devmaze-activity', repo, kind: 'activity',
        nightRatio: result.activity.nightRatio, weekendRatio: result.activity.weekendRatio,
        activeDays: result.activity.activeDays, spanDays: result.activity.spanDays,
      }),
      '',
      act?.text ?? `# ${repo} の働き方`,
      '',
      `${link.repo()} に戻る`,
      '',
    ].join('\n'),
  })

  // ── 機械向け ───────────────────────────────────────────
  push({ path: `${root}/graph.nodes.jsonl`, content: graph.nodes.map(n => JSON.stringify(n)).join('\n') + '\n' })
  push({ path: `${root}/graph.edges.jsonl`, content: graph.edges.map(e => JSON.stringify(e)).join('\n') + '\n' })
  push({ path: `${root}/chunks.jsonl`, content: chunks.map(c => JSON.stringify(c)).join('\n') + '\n' })

  return files
}

export { when as formatWhen }
export type { FileHotspot }
