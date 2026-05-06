import type { CommitNode, MazeGraph, MazeNode, MazeEdge } from '../types'

const MAIN_BRANCH_NAMES = /^(main|master|develop|development|trunk|default)$/i

// ===== Main branch detection =====
function findMainBranchHashes(commits: CommitNode[]): Set<string> {
  // Find tip of main/master/develop
  const mainTip = commits.find(c =>
    c.branchNames.some(b => {
      const base = b.replace(/^(origin\/|remotes\/origin\/)/, '')
      return MAIN_BRANCH_NAMES.test(base)
    })
  )

  if (!mainTip) {
    // Fallback: use the commit with the most recent timestamp that has no children (HEAD)
    // Or just return the first commit's ancestry
    return new Set()
  }

  // BFS backward from main tip → collect all ancestor hashes
  const hashSet = new Set<string>()
  const commitMap = new Map(commits.map(c => [c.hash, c]))
  const queue = [mainTip.hash]
  while (queue.length) {
    const h = queue.shift()!
    if (hashSet.has(h)) continue
    hashSet.add(h)
    const c = commitMap.get(h)
    if (c) queue.push(...c.parentHashes.filter(ph => !hashSet.has(ph)))
  }
  return hashSet
}

// ===== Lane assignment =====
function assignLanes(commits: CommitNode[], mainHashes: Set<string>): Map<string, number> {
  const laneMap = new Map<string, number>()

  // Main branch commits → lane 0
  for (const c of commits) {
    if (mainHashes.has(c.hash)) laneMap.set(c.hash, 0)
  }

  // Non-main commits: group by named branch if available
  const branchToHashes = new Map<string, string[]>()
  for (const c of commits) {
    if (mainHashes.has(c.hash)) continue
    const branch = c.branchNames.find(b => {
      const base = b.replace(/^(origin\/|remotes\/origin\/)/, '')
      return !MAIN_BRANCH_NAMES.test(base) && base !== 'HEAD'
    })
    // Commits without a distinct branch name → group as "orphan"
    const key = branch
      ? branch.replace(/^(origin\/|remotes\/origin\/)/, '')
      : '__orphan__'
    if (!branchToHashes.has(key)) branchToHashes.set(key, [])
    branchToHashes.get(key)!.push(c.hash)
  }

  // Assign alternating lanes ±1, ±2, ±3 ... (cap at ±8)
  let laneCounter = 1
  const MAX_LANE = 8
  for (const [, hashes] of branchToHashes) {
    const idx = Math.min(laneCounter, MAX_LANE * 2 - 1)
    const lane = idx % 2 === 1 ? Math.ceil(idx / 2) : -(idx / 2)
    for (const h of hashes) laneMap.set(h, lane)
    laneCounter++
  }

  // Fill any remaining unmapped commits → lane 0
  for (const c of commits) {
    if (!laneMap.has(c.hash)) laneMap.set(c.hash, 0)
  }

  return laneMap
}

// ===== Graph builder =====
export function buildMazeGraph(commits: CommitNode[]): MazeGraph {
  const mainHashes = findMainBranchHashes(commits)
  const laneMap = assignLanes(commits, mainHashes)
  const hashToNode = new Map<string, MazeNode>()

  const nodes: MazeNode[] = commits.map(c => {
    const node: MazeNode = {
      id: c.hash,
      label: c.shortHash,
      type: c.type,
      timestamp: c.timestamp.getTime(),
      filesChanged: c.filesChanged,
      insertions: c.insertions,
      deletions: c.deletions,
      authorName: c.authorName,
      message: c.message,
      branchNames: c.branchNames,
      tagNames: c.tagNames,
      isMainBranch: mainHashes.has(c.hash),
      lane: laneMap.get(c.hash) ?? 0,
    }
    hashToNode.set(c.hash, node)
    return node
  })

  const edges: MazeEdge[] = []
  const edgeSet = new Set<string>()

  for (const commit of commits) {
    commit.parentHashes.forEach((parentHash, idx) => {
      if (!hashToNode.has(parentHash)) return
      const edgeId = `${parentHash}→${commit.hash}`
      if (edgeSet.has(edgeId)) return
      edgeSet.add(edgeId)
      edges.push({
        id: edgeId,
        source: parentHash,
        target: commit.hash,
        type: idx === 0 ? 'parent' : 'merge_parent',
      })
    })

    if (commit.revertedHash && hashToNode.has(commit.revertedHash)) {
      const revId = `revert:${commit.hash}→${commit.revertedHash}`
      if (!edgeSet.has(revId)) {
        edgeSet.add(revId)
        edges.push({
          id: revId,
          source: commit.hash,
          target: commit.revertedHash,
          type: 'revert_of',
        })
      }
    }
  }

  return { nodes, edges }
}

export function getRepoName(repoPath: string): string {
  const parts = repoPath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || repoPath
}
