import type { CommitNode, CommitType } from '../shared/types'

let seq = 0

/** テスト用のコミットを組み立てる。指定しない項目は無難な既定値で埋める。 */
export function commit(partial: Partial<CommitNode> & { type?: CommitType }): CommitNode {
  seq++
  const hash = partial.hash ?? seq.toString(16).padStart(40, '0')
  const files = partial.files ?? []
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parentHashes: partial.parentHashes ?? [],
    authorName: partial.authorName ?? 'tester',
    authorEmail: partial.authorEmail ?? 'tester@example.com',
    timestamp: partial.timestamp ?? new Date('2026-01-01T00:00:00Z'),
    message: partial.message ?? 'commit',
    filesChanged: partial.filesChanged ?? files.length,
    insertions: partial.insertions ?? 10,
    deletions: partial.deletions ?? 2,
    type: partial.type ?? 'normal',
    branchNames: partial.branchNames ?? [],
    tagNames: partial.tagNames ?? [],
    revertedHash: partial.revertedHash,
    files,
  }
}

const HOUR = 3600_000

/** 基準時刻から hours 時間後 */
export function at(hours: number): Date {
  return new Date(new Date('2026-01-01T00:00:00Z').getTime() + hours * HOUR)
}
