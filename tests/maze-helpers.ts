import type { MazeNode, CommitType } from '../shared/types'

let seq = 0

/** 迷路テスト用のノード。指定しない項目は無難な既定値で埋める */
export function mazeNode(partial: Partial<MazeNode> & { timestamp: number }): MazeNode {
  seq++
  const id = partial.id ?? seq.toString(16).padStart(40, '0')
  return {
    id,
    label: id.slice(0, 7),
    type: (partial.type ?? 'normal') as CommitType,
    timestamp: partial.timestamp,
    filesChanged: partial.filesChanged ?? 1,
    insertions: partial.insertions ?? 10,
    deletions: partial.deletions ?? 1,
    authorName: partial.authorName ?? 'tester',
    message: partial.message ?? 'commit',
    branchNames: partial.branchNames ?? [],
    tagNames: partial.tagNames ?? [],
    files: partial.files ?? ['src/a.ts'],
    refs: [],
    isMainBranch: partial.isMainBranch ?? true,
    lane: partial.lane ?? 0,
    isMilestone: partial.isMilestone ?? false,
    milestoneReason: partial.milestoneReason,
  }
}

/** 決定的な疑似乱数（mulberry32）。テストで同じ履歴を毎回作るため */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR
export const BASE = new Date('2026-01-05T09:00:00').getTime()

/**
 * 「座って書いた一続き」が何度もある履歴を作る。
 * 集中した時期（数分おき）と空白（数日）が混ざるので、衝突回避と空白の印の両方を試せる。
 */
export function realisticHistory(count: number, seed = 1): MazeNode[] {
  const rand = rng(seed)
  const nodes: MazeNode[] = []
  let t = BASE
  let lane = 0
  while (nodes.length < count) {
    // 1回の作業: 3〜20件、10〜40分おき
    const burst = 3 + Math.floor(rand() * 18)
    if (rand() < 0.2) lane = lane === 0 ? (rand() < 0.5 ? 1 : -1) : 0
    for (let i = 0; i < burst && nodes.length < count; i++) {
      t += (10 + rand() * 30) * MIN
      nodes.push(mazeNode({
        timestamp: t,
        lane,
        isMainBranch: lane === 0,
        filesChanged: 1 + Math.floor(rand() * 8),
        type: rand() < 0.25 ? 'error_fix' : rand() < 0.3 ? 'feature' : 'normal',
      }))
    }
    // 作業の合間: 2時間〜（たまに）10日
    t += rand() < 0.1 ? (3 + rand() * 7) * DAY : (2 + rand() * 20) * HOUR
  }
  return nodes
}
