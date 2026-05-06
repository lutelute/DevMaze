import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { analyzeRepo } from '../../shared/analyzer/index'

const RECENT_REPOS_PATH = path.join(app.getPath('userData'), 'recent-repos.json')

function loadRecentRepos(): string[] {
  try {
    if (fs.existsSync(RECENT_REPOS_PATH)) {
      return JSON.parse(fs.readFileSync(RECENT_REPOS_PATH, 'utf-8'))
    }
  } catch {}
  return []
}

function saveRecentRepos(repos: string[]): void {
  try {
    const unique = [...new Set(repos)].slice(0, 10)
    fs.writeFileSync(RECENT_REPOS_PATH, JSON.stringify(unique), 'utf-8')
  } catch {}
}

export function setupIpcHandlers() {
  ipcMain.handle('dev:getInitialRepo', () => {
    return process.env.DEVMAZE_REPO ?? null
  })

  ipcMain.handle('dialog:openRepo', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Gitリポジトリを選択',
      properties: ['openDirectory'],
      message: 'Gitリポジトリのルートディレクトリを選択してください',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('repo:analyze', async (event, repoPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    const sendProgress = (msg: string) => {
      win?.webContents.send('repo:progress', msg)
    }

    try {
      sendProgress('Gitログを取得中...')
      const result = await analyzeRepo(repoPath)
      sendProgress('解析完了')

      // Save to recent
      const recent = loadRecentRepos()
      recent.unshift(repoPath)
      saveRecentRepos(recent)

      return { ok: true, data: result }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('repo:getRecent', () => {
    return loadRecentRepos()
  })
}
