import { describe, it, expect } from 'vitest'
import { buildReport } from '../shared/analyzer/report'
import { detectStruggles } from '../shared/analyzer/struggle'
import { detectHotspots } from '../shared/analyzer/hotspot'
import { calculateScore, generateSummary } from '../shared/analyzer/score'
import { buildMazeGraph } from '../shared/analyzer/graph'
import { commit, at } from './helpers'
import type { AnalysisResult } from '../shared/types'

function analysisOf(commits = [
  commit({ type: 'error_fix', timestamp: at(0), files: ['src/a.ts'], branchNames: ['main'] }),
  commit({ type: 'error_fix', timestamp: at(2), files: ['src/a.ts'] }),
  commit({ type: 'error_fix', timestamp: at(4), files: ['src/a.ts'] }),
]): AnalysisResult {
  const score = calculateScore(commits)
  return {
    repoPath: '/tmp/repo',
    repoName: 'repo',
    graph: buildMazeGraph(commits),
    score,
    struggles: detectStruggles(commits),
    hotspots: detectHotspots(commits),
    stats: {
      totalCommits: commits.length,
      authors: ['tester'],
      dateRange: { start: '', end: '' },
      branchCount: 1,
      mergeCount: 0,
      revertCount: 0,
      errorFixCount: commits.length,
      wipCount: 0,
      fileStatsCoverage: 1,
    },
    summary: generateSummary(commits, score, 'repo'),
  }
}

describe('buildReport', () => {
  it('サマリー・沼・ホットスポットを1本にまとめる', () => {
    const text = buildReport(analysisOf())
    expect(text).toContain('# repo 開発過程レポート')
    expect(text).toContain('開発サマリー')
    expect(text).toContain('repo の沼')
    expect(text).toContain('repo のホットスポット')
    expect(text).toContain('ファイル差分の取得率 100%')
  })

  it('件数の上限を守る', () => {
    const result = analysisOf()
    const text = buildReport(result, { struggleLimit: 0, hotspotLimit: 0 })
    expect(text).toContain('検出なし')
  })
})
