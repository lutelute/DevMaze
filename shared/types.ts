// ===== Commit Types =====
export type CommitType =
  | 'normal'       // 通常のコミット
  | 'error_fix'    // fix / bug / error / hotfix を含む
  | 'revert'       // Revert コミット
  | 'merge'        // マージコミット（親が2つ以上）
  | 'wip'          // WIP / TODO / FIXME / draft
  | 'feature'      // feat / feature / add / implement
  | 'release'      // release / v1.x.x / version

// ===== Raw Commit from Git =====
export interface CommitNode {
  hash: string
  shortHash: string
  parentHashes: string[]
  authorName: string
  authorEmail: string
  timestamp: Date
  message: string
  filesChanged: number
  insertions: number
  deletions: number
  type: CommitType
  branchNames: string[]
  tagNames: string[]
  revertedHash?: string  // revert commit の場合、元のコミットハッシュ
}

// ===== Graph Node (for D3) =====
export interface MazeNode {
  id: string
  label: string
  type: CommitType
  timestamp: number        // epoch ms
  filesChanged: number
  insertions: number
  deletions: number
  authorName: string
  message: string
  branchNames: string[]
  tagNames: string[]
  isMainBranch: boolean    // main/master/develop ブランチ上のコミット
  lane: number             // branch swimlane index (0=main, ±1,±2,... = feature)
  // D3 simulation adds these:
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

// ===== Graph Edge (for D3) =====
export interface MazeEdge {
  id: string
  source: string | MazeNode
  target: string | MazeNode
  type: 'parent' | 'merge_parent' | 'revert_of'
}

// ===== Full Maze Graph =====
export interface MazeGraph {
  nodes: MazeNode[]
  edges: MazeEdge[]
}

// ===== Score Details =====
export interface ScoreDetail {
  label: string
  count: number
  weight: number
  subtotal: number
}

export interface TrialScore {
  total: number
  level: 'clean' | 'normal' | 'messy' | 'chaotic'
  details: ScoreDetail[]
}

// ===== Full Analysis Result =====
export interface AnalysisResult {
  repoPath: string
  repoName: string
  graph: MazeGraph
  score: TrialScore
  stats: {
    totalCommits: number
    authors: string[]
    dateRange: { start: string; end: string }
    branchCount: number
    mergeCount: number
    revertCount: number
    errorFixCount: number
    wipCount: number
  }
  summary: string
}

// ===== IPC Channels =====
export const IPC = {
  OPEN_REPO_DIALOG: 'dialog:openRepo',
  ANALYZE_REPO: 'repo:analyze',
  ANALYSIS_PROGRESS: 'repo:progress',
  GET_RECENT_REPOS: 'repo:getRecent',
} as const
