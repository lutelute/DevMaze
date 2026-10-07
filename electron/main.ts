import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { dataDir } from '../shared/cache-path'
import { registerIpc } from './ipc/index'

// データ置き場をアプリと MCP で揃える（既定のままだと開発時と配布物で名前が割れる）
app.setPath('userData', dataDir())

// 開発時だけ CDP を開ける。見た目のスクリーンショットだけでなく、
// 実際に押して確かめるため（押しても何も起きない不具合はスクショに写らない）。
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.DEVMAZE_CDP_PORT ?? '9222')
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#15100A',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 外部リンクはアプリ内で開かず既定のブラウザへ
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

registerIpc()

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
