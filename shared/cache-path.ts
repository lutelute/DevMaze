import os from 'node:os'
import path from 'node:path'

/**
 * DevMaze のデータ置き場。アプリ（Electron）と MCP サーバーの両方が同じ場所を見る。
 *
 * Electron の app.getPath('userData') は開発時は package.json の name、配布物では
 * productName から決まるので、何もしないと "devmaze" と "DevMaze" に割れる。
 * MCP は Electron 無しで動くので、そもそも app を呼べない。
 * 場所をここで1つに決め、Electron 側は app.setPath('userData', dataDir()) で合わせる。
 */
export function dataDir(): string {
  if (process.env.DEVMAZE_DATA_DIR) return process.env.DEVMAZE_DATA_DIR
  const home = os.homedir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'devmaze')
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'devmaze')
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'devmaze')
}

export const repoCacheDir = () => path.join(dataDir(), 'repo-cache')
export const githubReposDir = () => path.join(dataDir(), 'github-repos')
export const recentReposFile = () => path.join(dataDir(), 'recent-repos.json')
