import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openRepoDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openRepo'),

  analyzeRepo: (repoPath: string): Promise<unknown> =>
    ipcRenderer.invoke('repo:analyze', repoPath),

  getRecentRepos: (): Promise<string[]> =>
    ipcRenderer.invoke('repo:getRecent'),

  onProgress: (callback: (msg: string) => void) => {
    const listener = (_: unknown, msg: string) => callback(msg)
    ipcRenderer.on('repo:progress', listener)
    return () => ipcRenderer.removeListener('repo:progress', listener)
  },

  getInitialRepo: (): Promise<string | null> =>
    ipcRenderer.invoke('dev:getInitialRepo'),
})
