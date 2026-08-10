import { describe, it, expect } from 'vitest'
import { detectStruggles, formatStruggles } from '../shared/analyzer/struggle'
import { commit, at } from './helpers'

describe('detectStruggles — 修正の連鎖', () => {
  it('短期間に fix が3件以上続いたら検出する', () => {
    const commits = [
      commit({ type: 'error_fix', message: 'fix: A', timestamp: at(0),  files: ['src/a.ts'] }),
      commit({ type: 'error_fix', message: 'fix: B', timestamp: at(2),  files: ['src/a.ts'] }),
      commit({ type: 'error_fix', message: 'fix: C', timestamp: at(5),  files: ['src/a.ts'] }),
    ]
    const found = detectStruggles(commits)
    expect(found.some(e => e.kind === 'fix_chain')).toBe(true)
  })

  it('間隔が1日以上空いたら別の塊として扱う（2件ずつなら検出しない）', () => {
    const commits = [
      commit({ type: 'error_fix', timestamp: at(0),   files: ['src/a.ts'] }),
      commit({ type: 'error_fix', timestamp: at(2),   files: ['src/a.ts'] }),
      commit({ type: 'error_fix', timestamp: at(100), files: ['src/a.ts'] }),
      commit({ type: 'error_fix', timestamp: at(102), files: ['src/a.ts'] }),
    ]
    expect(detectStruggles(commits).some(e => e.kind === 'fix_chain')).toBe(false)
  })
})

describe('detectStruggles — 同じファイルの往復', () => {
  const churn = (extra = {}) => [
    commit({ type: 'feature',   timestamp: at(0),  files: ['src/x.ts'], ...extra }),
    commit({ type: 'error_fix', timestamp: at(4),  files: ['src/x.ts'], ...extra }),
    commit({ type: 'error_fix', timestamp: at(8),  files: ['src/x.ts'], ...extra }),
    commit({ type: 'normal',    timestamp: at(12), files: ['src/x.ts'], ...extra }),
  ]

  it('7日窓で4回以上 かつ 荒れの印があれば検出する', () => {
    const found = detectStruggles(churn())
    const churnEpisode = found.find(e => e.kind === 'file_churn')
    expect(churnEpisode).toBeDefined()
    expect(churnEpisode!.files[0].path).toBe('src/x.ts')
    expect(churnEpisode!.files[0].touches).toBe(4)
  })

  it('fix も revert も WIP も無い（順調に作り込んだ）場合は沼にしない', () => {
    const smooth = [0, 4, 8, 12].map(h =>
      commit({ type: 'feature', timestamp: at(h), files: ['src/x.ts'] }))
    expect(detectStruggles(smooth).some(e => e.kind === 'file_churn')).toBe(false)
  })

  it('一度に大量のファイルを触るコミットは往復に数えない', () => {
    // filesChanged を大きく詐称する = 初回インポートや一括整形の再現
    const sweeping = churn({ filesChanged: 500 })
    expect(detectStruggles(sweeping).some(e => e.kind === 'file_churn')).toBe(false)
  })

  it('lock ファイルなどの自動生成物は往復に数えない', () => {
    const lockChurn = [0, 4, 8, 12].map(h =>
      commit({ type: 'error_fix', timestamp: at(h), files: ['package-lock.json'] }))
    expect(detectStruggles(lockChurn).some(e => e.kind === 'file_churn')).toBe(false)
  })
})

describe('detectStruggles — やり直しの輪', () => {
  it('revert とその周辺で同じファイルを触っていたら検出する', () => {
    const target = commit({ type: 'feature', message: 'feat: X', timestamp: at(0), files: ['src/x.ts'] })
    const commits = [
      target,
      commit({ type: 'error_fix', timestamp: at(3), files: ['src/x.ts'] }),
      commit({
        type: 'revert', message: 'Revert "feat: X"', timestamp: at(6),
        files: ['src/x.ts'], revertedHash: target.hash,
      }),
    ]
    const episode = detectStruggles(commits).find(e => e.kind === 'revert_loop')
    expect(episode).toBeDefined()
    expect(episode!.severity).toBeGreaterThan(50)
  })
})

describe('detectStruggles — 抜けた印', () => {
  it('沼のあとに同じファイルへの前進コミットがあれば escape として拾う', () => {
    const commits = [
      commit({ type: 'error_fix', timestamp: at(0), files: ['src/x.ts'] }),
      commit({ type: 'error_fix', timestamp: at(2), files: ['src/x.ts'] }),
      commit({ type: 'error_fix', timestamp: at(4), files: ['src/x.ts'] }),
      commit({ type: 'feature', message: 'feat: 動いた', timestamp: at(10), files: ['src/x.ts'] }),
    ]
    const episode = detectStruggles(commits).find(e => e.kind === 'fix_chain')!
    expect(episode.escape?.message).toBe('feat: 動いた')
  })

  it('前進コミットが無ければ escape は付かない', () => {
    const commits = [0, 2, 4].map(h =>
      commit({ type: 'error_fix', timestamp: at(h), files: ['src/x.ts'] }))
    const episode = detectStruggles(commits).find(e => e.kind === 'fix_chain')!
    expect(episode.escape).toBeUndefined()
  })
})

describe('detectStruggles — 全体', () => {
  it('空の履歴では何も返さない', () => {
    expect(detectStruggles([])).toEqual([])
  })

  it('マージコミットだけでは沼にならない', () => {
    const merges = [0, 2, 4].map(h => commit({ type: 'merge', timestamp: at(h) }))
    expect(detectStruggles(merges)).toEqual([])
  })

  it('深刻度の降順で返る', () => {
    const commits = [
      ...[0, 2, 4, 6, 8, 10].map(h => commit({ type: 'error_fix', timestamp: at(h), files: ['src/a.ts'] })),
      ...[200, 202, 204].map(h => commit({ type: 'wip', timestamp: at(h), files: ['src/b.ts'] })),
    ]
    const found = detectStruggles(commits)
    expect(found.length).toBeGreaterThan(1)
    for (let i = 1; i < found.length; i++) {
      expect(found[i - 1].severity).toBeGreaterThanOrEqual(found[i].severity)
    }
  })
})

describe('formatStruggles', () => {
  it('ファイル差分が取れていないときは、その旨を必ず出す', () => {
    const text = formatStruggles([], 'repo', 0.1)
    expect(text).toContain('10%')
    expect(text).toMatch(/現れていない可能性/)
  })

  it('取得率が十分なら警告を出さない', () => {
    expect(formatStruggles([], 'repo', 1)).not.toMatch(/現れていない可能性/)
  })
})
