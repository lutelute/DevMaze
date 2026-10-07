import type { AnalysisResult, CommitNode } from '../shared/types'
import { buildMazeGraph } from '../shared/analyzer/graph'
import { detectStruggles } from '../shared/analyzer/struggle'
import { detectHotspots } from '../shared/analyzer/hotspot'
import { buildActivityProfile } from '../shared/analyzer/activity'
import { calculateScore, generateSummary } from '../shared/analyzer/score'
import { commit, at } from './helpers'

/** analyzeRepo を呼ばずに、コミット列から AnalysisResult を組み立てる */
export function resultFrom(commits: CommitNode[], repoName = 'fixture'): AnalysisResult {
  const graph = buildMazeGraph(commits)
  const score = calculateScore(commits)
  const sorted = [...commits].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const diffable = commits.filter(c => c.type !== 'merge')
  const withFiles = diffable.filter(c => c.files.length > 0).length
  return {
    repoPath: `/tmp/${repoName}`,
    repoName,
    graph,
    score,
    struggles: detectStruggles(commits),
    hotspots: detectHotspots(commits),
    activity: buildActivityProfile(commits),
    remoteUrl: 'https://github.com/example/fixture.git',
    stats: {
      totalCommits: commits.length,
      authors: [...new Set(commits.map(c => c.authorName))],
      dateRange: {
        start: sorted[0]?.timestamp.toISOString() ?? '',
        end: sorted[sorted.length - 1]?.timestamp.toISOString() ?? '',
      },
      branchCount: [...new Set(commits.flatMap(c => c.branchNames))].length,
      mergeCount: commits.filter(c => c.type === 'merge').length,
      revertCount: commits.filter(c => c.type === 'revert').length,
      errorFixCount: commits.filter(c => c.type === 'error_fix').length,
      wipCount: commits.filter(c => c.type === 'wip').length,
      fileStatsCoverage: diffable.length === 0 ? 0 : withFiles / diffable.length,
    },
    summary: generateSummary(commits, score, repoName),
  }
}

/**
 * 沼・ホットスポット・フェーズ・タグ・リバートが一通り出る履歴。
 * 時系列: 機能追加（main）→ src/x.ts を短期間に往復（fix×3 + revert）→ 抜ける → 休止 → 再開
 */
export function richHistory(): CommitNode[] {
  const h = (n: number) => n.toString(16).padStart(40, 'a')
  const list: CommitNode[] = []
  const add = (p: Parameters<typeof commit>[0]) => { const c = commit(p); list.push(c); return c }

  const c0 = add({ hash: h(0), type: 'feature', message: 'feat: 初期実装', timestamp: at(0),
    files: ['src/x.ts', 'src/y.ts'], branchNames: ['main'], tagNames: ['v0.1.0'], authorName: 'alice' })
  const c1 = add({ hash: h(1), type: 'feature', message: 'feat(x): 機能A', timestamp: at(2),
    files: ['src/x.ts'], parentHashes: [c0.hash], branchNames: ['main'], authorName: 'alice' })
  const c2 = add({ hash: h(2), type: 'error_fix', message: 'fix(x): Aが落ちる', timestamp: at(4),
    files: ['src/x.ts'], parentHashes: [c1.hash], branchNames: ['main'], authorName: 'alice' })
  const c3 = add({ hash: h(3), type: 'error_fix', message: 'fix(x): まだ落ちる', timestamp: at(6),
    files: ['src/x.ts'], parentHashes: [c2.hash], branchNames: ['main'], authorName: 'bob' })
  const c4 = add({ hash: h(4), type: 'revert', message: `Revert "feat(x): 機能A"\n\nThis reverts commit ${c1.hash}.`,
    timestamp: at(8), files: ['src/x.ts'], parentHashes: [c3.hash], branchNames: ['main'],
    revertedHash: c1.hash, authorName: 'alice' })
  const c5 = add({ hash: h(5), type: 'error_fix', message: 'fix(x): 根本原因', timestamp: at(10),
    files: ['src/x.ts', 'src/z.ts'], parentHashes: [c4.hash], branchNames: ['main'], authorName: 'alice' })
  const c6 = add({ hash: h(6), type: 'feature', message: 'feat(x): 機能A 作り直し: 完了', timestamp: at(14),
    files: ['src/x.ts'], parentHashes: [c5.hash], branchNames: ['main'], authorName: 'alice' })
  const c7 = add({ hash: h(7), type: 'wip', message: 'wip: 作業中', timestamp: at(16),
    files: ['src/w.ts'], parentHashes: [c6.hash], branchNames: ['feature/w'], authorName: 'bob' })
  const c8 = add({ hash: h(8), type: 'wip', message: 'wip: 続き', timestamp: at(18),
    files: ['src/w.ts'], parentHashes: [c7.hash], branchNames: ['feature/w'], authorName: 'bob' })
  const c9 = add({ hash: h(9), type: 'wip', message: 'wip: まだ', timestamp: at(20),
    files: ['src/w.ts'], parentHashes: [c8.hash], branchNames: ['feature/w'], authorName: 'bob' })
  // 10日の空白のあと大きな修正で再開
  const c10 = add({ hash: h(10), type: 'error_fix', message: 'fix: 大きく直した', timestamp: at(20 + 24 * 10),
    files: ['src/x.ts', 'src/y.ts'], parentHashes: [c6.hash, c9.hash], branchNames: ['main'],
    insertions: 400, deletions: 300, authorName: 'alice' })
  add({ hash: h(11), type: 'release', message: 'chore: release v0.2.0', timestamp: at(20 + 24 * 10 + 2),
    files: ['package.json'], parentHashes: [c10.hash], branchNames: ['main'], tagNames: ['v0.2.0'], authorName: 'alice' })
  return list
}
