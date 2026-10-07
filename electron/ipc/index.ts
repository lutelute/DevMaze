import { registerRepoIpc } from './repo'
import { registerExportIpc } from './export'
import { registerWatchIpc } from './watcher'
import { registerShellIpc } from './shellext'

export function registerIpc(): void {
  registerRepoIpc()
  registerExportIpc()
  registerWatchIpc()
  registerShellIpc()
}
