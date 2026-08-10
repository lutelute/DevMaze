import { describe, it, expect } from 'vitest'
import { buildActivityProfile, formatActivity } from '../shared/analyzer/activity'
import { commit } from './helpers'

// 時刻はローカルタイムで解釈される（プロファイルも getHours を使うので一致する）
const at = (iso: string) => new Date(iso)

describe('buildActivityProfile', () => {
  it('コミットが無いときも壊れない', () => {
    const p = buildActivityProfile([])
    expect(p.activeDays).toBe(0)
    expect(p.authors).toEqual([])
    expect(p.busiestDay).toBeNull()
  })

  it('時間帯・曜日の分布を数える', () => {
    const commits = [
      commit({ timestamp: at('2026-01-05T23:30:00') }),  // 月 深夜
      commit({ timestamp: at('2026-01-05T23:50:00') }),
      commit({ timestamp: at('2026-01-06T14:00:00') }),  // 火 昼
    ]
    const p = buildActivityProfile(commits)
    expect(p.byHour[23]).toBe(2)
    expect(p.byHour[14]).toBe(1)
    expect(p.byWeekday[1]).toBe(2)   // 月曜
    expect(p.nightRatio).toBeCloseTo(0.67, 1)
  })

  it('週末の割合を出す', () => {
    const commits = [
      commit({ timestamp: at('2026-01-03T10:00:00') }),  // 土
      commit({ timestamp: at('2026-01-04T10:00:00') }),  // 日
      commit({ timestamp: at('2026-01-05T10:00:00') }),  // 月
      commit({ timestamp: at('2026-01-06T10:00:00') }),  // 火
    ]
    expect(buildActivityProfile(commits).weekendRatio).toBe(0.5)
  })

  it('稼働日数・連続稼働・最長の空白を出す', () => {
    const commits = [
      commit({ timestamp: at('2026-01-01T10:00:00') }),
      commit({ timestamp: at('2026-01-02T10:00:00') }),
      commit({ timestamp: at('2026-01-03T10:00:00') }),
      commit({ timestamp: at('2026-01-20T10:00:00') }),  // 16日空く
    ]
    const p = buildActivityProfile(commits)
    expect(p.activeDays).toBe(4)
    expect(p.longestStreakDays).toBe(3)
    expect(p.longestBreakDays).toBe(16)
    expect(p.commitsPerActiveDay).toBe(1)
  })

  it('いちばん書いた日を出す', () => {
    const commits = [
      commit({ timestamp: at('2026-01-01T10:00:00') }),
      commit({ timestamp: at('2026-01-02T10:00:00') }),
      commit({ timestamp: at('2026-01-02T11:00:00') }),
      commit({ timestamp: at('2026-01-02T12:00:00') }),
    ]
    const p = buildActivityProfile(commits)
    expect(p.busiestDay).toEqual({ date: '2026-01-02', count: 3 })
  })

  it('著者ごとに集計し、コミット数の多い順に返す', () => {
    const commits = [
      commit({ authorName: 'a', type: 'error_fix', timestamp: at('2026-01-01T10:00:00') }),
      commit({ authorName: 'a', timestamp: at('2026-01-02T10:00:00') }),
      commit({ authorName: 'b', timestamp: at('2026-01-03T10:00:00') }),
    ]
    const p = buildActivityProfile(commits)
    expect(p.authors.map(a => a.name)).toEqual(['a', 'b'])
    expect(p.authors[0].commits).toBe(2)
    expect(p.authors[0].fixCommits).toBe(1)
  })
})

describe('formatActivity', () => {
  it('主要な指標を含む', () => {
    const p = buildActivityProfile([
      commit({ timestamp: at('2026-01-01T23:00:00') }),
      commit({ timestamp: at('2026-01-02T23:00:00') }),
    ])
    const text = formatActivity(p, 'repo')
    expect(text).toContain('repo の働き方')
    expect(text).toContain('稼働日数')
    expect(text).toContain('夜間')
  })
})
