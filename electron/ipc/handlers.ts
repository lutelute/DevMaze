import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import path from 'path'
import fs from 'fs'
import simpleGit from 'simple-git'
import { analyzeRepo } from '../../shared/analyzer/index'
import { loadCache, saveCache } from './cache'
import { ensureGithubRepo } from './github'

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

async function analyzeWithCache(
  repoPath: string,
  forceRefresh: boolean,
  sendProgress: (msg: string) => void,
): Promise<{ ok: true; data: object; fromCache: boolean } | { ok: false; error: string }> {
  const git = simpleGit(repoPath)

  // bare repository でも動作する（checkIsRepo は bare で false を返す場合がある）
  let headCommit: string
  try {
    headCommit = (await git.revparse(['HEAD'])).trim()
  } catch {
    throw new Error(`Gitリポジトリが見つかりません: ${repoPath}`)
  }

  if (!forceRefresh) {
    const cached = loadCache(repoPath)
    if (cached?.headCommit === headCommit) {
      sendProgress('キャッシュから読み込み中...')
      return { ok: true, data: cached.data, fromCache: true }
    }
  }

  sendProgress('Gitログを取得中...')
  const result = await analyzeRepo(repoPath)
  sendProgress('解析完了')

  saveCache(repoPath, headCommit, result)
  return { ok: true, data: result, fromCache: false }
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

  ipcMain.handle('repo:analyze', async (event, repoPath: string, forceRefresh = false) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sendProgress = (msg: string) => win?.webContents.send('repo:progress', msg)

    try {
      const result = await analyzeWithCache(repoPath, forceRefresh, sendProgress)
      const recent = loadRecentRepos()
      recent.unshift(repoPath)
      saveRecentRepos(recent)
      return result
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // GitHub shorthand: "user/repo" または https://github.com/user/repo
  ipcMain.handle('repo:openGithub', async (event, input: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sendProgress = (msg: string) => win?.webContents.send('repo:progress', msg)

    try {
      sendProgress('GitHubリポジトリを確認中...')
      const localPath = await ensureGithubRepo(input, sendProgress)

      const result = await analyzeWithCache(localPath, false, sendProgress)
      const recent = loadRecentRepos()
      recent.unshift(localPath)
      saveRecentRepos(recent)
      return result
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('repo:getRecent', () => {
    return loadRecentRepos()
  })
}
