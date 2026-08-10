import { describe, it, expect } from 'vitest'
import { detectHotspots, formatHotspots } from '../shared/analyzer/hotspot'
import { commit, at } from './helpers'

describe('detectHotspots', () => {
  it('変更回数と修正率から risk を出す', () => {
    const commits = [
      ...[0, 1, 2, 3, 4].map(h => commit({ type: 'error_fix', timestamp: at(h), files: ['src/hot.ts'] })),
      ...[0, 1].map(h => commit({ type: 'feature', timestamp: at(h), files: ['src/calm.ts'] })),
    ]
    const hotspots = detectHotspots(commits)
    expect(hotspots[0].path).toBe('src/hot.ts')
    expect(hotspots[0].fixCommits).toBe(5)
    expect(hotspots[0].risk).toBeGreaterThan(hotspots[1].risk)
  })

  it('母数の小さい100%修正が、実績のあるファイルを追い抜かない', () => {
    // 2回変更して2回とも修正 = 100% は統計的に弱い。平滑化が効いているかを見る
    const commits = [
      ...Array.from({ length: 12 }, (_, i) =>
        commit({ type: i % 2 === 0 ? 'error_fix' : 'feature', timestamp: at(i), files: ['src/real.ts'] })),
      ...[0, 1].map(h => commit({ type: 'error_fix', timestamp: at(h), files: ['src/tiny.ts'] })),
    ]
    const hotspots = detectHotspots(commits)
    const real = hotspots.find(h => h.path === 'src/real.ts')!
    const tiny = hotspots.find(h => h.path === 'src/tiny.ts')!
    expect(real.risk).toBeGreaterThan(tiny.risk)
  })

  it('1回しか変更されていないファイルは対象外', () => {
    const commits = [commit({ type: 'feature', timestamp: at(0), files: ['src/once.ts'] })]
    expect(detectHotspots(commits)).toEqual([])
  })

  it('なぎ払いコミット（大量ファイル）は集計しない', () => {
    const sweeping = [0, 1, 2].map(h =>
      commit({ type: 'error_fix', timestamp: at(h), files: ['src/a.ts'], filesChanged: 400 }))
    expect(detectHotspots(sweeping)).toEqual([])
  })

  it('自動生成物は除外する', () => {
    const commits = [0, 1, 2].map(h =>
      commit({ type: 'error_fix', timestamp: at(h), files: ['package-lock.json', 'dist/bundle.js'] }))
    expect(detectHotspots(commits)).toEqual([])
  })

  it('複数人が触っているファイルは risk が上がる', () => {
    const solo = [0, 1, 2].map(h =>
      commit({ type: 'feature', timestamp: at(h), files: ['src/solo.ts'], authorName: 'a' }))
    const team = [0, 1, 2].map(h =>
      commit({ type: 'feature', timestamp: at(h), files: ['src/team.ts'], authorName: `dev${h}` }))
    const hotspots = detectHotspots([...solo, ...team])
    const s = hotspots.find(h => h.path === 'src/solo.ts')!
    const t = hotspots.find(h => h.path === 'src/team.ts')!
    expect(t.authors).toBe(3)
    expect(t.risk).toBeGreaterThan(s.risk)
  })
})

describe('formatHotspots', () => {
  it('空でも読める文面を返す', () => {
    expect(formatHotspots([], 'repo')).toContain('検出なし')
  })

  it('Markdown テーブルで返す', () => {
    const commits = [0, 1, 2].map(h =>
      commit({ type: 'error_fix', timestamp: at(h), files: ['src/a.ts'] }))
    const text = formatHotspots(detectHotspots(commits), 'repo')
    expect(text).toContain('| risk |')
    expect(text).toContain('src/a.ts')
  })
})
