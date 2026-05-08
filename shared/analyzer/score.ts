import type { CommitNode, TrialScore, ScoreDetail } from '../types'

export function calculateScore(commits: CommitNode[]): TrialScore {
  const n = {
    revert:    commits.filter(c => c.type === 'revert').length,
    error_fix: commits.filter(c => c.type === 'error_fix').length,
    wip:       commits.filter(c => c.type === 'wip').length,
    merge:     commits.filter(c => c.type === 'merge').length,
    branches:  countUniqueBranches(commits),
  }

  const weights = {
    revert:    4,
    error_fix: 2,
    wip:       1,
    merge:     1,
    branches:  2,
  }

  const details: ScoreDetail[] = [
    { label: 'Revert / Reset',      count: n.revert,    weight: weights.revert,    subtotal: n.revert    * weights.revert    },
    { label: 'Fix / Bug / Hotfix',  count: n.error_fix, weight: weights.error_fix, subtotal: n.error_fix * weights.error_fix },
    { label: 'WIP / TODO / Draft',  count: n.wip,       weight: weights.wip,       subtotal: n.wip       * weights.wip       },
    { label: 'Merge Commits',       count: n.merge,     weight: weights.merge,     subtotal: n.merge     * weights.merge     },
    { label: 'Branch Divergences',  count: n.branches,  weight: weights.branches,  subtotal: n.branches  * weights.branches  },
  ]

  const total = details.reduce((acc, d) => acc + d.subtotal, 0)

  const level =
    total <= 10  ? 'clean'   :
    total <= 30  ? 'normal'  :
    total <= 60  ? 'messy'   :
                   'chaotic'

  return { total, level, details }
}

function countUniqueBranches(commits: CommitNode[]): number {
  const branches = new Set<string>()
  for (const c of commits) {
    for (const b of c.branchNames) {
      const base = b.replace(/^(origin\/|remotes\/origin\/)/, '')
      if (base && base !== 'HEAD') branches.add(base)
    }
  }
  return Math.max(0, branches.size - 1) // main/master を引く
}

export function generateSummary(commits: CommitNode[], score: TrialScore, repoName: string): string {
  if (commits.length === 0) return 'No commits found.'

  const sorted = [...commits].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const start = sorted[0].timestamp.toLocaleDateString('ja-JP')
  const end   = sorted[sorted.length - 1].timestamp.toLocaleDateString('ja-JP')

  const authors = [...new Set(commits.map(c => c.authorName))].join(', ')
  const totalFiles = commits.reduce((acc, c) => acc + c.filesChanged, 0)

  const levelText = {
    clean:   'クリーンな開発（試行錯誤は少ない）',
    normal:  '通常の開発（適度な試行錯誤あり）',
    messy:   '混沌とした開発（多くの修正・やり直し）',
    chaotic: '極めて混沌とした開発（大量の失敗・逆戻り）',
  }[score.level]

  return [
    `## ${repoName} 開発サマリー`,
    ``,
    `**期間**: ${start} 〜 ${end}`,
    `**総コミット数**: ${commits.length}件`,
    `**開発者**: ${authors}`,
    `**変更ファイル総数**: ${totalFiles}件`,
    ``,
    `### 試行錯誤スコア: ${score.total} (${levelText})`,
    ``,
    score.details.map(d => `- ${d.label}: ${d.count}件 × ${d.weight} = **${d.subtotal}点**`).join('\n'),
    ``,
    `### コミット分類`,
    `- 通常: ${commits.filter(c => c.type === 'normal').length}件`,
    `- 機能追加: ${commits.filter(c => c.type === 'feature').length}件`,
    `- バグ修正: ${commits.filter(c => c.type === 'error_fix').length}件`,
    `- リファクタリング: ${commits.filter(c => c.type === 'refactor').length}件`,
    `- テスト: ${commits.filter(c => c.type === 'test').length}件`,
    `- ドキュメント: ${commits.filter(c => c.type === 'docs').length}件`,
    `- 環境整備: ${commits.filter(c => c.type === 'chore').length}件`,
    `- リバート: ${commits.filter(c => c.type === 'revert').length}件`,
    `- マージ: ${commits.filter(c => c.type === 'merge').length}件`,
    `- WIP: ${commits.filter(c => c.type === 'wip').length}件`,
    `- リリース: ${commits.filter(c => c.type === 'release').length}件`,
  ].join('\n')
}
