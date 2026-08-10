import { describe, it, expect } from 'vitest'
import { buildSessions, shouldAggregate } from '../shared/analyzer/session'
import type { MazeNode, CommitType } from '../shared/types'

let seq = 0
function node(partial: Partial<MazeNode> & { timestamp: number }): MazeNode {
  seq++
  return {
    id: seq.toString(16).padStart(40, '0'),
    label: seq.toString(16).slice(0, 7),
    type: (partial.type ?? 'normal') as CommitType,
    timestamp: partial.timestamp,
    filesChanged: partial.filesChanged ?? 1,
    insertions: partial.insertions ?? 10,
    deletions: partial.deletions ?? 1,
    authorName: 'tester',
    message: partial.message ?? 'commit',
    branchNames: [],
    tagNames: partial.tagNames ?? [],
    files: partial.files ?? ['src/a.ts'],
    refs: [],
    isMainBranch: partial.isMainBranch ?? true,
    lane: partial.lane ?? 0,
    isMilestone: partial.isMilestone ?? false,
  }
}

const MIN = 60_000
const base = new Date('2026-01-01T09:00:00').getTime()

describe('buildSessions', () => {
  it('空なら空', () => {
    expect(buildSessions([])).toEqual([])
  })

  it('間隔が閾値以内なら1つの作業にまとめる', () => {
    const s = buildSessions([
      node({ timestamp: base }),
      node({ timestamp: base + 30 * MIN }),
      node({ timestamp: base + 90 * MIN }),
    ])
    expect(s).toHaveLength(1)
    expect(s[0].commitCount).toBe(3)
  })

  it('間隔が空いたら別の作業に切る', () => {
    const s = buildSessions([
      node({ timestamp: base }),
      node({ timestamp: base + 30 * MIN }),
      node({ timestamp: base + 400 * MIN }),   // 2時間以上あく
    ])
    expect(s).toHaveLength(2)
    expect(s.map(x => x.commitCount)).toEqual([2, 1])
  })

  it('レーン（ブランチ）が違えば混ぜない', () => {
    const s = buildSessions([
      node({ timestamp: base, lane: 0 }),
      node({ timestamp: base + 10 * MIN, lane: 1 }),
    ])
    expect(s).toHaveLength(2)
  })

  it('支配的な種別を出す（normal は割り引く）', () => {
    const s = buildSessions([
      node({ timestamp: base, type: 'normal' }),
      node({ timestamp: base + MIN, type: 'normal' }),
      node({ timestamp: base + 2 * MIN, type: 'error_fix' }),
    ])
    expect(s[0].type).toBe('error_fix')
  })

  it('タグがあればラベルに使う', () => {
    const s = buildSessions([
      node({ timestamp: base, message: 'feat: x' }),
      node({ timestamp: base + MIN, message: 'chore: release v1.2.3', tagNames: ['v1.2.3'] }),
    ])
    expect(s[0].label).toBe('v1.2.3')
    expect(s[0].tagNames).toEqual(['v1.2.3'])
  })

  it('タグが無ければ版番号、それも無ければ件名', () => {
    expect(buildSessions([node({ timestamp: base, message: 'chore: release v9.9.9' })])[0].label)
      .toBe('v9.9.9')
    expect(buildSessions([node({ timestamp: base, message: 'feat: 何かを足した' })])[0].label)
      .toBe('feat: 何かを足した')
  })

  it('変更量とファイル数を合算する', () => {
    const s = buildSessions([
      node({ timestamp: base, insertions: 10, deletions: 2, files: ['a.ts', 'b.ts'] }),
      node({ timestamp: base + MIN, insertions: 5, deletions: 1, files: ['b.ts', 'c.ts'] }),
    ])
    expect(s[0].insertions).toBe(15)
    expect(s[0].deletions).toBe(3)
    expect(s[0].fileCount).toBe(3)
  })

  it('区切りの長さを変えられる', () => {
    const commits = [node({ timestamp: base }), node({ timestamp: base + 100 * MIN })]
    expect(buildSessions(commits, 120)).toHaveLength(1)
    expect(buildSessions(commits, 60)).toHaveLength(2)
  })
})

describe('shouldAggregate', () => {
  it('200件を超えたらまとめる', () => {
    expect(shouldAggregate(150)).toBe(false)
    expect(shouldAggregate(201)).toBe(true)
  })
})
