import { watch, type FSWatcher } from 'chokidar'
import path from 'node:path'
import fs from 'node:fs'
import type { BrowserWindow } from 'electron'
import { on, emit, senderWindow } from './typed'

let watcher: FSWatcher | null = null

/** HEAD・refs の変化だけを見る。作業ツリーの変更には反応しない */
export function startWatcher(repoPath: string, win: BrowserWindow): void {
  stopWatcher()
  const gitDir = fs.existsSync(path.join(repoPath, 'HEAD'))
    ? repoPath                       // bare
    : path.join(repoPath, '.git')    // 通常
  if (!fs.existsSync(gitDir)) return

  watcher = watch(
    [path.join(gitDir, 'HEAD'), path.join(gitDir, 'COMMIT_EDITMSG'), path.join(gitDir, 'refs', 'heads')],
    { persistent: true, ignoreInitial: true, depth: 1 },
  )
  watcher.on('change', () => emit(win, 'watch:changed'))
  watcher.on('add', () => emit(win, 'watch:changed'))
}

export function stopWatcher(): void {
  watcher?.close()
  watcher = null
}

export function registerWatchIpc(): void {
  on('watch:start', (event, repoPath) => {
    const win = senderWindow(event)
    if (win) startWatcher(repoPath, win)
  })
  on('watch:stop', () => stopWatcher())
}
