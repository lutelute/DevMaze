import { dialog } from 'electron'
import { analyzeWithCache, loadRecentRepos, pushRecentRepo } from '../../shared/cache'
import type { ProgressMessage } from '../../shared/ipc'
import { handle, emit, senderWindow, guarded } from './typed'
import { ensureGithubRepo, parseGithubInput, fetchLatest, checkRemote, fetchRepoStatus } from './github'

type Progress = (m: ProgressMessage) => void

function progressFor(event: { sender: Electron.WebContents }): Progress {
  const win = senderWindow(event)
  return m => emit(win, 'repo:progress', m)
}

async function analyze(repoPath: string, forceRefresh: boolean, progress: Progress) {
  const r = await analyzeWithCache(repoPath, {
    forceRefresh,
    onStage: p => progress({ kind: 'stage', stage: p.stage, detail: p.detail }),
    onCacheHit: () => progress({ kind: 'text', text: 'キャッシュから読み込み中...' }),
  })
  pushRecentRepo(repoPath)
  return r
}

export function registerRepoIpc(): void {
  handle('repo:initial', () => process.env.DEVMAZE_REPO ?? null)
  handle('repo:recent', () => loadRecentRepos())

  handle('repo:pickFolder', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Git リポジトリを選択',
      properties: ['openDirectory'],
      message: 'Git リポジトリのルートを選んでください',
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  handle('repo:analyze', (event, repoPath, opts) => guarded(async () => {
    const r = await analyze(repoPath, opts?.forceRefresh ?? false, progressFor(event))
    return { ok: true as const, ...r }
  }))

  // GitHub の user/repo または URL。bare clone をキャッシュしてから解析する
  handle('repo:openGithub', (event, input) => guarded(async () => {
    const progress = progressFor(event)
    const parsed = parseGithubInput(input)
    if (!parsed) {
      throw new Error(`形式が不正です: "${input}"\n例: lutelute/AtelierX または https://github.com/lutelute/AtelierX`)
    }
    progress({ kind: 'text', text: 'GitHub リポジトリを確認中...' })
    const localPath = await ensureGithubRepo(input, text => progress({ kind: 'text', text }))
    const r = await analyze(localPath, false, progress)
    return { ok: true as const, ...r, github: { owner: parsed.owner, name: parsed.name } }
  }))

  // 再スキャンは「リモートから取り込んでから」。手元だけ読み直しても GitHub の新着は永久に反映されない
  handle('repo:refresh', (event, repoPath) => guarded(async () => {
    const progress = progressFor(event)
    progress({ kind: 'text', text: 'リモートから取り込み中...' })
    const fetch = await fetchLatest(repoPath)
    progress({ kind: 'text', text:
      fetch.error ? '取り込めませんでした。手元の履歴で解析します...'
      : fetch.newCommits > 0 ? `新着 ${fetch.newCommits} 件を取り込みました。解析中...`
      : '最新でした。解析中...' })
    const r = await analyze(repoPath, true, progress)
    return { ok: true as const, ...r, fetch }
  }))

  handle('repo:checkRemote', (_e, repoPath) => checkRemote(repoPath))

  handle('github:status', (_e, owner, name) => guarded(async () => ({
    ok: true as const, data: await fetchRepoStatus(owner, name),
  })))
}
