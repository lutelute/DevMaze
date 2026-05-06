import { analyzeGitRepo } from './git'
import { calculateScore, generateSummary } from './score'
import { buildMazeGraph, getRepoName } from './graph'
import type { AnalysisResult } from '../types'

export async function analyzeRepo(repoPath: string): Promise<AnalysisResult> {
  const commits = await analyzeGitRepo(repoPath)
  const graph = buildMazeGraph(commits)
  const score = calculateScore(commits)
  const repoName = getRepoName(repoPath)
  const summary = generateSummary(commits, score, repoName)

  const authors = [...new Set(commits.map(c => c.authorName))]
  const sorted = [...commits].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

  return {
    repoPath,
    repoName,
    graph,
    score,
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
    },
    summary,
  }
}

export { analyzeGitRepo } from './git'
export { calculateScore, generateSummary } from './score'
export { buildMazeGraph, getRepoName } from './graph'
