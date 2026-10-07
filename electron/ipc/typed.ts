import { ipcMain, BrowserWindow, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron'
import type { IpcInvokeMap, IpcSendMap, IpcEventMap, InvokeChannel, SendChannel, EventChannel } from '../../shared/ipc'

/** 契約に沿った handle。チャンネル名の打ち間違いと引数の食い違いをコンパイルで落とす */
export function handle<K extends InvokeChannel>(
  channel: K,
  fn: (event: IpcMainInvokeEvent, ...args: IpcInvokeMap[K]['args']) => Promise<IpcInvokeMap[K]['result']> | IpcInvokeMap[K]['result'],
): void {
  ipcMain.handle(channel, (event, ...args) => fn(event, ...(args as IpcInvokeMap[K]['args'])))
}

export function on<K extends SendChannel>(
  channel: K,
  fn: (event: IpcMainEvent, ...args: IpcSendMap[K]) => void,
): void {
  ipcMain.on(channel, (event, ...args) => fn(event, ...(args as IpcSendMap[K])))
}

export function emit<K extends EventChannel>(
  win: BrowserWindow | null | undefined,
  channel: K,
  ...args: IpcEventMap[K]
): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

export const senderWindow = (event: { sender: Electron.WebContents }) =>
  BrowserWindow.fromWebContents(event.sender)

/** 例外を { ok: false, error } に畳む */
export async function guarded<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
