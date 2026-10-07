import type { AnalysisResult, StruggleEpisode, Zone } from '@shared/types'
import type { ProgressMessage, GithubRef } from '@shared/ipc'

export type ViewMode = 'maze' | 'calendar'
export type Unit = 'commit' | 'session' | null
export type SidebarTab = 'overview' | 'struggles' | 'hotspots' | 'repos'

export type Phase =
  | { phase: 'idle' }
  | { phase: 'loading'; progress: ProgressMessage }
  // 何をしようとして失敗したかを持つ。同じ条件で再試行できるように
  | { phase: 'error'; message: string; target?: string; retry?: () => void }
  | { phase: 'ready'; result: AnalysisResult; fromCache: boolean }

/** 迷路の一部だけを浮かび上がらせる注目対象。沼（時間）とファイル（場所）を同じ仕組みで扱う */
export type Focus =
  | { kind: 'struggle'; episode: StruggleEpisode; hashes: string[] }
  | { kind: 'file'; path: string; hashes: string[] }
  | { kind: 'session'; hashes: string[] }
  | { kind: 'zone'; zone: Zone; hashes: string[] }
  | null

export interface Camera { x: number; y: number; k: number }

/** 戻るで巻き戻すのは「画面に取り消す手段が無いもの」だけ。フィルターや表示件数は1クリックで戻せるので積まない */
export interface NavState {
  unit: Unit
  focus: Focus
  selectedHash: string | null
  camera: Camera | null
}

export interface RepoSlice {
  phase: Phase
  repoPath: string | null
  github: GithubRef | null
  recentRepos: string[]
  remoteBehind: boolean
  watchBanner: boolean
  toast: string | null
}

export interface ViewSlice {
  viewMode: ViewMode
  unit: Unit
  displayLimit: number
  filterTypes: Set<string>
  focus: Focus
  selectedHash: string | null
  sidebarTab: SidebarTab
  sidebarCollapsed: boolean
  sidebarWidth: number
  searchOpen: boolean
  helpOpen: boolean
  legendOpen: boolean
}

export interface NavSlice {
  past: NavState[]
  ahead: NavState | null
  pendingCamera: Camera | null
  /** 迷路が登録する「いまのカメラ」の読み口。迷路が無いときは null を返す */
  cameraReader: (() => Camera | null) | null
}

export type StoreState = RepoSlice & ViewSlice & NavSlice
