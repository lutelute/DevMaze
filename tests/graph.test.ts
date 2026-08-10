import { describe, it, expect } from 'vitest'
import { buildMazeGraph, getRepoName } from '../shared/analyzer/graph'
import { calculateScore, generateSummary } from '../shared/analyzer/score'
import { commit, at } from './helpers'

describe('buildMazeGraph', () => {
  it('main から辿れるコミットをメインラインに置く', () => {
    const root = commit({ message: 'root', timestamp: at(0) })
    const tip = commit({
      message: 'tip', timestamp: at(2),
      parentHashes: [root.hash], branchNames: ['main'],
    })
    const side = commit({
      message: 'side', timestamp: at(3),
      parentHashes: [root.hash], branchNames: ['feature/x'],
    })

    const graph = buildMazeGraph([tip, side, root])
    const byMsg = new Map(graph.nodes.map(n => [n.message, n]))

    expect(byMsg.get('tip')!.isMainBranch).toBe(true)
    expect(byMsg.get('root')!.isMainBranch).toBe(true)
    expect(byMsg.get('side')!.isMainBranch).toBe(false)
    expect(byMsg.get('tip')!.lane).toBe(0)
    expect(byMsg.get('side')!.lane).not.toBe(0)
  })

  it('親子関係をエッジにする', () => {
    const a = commit({ timestamp: at(0), branchNames: ['main'] })
    const b = commit({ timestamp: at(1), parentHashes: [a.hash], branchNames: ['main'] })
    const graph = buildMazeGraph([b, a])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].source).toBe(a.hash)
    expect(graph.edges[0].target).toBe(b.hash)
    expect(graph.edges[0].type).toBe('parent')
  })

  it('revert 元へのエッジを張る', () => {
    const target = commit({ timestamp: at(0), branchNames: ['main'] })
    const rev = commit({
      type: 'revert', timestamp: at(1),
      parentHashes: [target.hash], revertedHash: target.hash, branchNames: ['main'],
    })
    const graph = buildMazeGraph([rev, target])
    expect(graph.edges.some(e => e.type === 'revert_of')).toBe(true)
  })

  it('タグ付きコミットをマイルストーンにする', () => {
    const commits = [
      commit({ timestamp: at(0), branchNames: ['main'] }),
      commit({ timestamp: at(1), tagNames: ['v1.0.0'], branchNames: ['main'] }),
    ]
    const graph = buildMazeGraph(commits)
    const tagged = graph.nodes.find(n => n.tagNames.length > 0)!
    expect(tagged.isMilestone).toBe(true)
    expect(tagged.milestoneReason).toBe('tag')
  })

  it('変更ファイルをノードに載せる（詳細パネル用）', () => {
    const graph = buildMazeGraph([commit({ files: ['src/a.ts'], branchNames: ['main'] })])
    expect(graph.nodes[0].files).toEqual(['src/a.ts'])
  })
})

describe('calculateScore', () => {
  it('重み付けの合計になる', () => {
    const commits = [
      commit({ type: 'revert' }),                       // 4
      commit({ type: 'error_fix' }),                    // 2
      commit({ type: 'wip' }),                          // 1
      commit({ type: 'merge' }),                        // 1
      commit({ branchNames: ['main'] }),
      commit({ branchNames: ['feature/a'] }),           // ブランチ発散 1 × 2
    ]
    const score = calculateScore(commits)
    expect(score.total).toBe(10)
    expect(score.level).toBe('clean')
  })

  it('荒れるほどレベルが上がる', () => {
    const messy = Array.from({ length: 20 }, () => commit({ type: 'revert' }))
    expect(calculateScore(messy).level).toBe('chaotic')
  })
})

describe('generateSummary', () => {
  it('コミットが無いときも壊れない', () => {
    expect(generateSummary([], calculateScore([]), 'repo')).toBe('No commits found.')
  })

  it('件数と分類を含む', () => {
    const commits = [commit({ type: 'feature' }), commit({ type: 'error_fix' })]
    const text = generateSummary(commits, calculateScore(commits), 'repo')
    expect(text).toContain('repo 開発サマリー')
    expect(text).toContain('**総コミット数**: 2件')
  })
})

describe('getRepoName', () => {
  it('パスの末尾を返す', () => {
    expect(getRepoName('/a/b/DevMaze')).toBe('DevMaze')
    expect(getRepoName('C:\\repos\\DevMaze')).toBe('DevMaze')
  })
})
