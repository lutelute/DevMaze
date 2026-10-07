import { contextBridge, ipcRenderer } from 'electron'
import type { DevmazeApi } from '../shared/ipc'

// 契約（shared/ipc.ts）をそのまま通す薄い橋。チャンネル名はここに書かない。
const api: DevmazeApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      (listener as (...a: unknown[]) => void)(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
}

contextBridge.exposeInMainWorld('devmaze', api)
