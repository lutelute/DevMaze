import { analyzeGitRepo, getRemoteUrl } from './git'
import { calculateScore, generateSummary } from './score'
import { buildMazeGraph, getRepoName } from './graph'
import { detectStruggles } from './struggle'
import { detectHotspots } from './hotspot'
import { buildActivityProfile } from './activity'
import type { AnalysisResult } from '../types'

/**
 * 解析の段階。偽のパーセンテージではなく、実在する工程だけを名前で出す。
 * 待っている側が「いま何をしていて、あと何が残っているか」を読めるようにするため。
 */
export const ANALYZE_STAGES = ['git', 'graph', 'detect', 'layout'] as const
export type AnalyzeStage = typeof ANALYZE_STAGES[number]

export interface AnalyzeProgress {
  stage: AnalyzeStage
  /** その段階で分かった件数など。「900コミットを解析中」の 900 にあたる */
  detail?: string
}

export async function analyzeRepo(
  repoPath: string,
  onStage?: (p: AnalyzeProgress) => void,
): Promise<AnalysisResult> {
  onStage?.({ stage: 'git' })
  const commits = await analyzeGitRepo(repoPath)

  onStage?.({ stage: 'graph', detail: `${commits.length} コミット` })
  const graph = buildMazeGraph(commits)
  const score = calculateScore(commits)

  onStage?.({ stage: 'detect', detail: `${commits.length} コミット` })
  const struggles = detectStruggles(commits)
  const hotspots = detectHotspots(commits)
  const activity = buildActivityProfile(commits)

  onStage?.({ stage: 'layout' })
  const remoteUrl = await getRemoteUrl(repoPath)
  const repoName = getRepoName(repoPath)
  const summary = generateSummary(commits, score, repoName)

  const authors = [...new Set(commits.map(c => c.authorName))]
  const sorted = [...commits].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

  // マージコミットは numstat が空なので分母から外す
  const diffable = commits.filter(c => c.type !== 'merge')
  const withFiles = diffable.filter(c => c.files.length > 0).length
  const fileStatsCoverage = diffable.length === 0
    ? 0
    : Math.round((withFiles / diffable.length) * 100) / 100

  return {
    repoPath,
    repoName,
    graph,
    score,
    struggles,
    hotspots,
    activity,
    remoteUrl,
    stats: {
      totalCommits: commits.length,
      authors,
      dateRange: {
        start: sorted[0]?.timestamp.toISOString() ?? '',
        end:   sorted[sorted.length - 1]?.timestamp.toISOString() ?? '',
      },
      branchCount: [...new Set(commits.flatMap(c => c.branchNames))].length,
      mergeCount:  commits.filter(c => c.type === 'merge').length,
      revertCount: commits.filter(c => c.type === 'revert').length,
      errorFixCount: commits.filter(c => c.type === 'error_fix').length,
      wipCount:    commits.filter(c => c.type === 'wip').length,
      fileStatsCoverage,
    },
    summary,
  }
}

export { analyzeGitRepo } from './git'
export { calculateScore, generateSummary } from './score'
export { buildMazeGraph, getRepoName } from './graph'
export { detectStruggles, formatStruggles, struggleKindLabel } from './struggle'
export { detectHotspots, formatHotspots } from './hotspot'
export { buildActivityProfile, formatActivity } from './activity'
