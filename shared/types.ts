// ===== Commit Types =====
export type CommitType =
  | 'normal'       // 通常のコミット
  | 'error_fix'    // fix / bug / error / hotfix
  | 'revert'       // Revert コミット
  | 'merge'        // マージコミット（親が2つ以上）
  | 'wip'          // WIP / TODO / FIXME / draft
  | 'feature'      // feat / feature / add / implement
  | 'release'      // release / v1.x.x / version
  | 'chore'        // chore / ci / build / deps
  | 'docs'         // docs / readme / changelog
  | 'refactor'     // refactor / restructure / cleanup
  | 'test'         // test / spec / coverage

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
  revertedHash?: string
  files: string[]          // このコミットが触ったファイル（マージコミットは空）
}

// ===== Struggle (沼) — 開発過程で詰まった箇所 =====
export type StruggleKind =
  | 'revert_loop'   // やり直しの輪: revert とその周辺で同じ場所を往復
  | 'fix_chain'     // 修正の連鎖: 短期間に fix が続く
  | 'file_churn'    // 同じファイルの往復: 特定ファイルを短期間に何度も書き直す
  | 'wip_drift'     // WIP の漂流: 未完成コミットが続く
  | 'stall_burst'   // 停滞のあとの一気書き: 長い空白の直後に修正/大量変更

export interface StruggleCommitRef {
  hash: string
  shortHash: string
  message: string
  type: CommitType
  timestamp: number
}

export interface StruggleEpisode {
  id: string
  kind: StruggleKind
  title: string                 // 「〜で詰まった」形式の一行
  severity: number              // 0-100（深刻度）
  startTimestamp: number
  endTimestamp: number
  durationHours: number
  commits: StruggleCommitRef[]
  files: { path: string; touches: number }[]
  escape?: StruggleCommitRef    // 沼を抜けた（と思われる）最後のコミット
  evidence: string[]            // 判定の数値的根拠（人間/エージェントが再判断できるように）
  /** 同じ場所で時期を空けて繰り返している場合の情報 */
  recurrence?: {
    file: string
    times: number       // 同じファイルで起きた沼の回数
    index: number       // これが何回目か（1始まり）
    firstAt: number     // 最初に起きた時刻
  }
  /** この沼のコミットのうち、夜（22-5時）に打たれた割合 0-1 */
  nightRatio: number
}

// ===== Development Zone (time-based phase) =====
export interface Zone {
  id: string
  label: string         // "機能開発期" / "バグ修正期" etc.
  theme: CommitType     // 支配的なコミットタイプ
  startTimestamp: number
  endTimestamp: number
  nodeCount: number
}

// ===== Lane metadata (branch purpose) =====
export interface LaneInfo {
  lane: number
  label: string         // ブランチ目的ラベル（推定）
  branchName: string    // オリジナルのブランチ名
  theme: CommitType     // 支配的なコミットタイプ
}

// ===== File Hotspot（荒れている場所） =====
export interface FileHotspot {
  path: string
  commits: number        // このファイルを変更したコミット数
  fixCommits: number     // うち修正・やり直し
  fixRatio: number       // 0-1
  authors: number
  insertions: number     // コミット単位の値をファイル数で按分した概算
  deletions: number
  firstTouched: number
  lastTouched: number
  risk: number           // 0-100
  reasons: string[]
}

// ===== Activity（どう働いていたか） =====
export interface AuthorStat {
  name: string
  commits: number
  fixCommits: number
  insertions: number
  deletions: number
  firstSeen: number
  lastSeen: number
}

export interface ActivityProfile {
  byHour: number[]        // 0-23
  byWeekday: number[]     // 0(日)-6(土)
  nightRatio: number      // 22-5時の割合 0-1
  weekendRatio: number
  busiestDay: { date: string; count: number } | null
  activeDays: number      // コミットのあった日数
  spanDays: number        // 最初から最後までの日数
  commitsPerActiveDay: number
  longestStreakDays: number
  longestBreakDays: number
  authors: AuthorStat[]
}

// ===== Graph Node (for D3) =====
export interface MazeNode {
  id: string
  label: string
  type: CommitType
  timestamp: number
  filesChanged: number
  insertions: number
  deletions: number
  authorName: string
  message: string
  branchNames: string[]
  tagNames: string[]
  files: string[]
  /** コミットメッセージ中の (#123) — PR / Issue 番号 */
  refs: number[]
  isMainBranch: boolean
  lane: number
  isMilestone: boolean
  milestoneReason?: 'tag' | 'version' | 'large_change'
  // D3 simulation adds these:
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

// ===== Work Session（連続して書いた一続きの作業）=====
export interface WorkSession {
  id: string
  startTimestamp: number
  endTimestamp: number
  commitCount: number
  commitHashes: string[]
  type: CommitType        // その作業を支配するコミット種別
  lane: number
  isMainBranch: boolean
  insertions: number
  deletions: number
  fileCount: number
  label: string           // タグ > 版番号 > 最初のコミットの件名
  hasMilestone: boolean
  tagNames: string[]
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
  zones: Zone[]
  lanes: LaneInfo[]
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
  struggles: StruggleEpisode[]
  hotspots: FileHotspot[]
  activity: ActivityProfile
  /** origin のURL（コミットやPRへのリンクを組み立てるのに使う） */
  remoteUrl?: string
  stats: {
    totalCommits: number
    authors: string[]
    dateRange: { start: string; end: string }
    branchCount: number
    mergeCount: number
    revertCount: number
    errorFixCount: number
    wipCount: number
    // ファイル単位の差分を取得できたコミットの割合（0-1）。
    // shallow clone やオブジェクト欠損のリポジトリでは下がり、沼検出の精度も落ちる。
    fileStatsCoverage: number
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
