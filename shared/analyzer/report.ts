import type { AnalysisResult } from '../types'
import { formatStruggles } from './struggle'
import { formatHotspots } from './hotspot'

export interface ReportOptions {
  struggleLimit?: number
  hotspotLimit?: number
}

/**
 * 開発過程を1本の Markdown にまとめる。
 * アプリの「レポート出力」と MCP の export_report で同じものを出すため、
 * 組み立てはここに一本化している。
 */
export function buildReport(result: AnalysisResult, opts: ReportOptions = {}): string {
  const struggleLimit = opts.struggleLimit ?? 10
  const hotspotLimit  = opts.hotspotLimit ?? 15
  const coverage = result.stats.fileStatsCoverage

  return [
    `# ${result.repoName} 開発過程レポート`,
    ``,
    `生成: DevMaze / 対象: \`${result.repoPath}\``,
    `解析コミット数: ${result.stats.totalCommits}（ファイル差分の取得率 ${Math.round(coverage * 100)}%）`,
    ``,
    result.summary,
    ``,
    formatStruggles(result.struggles.slice(0, struggleLimit), result.repoName, coverage),
    ``,
    formatHotspots(result.hotspots.slice(0, hotspotLimit), result.repoName),
  ].join('\n')
}
