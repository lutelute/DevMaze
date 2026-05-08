import type { CommitNode, MazeGraph, MazeNode, MazeEdge, CommitType, Zone, LaneInfo } from '../types'

const MAIN_BRANCH_NAMES = /^(main|master|develop|development|trunk|default)$/i

// ===== Main branch detection =====
function findMainBranchHashes(commits: CommitNode[]): Set<string> {
  const mainTip = commits.find(c =>
    c.branchNames.some(b => {
      const base = b.replace(/^(origin\/|remotes\/origin\/)/, '')
      return MAIN_BRANCH_NAMES.test(base)
    })
  )

  if (!mainTip) return new Set()

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

  for (const c of commits) {
    if (mainHashes.has(c.hash)) laneMap.set(c.hash, 0)
  }

  const branchToHashes = new Map<string, string[]>()
  for (const c of commits) {
    if (mainHashes.has(c.hash)) continue
    const branch = c.branchNames.find(b => {
      const base = b.replace(/^(origin\/|remotes\/origin\/)/, '')
      return !MAIN_BRANCH_NAMES.test(base) && base !== 'HEAD'
    })
    const key = branch
      ? branch.replace(/^(origin\/|remotes\/origin\/)/, '')
      : '__orphan__'
    if (!branchToHashes.has(key)) branchToHashes.set(key, [])
    branchToHashes.get(key)!.push(c.hash)
  }

  let laneCounter = 1
  const MAX_LANE = 8
  for (const [, hashes] of branchToHashes) {
    const idx = Math.min(laneCounter, MAX_LANE * 2 - 1)
    const lane = idx % 2 === 1 ? Math.ceil(idx / 2) : -(idx / 2)
    for (const h of hashes) laneMap.set(h, lane)
    laneCounter++
  }

  for (const c of commits) {
    if (!laneMap.has(c.hash)) laneMap.set(c.hash, 0)
  }

  return laneMap
}

// ===== Milestone detection =====
function detectMilestones(commits: CommitNode[]): Map<string, MazeNode['milestoneReason']> {
  const milestones = new Map<string, MazeNode['milestoneReason']>()

  // 1. タグあり
  for (const c of commits) {
    if (c.tagNames.length > 0) milestones.set(c.hash, 'tag')
  }

  // 2. バージョン形式のメッセージ (v0.1.0 / chore: release v2.3.1 etc.)
  const versionRe = /\bv\d+\.\d+(\.\d+)?\b/
  for (const c of commits) {
    if (!milestones.has(c.hash) && versionRe.test(c.message)) {
      milestones.set(c.hash, 'version')
    }
  }

  // 3. 大規模変更（変更行数が全コミットの中央値の3倍超）
  const changes = commits.map(c => c.insertions + c.deletions).filter(n => n > 0)
  if (changes.length >= 3) {
    const sorted = [...changes].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const threshold = median * 3
    if (threshold > 0) {
      for (const c of commits) {
        if (!milestones.has(c.hash) && (c.insertions + c.deletions) >= threshold) {
          milestones.set(c.hash, 'large_change')
        }
      }
    }
  }

  return milestones
}

// ===== Zone detection =====
const ZONE_LABELS: Record<CommitType, string> = {
  feature:   '機能開発',
  error_fix: 'バグ修正',
  refactor:  'リファクタリング',
  release:   'リリース準備',
  wip:       '試行錯誤',
  test:      'テスト整備',
  docs:      'ドキュメント整備',
  chore:     '環境整備',
  merge:     '統合作業',
  normal:    '作業',
  revert:    'やり直し',
}

function getDominantType(commits: CommitNode[]): CommitType {
  if (commits.length === 0) return 'normal'
  const counts = new Map<CommitType, number>()
  for (const c of commits) {
    // merge/normalは支配タイプとして弱くする（実質的な作業タイプを優先）
    const weight = (c.type === 'normal' || c.type === 'merge') ? 0.3 : 1
    counts.set(c.type, (counts.get(c.type) ?? 0) + weight)
  }
  let max = 0
  let dominant: CommitType = 'normal'
  for (const [type, cnt] of counts) {
    if (cnt > max) { max = cnt; dominant = type }
  }
  return dominant
}

function detectZones(commits: CommitNode[]): Zone[] {
  if (commits.length < 3) return []

  const sorted = [...commits].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const W = Math.max(3, Math.floor(sorted.length / 8))  // ウィンドウサイズ

  const zones: Zone[] = []
  let zoneStart = 0
  let currentTheme = getDominantType(sorted.slice(0, W))

  for (let i = W; i <= sorted.length; i += Math.max(1, Math.floor(W / 2))) {
    const end = Math.min(i + W, sorted.length)
    const windowTheme = getDominantType(sorted.slice(i, end))
    const isLast = end >= sorted.length

    if (windowTheme !== currentTheme || isLast) {
      const chunk = sorted.slice(zoneStart, isLast ? sorted.length : i)
      if (chunk.length > 0) {
        const dominant = getDominantType(chunk)
        const prev = zones[zones.length - 1]
        // 同じテーマが連続する場合はマージ
        if (prev && prev.theme === dominant) {
          prev.endTimestamp = chunk[chunk.length - 1].timestamp.getTime()
          prev.nodeCount += chunk.length
        } else {
          zones.push({
            id: `zone_${zones.length}`,
            label: ZONE_LABELS[dominant],
            theme: dominant,
            startTimestamp: chunk[0].timestamp.getTime(),
            endTimestamp: chunk[chunk.length - 1].timestamp.getTime(),
            nodeCount: chunk.length,
          })
        }
      }
      zoneStart = i
      currentTheme = windowTheme
    }
  }

  // 短すぎるゾーン（3コミット未満）は隣とマージ
  return zones.filter(z => z.nodeCount >= 3)
}

// ===== Lane info (branch purpose inference) =====
const BRANCH_PREFIXES = new Set([
  'feature', 'feat', 'fix', 'hotfix', 'bugfix', 'release', 'chore',
  'refactor', 'ref', 'test', 'docs', 'develop', 'dev', 'user', 'users',
])

function inferBranchLabel(branchName: string, lane: number, commits: CommitNode[]): string {
  if (lane === 0) return 'メインライン'

  const base = branchName.replace(/^(origin\/|remotes\/origin\/)/, '')

  if (base && base !== '__orphan__') {
    // スラッシュ・ハイフン・アンダースコアで分割してプレフィックスを除去
    const words = base.split(/[\/\-_]/).filter(w => w.length >= 2)
    const meaningful = words.filter(w => !BRANCH_PREFIXES.has(w.toLowerCase()))

    if (meaningful.length > 0) {
      return meaningful.slice(0, 3).join('-')
    }
    // プレフィックスのみなら最後の単語を使う
    return words[words.length - 1] ?? base
  }

  // ブランチ名なし → コミットメッセージの冒頭から推定
  if (commits.length > 0) {
    const firstMsg = [...commits]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0]
      .message.split('\n')[0]
    // conventionalコミットのスコープがあれば使う (feat(scope): ...)
    const scope = firstMsg.match(/\(([^)]+)\)/)
    if (scope) return scope[1]
    const words = firstMsg.replace(/^[a-z]+[:(]/, '').trim().split(/\s+/).slice(0, 3)
    return words.join(' ').slice(0, 24) || `Branch ${lane}`
  }

  return `Branch ${lane}`
}

function buildLaneInfos(commits: CommitNode[], laneMap: Map<string, number>): LaneInfo[] {
  const laneToCommits = new Map<number, CommitNode[]>()
  for (const c of commits) {
    const lane = laneMap.get(c.hash) ?? 0
    if (!laneToCommits.has(lane)) laneToCommits.set(lane, [])
    laneToCommits.get(lane)!.push(c)
  }

  const infos: LaneInfo[] = []
  for (const [lane, laneCommits] of laneToCommits) {
    const branchName = laneCommits
      .flatMap(c => c.branchNames)
      .find(b => {
        const base = b.replace(/^(origin\/|remotes\/origin\/)/, '')
        return !MAIN_BRANCH_NAMES.test(base) && base !== 'HEAD' && !base.startsWith('HEAD')
      }) ?? (lane === 0 ? 'main' : '')

    const label = inferBranchLabel(branchName, lane, laneCommits)
    const theme = getDominantType(laneCommits)

    infos.push({ lane, label, branchName, theme })
  }

  return infos.sort((a, b) => a.lane - b.lane)
}

// ===== Graph builder =====
export function buildMazeGraph(commits: CommitNode[]): MazeGraph {
  const mainHashes = findMainBranchHashes(commits)
  const laneMap = assignLanes(commits, mainHashes)
  const milestoneMap = detectMilestones(commits)
  const zones = detectZones(commits)
  const lanes = buildLaneInfos(commits, laneMap)
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
      isMilestone: milestoneMap.has(c.hash),
      milestoneReason: milestoneMap.get(c.hash),
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

  return { nodes, edges, zones, lanes }
}

export function getRepoName(repoPath: string): string {
  const parts = repoPath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || repoPath
}
