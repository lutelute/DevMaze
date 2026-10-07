/**
 * RAG の単位（chunk）を切り出す。
 *
 * 1件で自己完結し、出所（どのリポジトリの、どのコミット群か）を必ず持つ。
 * 単位は「沼のエピソード」が中心。症状の根拠・関与ファイル・コミット列・抜けた印が
 * 揃っていて、それだけ読めば「前にも似た場所で詰まったか」に答えられる。
 */
import type {
  AnalysisResult, KnowledgeChunk, StruggleEpisode, FileHotspot, Zone, ActivityProfile,
} from '../types'
import { struggleKindLabel } from '../analyzer/struggle'

const HOUR = 3600_000
const DAY = 24 * HOUR

const iso = (ts: number) => new Date(ts).toISOString()
const day = (ts: number) => new Date(ts).toISOString().slice(0, 10)
const when = (ts: number) => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')

function duration(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60000))}分`
  if (ms < DAY) return `${Math.round(ms / HOUR)}時間`
  return `${Math.round(ms / DAY)}日`
}

export function buildChunks(result: AnalysisResult): KnowledgeChunk[] {
  const generatedAt = new Date().toISOString()
  const base = { repoPath: result.repoPath, generatedAt }
  const riskByPath = new Map(result.hotspots.map(h => [h.path, h.risk]))

  const chunks: KnowledgeChunk[] = []

  chunks.push(repoChunk(result, base))
  for (const e of result.struggles) chunks.push(struggleChunk(result, e, riskByPath, base))
  for (const h of result.hotspots) chunks.push(hotspotChunk(result, h, base))
  for (const z of result.graph.zones) chunks.push(phaseChunk(result, z, base))
  chunks.push(activityChunk(result, result.activity, base))

  return chunks
}

type Base = { repoPath: string; generatedAt: string }

function repoChunk(result: AnalysisResult, base: Base): KnowledgeChunk {
  const s = result.stats
  const a = result.activity
  const top = result.hotspots.slice(0, 5).map(h => `${h.path}（risk ${h.risk}）`)
  const worst = [...result.struggles].sort((x, y) => y.severity - x.severity).slice(0, 5)
    .map(e => `${e.title}（深刻度 ${e.severity}）`)
  const text = [
    `# ${result.repoName} の開発過程`,
    '',
    `- 期間: ${s.dateRange.start.slice(0, 10)} 〜 ${s.dateRange.end.slice(0, 10)}`,
    `- コミット: ${s.totalCommits}件 / ブランチ: ${s.branchCount} / 著者: ${s.authors.join(', ')}`,
    `- 内訳: マージ ${s.mergeCount} / リバート ${s.revertCount} / バグ修正 ${s.errorFixCount} / WIP ${s.wipCount}`,
    `- 試行錯誤スコア: ${result.score.total}（${result.score.level}）`,
    `- 沼: ${result.struggles.length}件 / ホットスポット: ${result.hotspots.length}件`,
    `- 働き方: 稼働 ${a.activeDays}日 / ${a.spanDays}日、夜間 ${Math.round(a.nightRatio * 100)}%、週末 ${Math.round(a.weekendRatio * 100)}%`,
    `- ファイル差分の取得率: ${Math.round(s.fileStatsCoverage * 100)}%`,
    '',
    worst.length ? `## 深刻な沼\n${worst.map(w => `- ${w}`).join('\n')}` : '',
    '',
    top.length ? `## 荒れているファイル\n${top.map(t => `- ${t}`).join('\n')}` : '',
    '',
    result.summary,
  ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim()

  return {
    id: `chunk:repo:${result.repoName}`,
    kind: 'repo',
    title: `${result.repoName} の開発過程`,
    text,
    metadata: {
      repo: result.repoName, kind: 'repo', files: [],
      start: s.dateRange.start, end: s.dateRange.end,
      totalCommits: s.totalCommits, score: result.score.total, level: result.score.level,
    },
    provenance: { ...base, hashes: result.graph.nodes.map(n => n.id) },
  }
}

function struggleChunk(
  result: AnalysisResult, e: StruggleEpisode, riskByPath: Map<string, number>, base: Base,
): KnowledgeChunk {
  const files = e.files.map(f => f.path)
  const lines = [
    `# ${e.title}`,
    '',
    `- リポジトリ: ${result.repoName}`,
    `- 種別: ${struggleKindLabel(e.kind)}（${e.kind}） / 深刻度: ${e.severity}`,
    `- 期間: ${when(e.startTimestamp)} 〜 ${when(e.endTimestamp)}（${duration(e.endTimestamp - e.startTimestamp)}、${e.commits.length}コミット）`,
    `- 夜間（22-5時）の割合: ${Math.round(e.nightRatio * 100)}%`,
    e.recurrence
      ? `- 再発: ${e.recurrence.file} で ${e.recurrence.times} 回のうち ${e.recurrence.index} 回目（初回 ${day(e.recurrence.firstAt)}）`
      : '- 再発: なし',
    e.escape
      ? `- 抜けた印: ${e.escape.shortHash} ${e.escape.message}（${when(e.escape.timestamp)}）`
      : '- 抜けた印: なし（同じ場所に前進コミットが続いていない）',
    '',
    '## 判定根拠',
    ...e.evidence.map(v => `- ${v}`),
    '',
    '## 関与ファイル',
    ...(e.files.length
      ? e.files.map(f => {
        const r = riskByPath.get(f.path)
        return `- ${f.path}（${f.touches}回${r !== undefined ? `、ホットスポット risk ${r}` : ''}）`
      })
      : ['- （ファイル単位の差分が取れていない）']),
    '',
    '## コミット列',
    ...e.commits.map(c => `- ${when(c.timestamp)} ${c.shortHash} [${c.type}] ${c.message}`),
  ]

  return {
    id: `chunk:struggle:${e.id}`,
    kind: 'struggle',
    title: e.title,
    text: lines.join('\n'),
    metadata: {
      repo: result.repoName, kind: 'struggle',
      severity: e.severity, struggleKind: e.kind, files,
      start: iso(e.startTimestamp), end: iso(e.endTimestamp),
      escaped: !!e.escape,
      recurrence: e.recurrence?.times ?? 0,
      nightRatio: e.nightRatio,
      commitCount: e.commits.length,
    },
    provenance: { ...base, hashes: e.commits.map(c => c.hash) },
  }
}

function hotspotChunk(result: AnalysisResult, h: FileHotspot, base: Base): KnowledgeChunk {
  const related = result.struggles
    .filter(e => e.files.some(f => f.path === h.path))
    .map(e => `- ${e.title}（深刻度 ${e.severity}、${day(e.startTimestamp)}〜）`)
  const touching = result.graph.nodes.filter(n => n.files.includes(h.path)).map(n => n.id)
  const lines = [
    `# ${h.path}`,
    '',
    `- リポジトリ: ${result.repoName}`,
    `- ホットスポット risk: ${h.risk}（0-100）`,
    `- 変更 ${h.commits}回 / うち修正・やり直し ${h.fixCommits}回（${Math.round(h.fixRatio * 100)}%） / 著者 ${h.authors}人`,
    `- 期間: ${day(h.firstTouched)} 〜 ${day(h.lastTouched)}`,
    `- 変更行（按分）: +${h.insertions} / -${h.deletions}`,
    '',
    '## 根拠',
    ...h.reasons.map(r => `- ${r}`),
    '',
    related.length ? `## このファイルで起きた沼\n${related.join('\n')}` : '## このファイルで起きた沼\n- なし',
  ]
  return {
    id: `chunk:hotspot:${h.path}`,
    kind: 'hotspot',
    title: `${h.path} のホットスポット`,
    text: lines.join('\n'),
    metadata: {
      repo: result.repoName, kind: 'hotspot', files: [h.path],
      start: iso(h.firstTouched), end: iso(h.lastTouched),
      risk: h.risk, commits: h.commits, fixCommits: h.fixCommits, fixRatio: h.fixRatio, authors: h.authors,
    },
    provenance: { ...base, hashes: touching },
  }
}

function phaseChunk(result: AnalysisResult, z: Zone, base: Base): KnowledgeChunk {
  const inZone = result.graph.nodes.filter(n => n.timestamp >= z.startTimestamp && n.timestamp <= z.endTimestamp)
  const counts = new Map<string, number>()
  for (const n of inZone) counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
  const breakdown = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} ${c}`).join(', ')
  const struggles = result.struggles.filter(e => e.startTimestamp <= z.endTimestamp && e.endTimestamp >= z.startTimestamp)
  const lines = [
    `# ${result.repoName} の開発フェーズ: ${z.label}`,
    '',
    `- 期間: ${day(z.startTimestamp)} 〜 ${day(z.endTimestamp)}（${duration(z.endTimestamp - z.startTimestamp)}）`,
    `- 支配的な種別: ${z.theme} / コミット ${z.nodeCount}件`,
    `- 内訳: ${breakdown || 'なし'}`,
    `- この期間に重なる沼: ${struggles.length}件`,
    ...struggles.slice(0, 8).map(e => `  - ${e.title}（深刻度 ${e.severity}）`),
  ]
  return {
    id: `chunk:phase:${z.id}`,
    kind: 'phase',
    title: `${z.label}（${day(z.startTimestamp)}〜）`,
    text: lines.join('\n'),
    metadata: {
      repo: result.repoName, kind: 'phase', files: [],
      start: iso(z.startTimestamp), end: iso(z.endTimestamp),
      theme: z.theme, nodeCount: z.nodeCount,
    },
    provenance: { ...base, hashes: inZone.map(n => n.id) },
  }
}

function activityChunk(result: AnalysisResult, a: ActivityProfile, base: Base): KnowledgeChunk {
  const WD = ['日', '月', '火', '水', '木', '金', '土']
  const peakHour = a.byHour.indexOf(Math.max(...a.byHour))
  const peakDay = a.byWeekday.indexOf(Math.max(...a.byWeekday))
  const lines = [
    `# ${result.repoName} の働き方`,
    '',
    `- 稼働日数: ${a.activeDays}日 / 期間 ${a.spanDays}日（稼働日1日あたり ${a.commitsPerActiveDay} コミット）`,
    `- よく書く時間帯: ${peakHour}時台 / よく書く曜日: ${WD[peakDay]}曜`,
    `- 夜間（22-5時）: ${Math.round(a.nightRatio * 100)}% / 週末: ${Math.round(a.weekendRatio * 100)}%`,
    `- 最長の連続稼働: ${a.longestStreakDays}日 / 最長の空白: ${a.longestBreakDays}日`,
    a.busiestDay ? `- いちばん書いた日: ${a.busiestDay.date}（${a.busiestDay.count}コミット）` : '',
    '',
    `- 時間帯の分布（0-23時）: ${a.byHour.join(', ')}`,
    `- 曜日の分布（日-土）: ${a.byWeekday.join(', ')}`,
    '',
    a.authors.length ? '## 著者' : '',
    ...a.authors.map(x => `- ${x.name}: ${x.commits}コミット（修正 ${x.fixCommits}）、+${x.insertions} / -${x.deletions}、${day(x.firstSeen)}〜${day(x.lastSeen)}`),
  ].filter(l => l !== '')
  return {
    id: `chunk:activity:${result.repoName}`,
    kind: 'activity',
    title: `${result.repoName} の働き方`,
    text: lines.join('\n'),
    metadata: {
      repo: result.repoName, kind: 'activity', files: [],
      start: result.stats.dateRange.start, end: result.stats.dateRange.end,
      nightRatio: a.nightRatio, weekendRatio: a.weekendRatio,
      activeDays: a.activeDays, spanDays: a.spanDays,
    },
    provenance: { ...base, hashes: [] },
  }
}
