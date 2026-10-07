import type { MazeNode, CommitType, WorkSession } from '../types'

// ===================================================================
// 作業セッション
//
// 900件のコミットを1件ずつ描いても、点が900個あるだけで全体は読めない。
// 人は「連続して座って書いた一続き」を1つの作業として覚えているので、
// 間隔が空いたところで切って、そのまとまりを1つの単位として見せる。
// ===================================================================

const MINUTE = 60_000

/** 既定の区切り: 2時間あいたら別の作業とみなす */
export const DEFAULT_SESSION_GAP_MIN = 120

/** merge / normal は「その作業が何だったか」を表す力が弱いので割り引く */
function dominantType(types: CommitType[]): CommitType {
  const score = new Map<CommitType, number>()
  for (const t of types) {
    const w = t === 'normal' || t === 'merge' ? 0.3 : 1
    score.set(t, (score.get(t) ?? 0) + w)
  }
  let best: CommitType = 'normal'
  let max = -1
  for (const [t, s] of score) {
    if (s > max) { max = s; best = t }
  }
  return best
}

export function buildSessions(
  nodes: MazeNode[],
  gapMinutes: number = DEFAULT_SESSION_GAP_MIN,
): WorkSession[] {
  if (nodes.length === 0) return []

  const sorted = [...nodes].sort((a, b) => a.timestamp - b.timestamp)
  const gap = gapMinutes * MINUTE

  const groups: MazeNode[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = groups[groups.length - 1]
    const last = prev[prev.length - 1]
    // レーン（ブランチ）が違うものは混ぜない。別の作業として見えるべきなので
    if (sorted[i].timestamp - last.timestamp <= gap && sorted[i].lane === last.lane) {
      prev.push(sorted[i])
    } else {
      groups.push([sorted[i]])
    }
  }

  return groups.map((commits, i) => {
    const files = new Set<string>()
    let insertions = 0, deletions = 0
    for (const c of commits) {
      insertions += c.insertions
      deletions += c.deletions
      for (const f of c.files) files.add(f)
    }

    const tags = commits.flatMap(c => c.tagNames)
    const versions = commits
      .map(c => c.message.match(/\bv\d+\.\d+(\.\d+)?\b/)?.[0])
      .filter((v): v is string => !!v)

    return {
      id: `session_${i}`,
      startTimestamp: commits[0].timestamp,
      endTimestamp: commits[commits.length - 1].timestamp,
      commitCount: commits.length,
      commitHashes: commits.map(c => c.id),
      type: dominantType(commits.map(c => c.type)),
      lane: commits[0].lane,
      isMainBranch: commits.some(c => c.isMainBranch),
      insertions,
      deletions,
      fileCount: files.size,
      // その作業を一言で表すもの: タグ > 版番号 > 最初のコミットの件名
      label: tags[0] ?? versions[versions.length - 1] ?? commits[0].message.split('\n')[0],
      hasMilestone: commits.some(c => c.isMilestone),
      tagNames: [...new Set(tags)],
    }
  })
}

/** 1件あたりの粒度が細かすぎるか（自動でまとまり表示に切り替える判断に使う） */
export function shouldAggregate(nodeCount: number): boolean {
  return nodeCount > 200
}
