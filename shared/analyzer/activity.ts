import type { CommitNode, ActivityProfile, AuthorStat } from '../types'

// ===================================================================
// 活動プロファイル
//
// 沼が「どこで詰まったか」、ホットスポットが「どこが荒れているか」なのに対し、
// これは「どう働いていたか」。夜に書いていたのか、週末に詰めたのか、
// 何日空けながら進めたのか。履歴からしか取れず、コードには残らない情報。
// ===================================================================

const DAY = 24 * 3600_000

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function buildActivityProfile(commits: CommitNode[]): ActivityProfile {
  const empty: ActivityProfile = {
    byHour: new Array(24).fill(0),
    byWeekday: new Array(7).fill(0),
    nightRatio: 0,
    weekendRatio: 0,
    busiestDay: null,
    activeDays: 0,
    spanDays: 0,
    commitsPerActiveDay: 0,
    longestStreakDays: 0,
    longestBreakDays: 0,
    authors: [],
  }
  if (commits.length === 0) return empty

  const byHour = new Array(24).fill(0)
  const byWeekday = new Array(7).fill(0)
  const perDay = new Map<string, number>()
  const authorMap = new Map<string, AuthorStat>()

  let night = 0
  let weekend = 0

  for (const c of commits) {
    const d = c.timestamp
    byHour[d.getHours()]++
    byWeekday[d.getDay()]++
    perDay.set(dateKey(d), (perDay.get(dateKey(d)) ?? 0) + 1)

    // 22時〜翌5時を「夜」とみなす
    if (d.getHours() >= 22 || d.getHours() < 5) night++
    if (d.getDay() === 0 || d.getDay() === 6) weekend++

    let a = authorMap.get(c.authorName)
    if (!a) {
      a = {
        name: c.authorName,
        commits: 0, insertions: 0, deletions: 0,
        firstSeen: d.getTime(), lastSeen: d.getTime(),
        fixCommits: 0,
      }
      authorMap.set(c.authorName, a)
    }
    a.commits++
    a.insertions += c.insertions
    a.deletions += c.deletions
    if (c.type === 'error_fix' || c.type === 'revert') a.fixCommits++
    a.firstSeen = Math.min(a.firstSeen, d.getTime())
    a.lastSeen = Math.max(a.lastSeen, d.getTime())
  }

  const times = commits.map(c => c.timestamp.getTime()).sort((a, b) => a - b)
  const spanDays = Math.max(1, Math.round((times[times.length - 1] - times[0]) / DAY))

  // 連続稼働日と最長の空白
  const days = [...perDay.keys()].sort()
  let longestStreak = 1
  let streak = 1
  let longestBreak = 0
  for (let i = 1; i < days.length; i++) {
    const diff = Math.round((new Date(days[i]).getTime() - new Date(days[i - 1]).getTime()) / DAY)
    if (diff === 1) {
      streak++
      longestStreak = Math.max(longestStreak, streak)
    } else {
      streak = 1
      longestBreak = Math.max(longestBreak, diff - 1)
    }
  }

  const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0]

  return {
    byHour,
    byWeekday,
    nightRatio: Math.round((night / commits.length) * 100) / 100,
    weekendRatio: Math.round((weekend / commits.length) * 100) / 100,
    busiestDay: busiest ? { date: busiest[0], count: busiest[1] } : null,
    activeDays: perDay.size,
    spanDays,
    commitsPerActiveDay: Math.round((commits.length / perDay.size) * 10) / 10,
    longestStreakDays: days.length > 0 ? longestStreak : 0,
    longestBreakDays: longestBreak,
    authors: [...authorMap.values()].sort((a, b) => b.commits - a.commits),
  }
}

export function formatActivity(profile: ActivityProfile, repoName: string): string {
  if (profile.activeDays === 0) return `## ${repoName} の働き方\n\nデータなし。`

  const peakHour = profile.byHour.indexOf(Math.max(...profile.byHour))
  const WD = ['日', '月', '火', '水', '木', '金', '土']
  const peakDay = profile.byWeekday.indexOf(Math.max(...profile.byWeekday))

  const lines = [
    `## ${repoName} の働き方`,
    ``,
    `- **稼働日数**: ${profile.activeDays}日 / 期間 ${profile.spanDays}日（稼働日1日あたり ${profile.commitsPerActiveDay} コミット）`,
    `- **よく書く時間帯**: ${peakHour}時台 / **よく書く曜日**: ${WD[peakDay]}曜`,
    `- **夜間（22-5時）の割合**: ${Math.round(profile.nightRatio * 100)}%`,
    `- **週末の割合**: ${Math.round(profile.weekendRatio * 100)}%`,
    `- **最長の連続稼働**: ${profile.longestStreakDays}日 / **最長の空白**: ${profile.longestBreakDays}日`,
  ]
  if (profile.busiestDay) {
    lines.push(`- **いちばん書いた日**: ${profile.busiestDay.date}（${profile.busiestDay.count}コミット）`)
  }

  if (profile.authors.length > 1) {
    lines.push(``, `### 著者`, ``, `| 著者 | コミット | 修正 | +行 | -行 |`, `|------|---------:|-----:|----:|----:|`)
    for (const a of profile.authors.slice(0, 10)) {
      lines.push(`| ${a.name} | ${a.commits} | ${a.fixCommits} | ${a.insertions} | ${a.deletions} |`)
    }
  }

  return lines.join('\n')
}
