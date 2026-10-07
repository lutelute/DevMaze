import { shell } from 'electron'
import { handle } from './typed'

export function registerShellIpc(): void {
  // 外部リンクはアプリ内で遷移させず、既定のブラウザに渡す
  handle('shell:openExternal', async (_e, url) => {
    if (!/^https?:\/\//.test(url)) return { ok: false, error: 'invalid url' }
    await shell.openExternal(url)
    return { ok: true }
  })
}
