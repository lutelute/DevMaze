import type { AnalysisResult } from '../../shared/types'

type AnalyzeResponse = { ok: true; data: AnalysisResult; fromCache: boolean } | { ok: false; error: string }

export interface RepoStatus {
  prs: number
  issues: number
  ciStatus: 'success' | 'failure' | 'pending' | 'unknown'
  ciName: string | null
}

type GithubStatusResponse = { ok: true; data: RepoStatus } | { ok: false; error: string }

export interface RemoteCheck {
  behind: boolean
  branch: string | null
  localHead: string | null
  remoteHead: string | null
  error?: string
}

export interface FetchResult {
  fetched: boolean
  newCommits: number
  error?: string
}

type RefreshResponse =
  | { ok: true; data: AnalysisResult; fromCache: boolean; fetch: FetchResult }
  | { ok: false; error: string }

interface ElectronAPI {
  openRepoDialog: () => Promise<string | null>
  analyzeRepo: (repoPath: string, forceRefresh?: boolean) => Promise<AnalyzeResponse>
  openGithubRepo: (input: string) => Promise<AnalyzeResponse>
  getRecentRepos: () => Promise<string[]>
  exportReport: (repoPath: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  refreshRepo: (repoPath: string) => Promise<RefreshResponse>
  checkRemote: (repoPath: string) => Promise<RemoteCheck>
  openExternal: (url: string) => Promise<unknown>
  onProgress: (callback: (msg: string) => void) => () => void
  getInitialRepo: () => Promise<string | null>
  getGithubStatus: (owner: string, name: string) => Promise<GithubStatusResponse>
  startWatch: (repoPath: string) => void
  stopWatch: () => void
  onWatchChanged: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
