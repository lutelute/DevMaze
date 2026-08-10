import type { CommitNode, FileHotspot } from '../types'
import { signalFiles, isFocused } from './paths'

// ===================================================================
// ファイルホットスポット
//
// 「どこが荒れているか」をファイル単位で出す。沼（時間軸の詰まり）に対して、
// こちらは場所の軸。よく変わる × 直してばかり × 触る人が多い ほど危険とみなす。
//
// 変更が多いだけのファイル（活発に育っているファイル）と、
// 直してばかりのファイル（壊れやすいファイル）を混ぜないよう、
// 修正比率を独立した項として持たせている。
// ===================================================================

const DAY = 24 * 3600_000

interface Acc {
  commits: CommitNode[]
  fixCommits: number
  insertions: number
  deletions: number
  authors: Set<string>
}

export function detectHotspots(commits: CommitNode[], limit = 30): FileHotspot[] {
  const byFile = new Map<string, Acc>()

  for (const c of commits) {
    // なぎ払いコミット（初回インポート・一括整形）は全ファイルに等しく乗るので除外
    if (!isFocused(c)) continue
    for (const f of new Set(signalFiles(c))) {
      let acc = byFile.get(f)
      if (!acc) {
        acc = { commits: [], fixCommits: 0, insertions: 0, deletions: 0, authors: new Set() }
        byFile.set(f, acc)
      }
      acc.commits.push(c)
      if (c.type === 'error_fix' || c.type === 'revert') acc.fixCommits++
      // 変更行はコミット全体の値しか無いので、ファイル数で按分する
      acc.insertions += Math.round(c.insertions / Math.max(1, c.filesChanged))
      acc.deletions  += Math.round(c.deletions  / Math.max(1, c.filesChanged))
      acc.authors.add(c.authorName)
    }
  }

  // 履歴が長いリポジトリでは 2回変更のファイルは母数として弱すぎる
  const minCommits = commits.length >= 100 ? 3 : 2
  const entries = [...byFile.entries()].filter(([, a]) => a.commits.length >= minCommits)
  if (entries.length === 0) return []

  const maxCommits = Math.max(...entries.map(([, a]) => a.commits.length))
  const maxAuthors = Math.max(...entries.map(([, a]) => a.authors.size))
  const newest = Math.max(...commits.map(c => c.timestamp.getTime()))
  const oldest = Math.min(...commits.map(c => c.timestamp.getTime()))
  const span = Math.max(1, newest - oldest)

  // 修正率の事前分布（リポジトリ全体の修正コミット比率）。
  // 「2回変更して2回とも修正 = 100%」のような小さすぎる母数を、そのまま最悪値に
  // しないための平滑化に使う。
  const globalFixRate = commits.length === 0
    ? 0
    : commits.filter(c => c.type === 'error_fix' || c.type === 'revert').length / commits.length
  const PRIOR = 3   // 仮想的に「平均的なファイル」を3回分足す

  const hotspots: FileHotspot[] = entries.map(([path, a]) => {
    const times = a.commits.map(c => c.timestamp.getTime())
    const lastTouched = Math.max(...times)
    const firstTouched = Math.min(...times)
    const fixRatio = a.fixCommits / a.commits.length
    const smoothedFixRatio =
      (a.fixCommits + PRIOR * globalFixRate) / (a.commits.length + PRIOR)

    // 1ファイルだけ極端に多い（ログ・台帳など）と線形正規化では他が潰れるので対数で並べる
    const normChurn   = Math.log1p(a.commits.length) / Math.log1p(maxCommits)
    const normAuthors = maxAuthors > 1 ? (a.authors.size - 1) / (maxAuthors - 1) : 0
    const recency     = (lastTouched - oldest) / span   // 直近ほど 1 に近い

    const risk = Math.round(
      100 * (0.35 * normChurn + 0.45 * smoothedFixRatio + 0.12 * normAuthors + 0.08 * recency)
    )

    const reasons: string[] = []
    if (normChurn >= 0.8) reasons.push(`変更回数が最多クラス（${a.commits.length}回）`)
    if (fixRatio >= 0.4 && a.commits.length >= 3) {
      reasons.push(`変更の ${Math.round(fixRatio * 100)}% が修正・やり直し（${a.fixCommits}/${a.commits.length}）`)
    }
    if (a.authors.size >= 3) reasons.push(`${a.authors.size}人が触っている`)
    if (newest - lastTouched <= 7 * DAY) reasons.push('直近1週間以内にも変更')
    if (reasons.length === 0) reasons.push(`変更 ${a.commits.length}回 / 修正 ${a.fixCommits}回`)

    return {
      path,
      commits: a.commits.length,
      fixCommits: a.fixCommits,
      fixRatio: Math.round(fixRatio * 100) / 100,
      authors: a.authors.size,
      insertions: a.insertions,
      deletions: a.deletions,
      firstTouched,
      lastTouched,
      risk: Math.max(1, Math.min(100, risk)),
      reasons,
    }
  })

  return hotspots
    .sort((a, b) => b.risk - a.risk || b.commits - a.commits || a.path.localeCompare(b.path))
    .slice(0, limit)
}

export function formatHotspots(hotspots: FileHotspot[], repoName: string): string {
  if (hotspots.length === 0) {
    return `## ${repoName} のホットスポット\n\n検出なし（ファイル単位の差分が取得できていないか、変更が分散しています）。`
  }

  const lines = [
    `## ${repoName} のホットスポット（${hotspots.length}件）`,
    ``,
    `よく変わる × 直してばかり × 触る人が多い ファイルほど上位。risk は 0-100。`,
    ``,
    `| risk | ファイル | 変更 | 修正 | 修正率 | 著者 | 根拠 |`,
    `|-----:|---------|-----:|-----:|-------:|-----:|------|`,
  ]

  for (const h of hotspots) {
    lines.push(
      `| ${h.risk} | \`${h.path}\` | ${h.commits} | ${h.fixCommits} | ${Math.round(h.fixRatio * 100)}% | ${h.authors} | ${h.reasons.join(' / ')} |`
    )
  }

  return lines.join('\n')
}
