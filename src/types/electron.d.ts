import type { AnalysisResult } from '../../shared/types'

interface ElectronAPI {
  openRepoDialog: () => Promise<string | null>
  analyzeRepo: (repoPath: string) => Promise<{ ok: true; data: AnalysisResult } | { ok: false; error: string }>
  getRecentRepos: () => Promise<string[]>
  onProgress: (callback: (msg: string) => void) => () => void
  getInitialRepo: () => Promise<string | null>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
