import type { AnalysisResult } from '../../shared/types'

type AnalyzeResponse = { ok: true; data: AnalysisResult; fromCache: boolean } | { ok: false; error: string }

interface ElectronAPI {
  openRepoDialog: () => Promise<string | null>
  analyzeRepo: (repoPath: string, forceRefresh?: boolean) => Promise<AnalyzeResponse>
  openGithubRepo: (input: string) => Promise<AnalyzeResponse>
  getRecentRepos: () => Promise<string[]>
  onProgress: (callback: (msg: string) => void) => () => void
  getInitialRepo: () => Promise<string | null>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
