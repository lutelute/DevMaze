import chokidar from 'chokidar'
import path from 'path'
import fs from 'fs'
import type { BrowserWindow } from 'electron'

let watcher: chokidar.FSWatcher | null = null

export function startWatcher(repoPath: string, win: BrowserWindow): void {
  stopWatcher()

  // bare repo (.git ディレクトリがない) の場合はスキップ
  const gitDir = fs.existsSync(path.join(repoPath, 'HEAD'))
    ? repoPath                          // bare
    : path.join(repoPath, '.git')       // normal

  if (!fs.existsSync(gitDir)) return

  watcher = chokidar.watch(
    [
      path.join(gitDir, 'HEAD'),
      path.join(gitDir, 'COMMIT_EDITMSG'),
      path.join(gitDir, 'refs', 'heads'),
    ],
    { persistent: true, ignoreInitial: true, depth: 1 }
  )

  watcher.on('change', () => {
    if (!win.isDestroyed()) win.webContents.send('watch:changed')
  })
}

export function stopWatcher(): void {
  watcher?.close()
  watcher = null
}
