import type { AnalysisResult } from '../../shared/types'

type AnalyzeResponse = { ok: true; data: AnalysisResult; fromCache: boolean } | { ok: false; error: string }

export interface RepoStatus {
  prs: number
  issues: number
  ciStatus: 'success' | 'failure' | 'pending' | 'unknown'
  ciName: string | null
}

type GithubStatusResponse = { ok: true; data: RepoStatus } | { ok: false; error: string }

interface ElectronAPI {
  openRepoDialog: () => Promise<string | null>
  analyzeRepo: (repoPath: string, forceRefresh?: boolean) => Promise<AnalyzeResponse>
  openGithubRepo: (input: string) => Promise<AnalyzeResponse>
  getRecentRepos: () => Promise<string[]>
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
