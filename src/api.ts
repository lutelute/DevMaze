/**
 * レンダラーから見た唯一の外界。window.devmaze（preload）を型付きで包む。
 * テスト（jsdom）では window.devmaze が無いので、呼ばれたら分かる形で落とす。
 */
import type { DevmazeApi } from '@shared/ipc'

export const api: DevmazeApi = {
  invoke: (channel, ...args) => {
    if (!window.devmaze) return Promise.reject(new Error(`devmaze api is not available (${channel})`))
    return window.devmaze.invoke(channel, ...args)
  },
  send: (channel, ...args) => window.devmaze?.send(channel, ...args),
  on: (channel, listener) => window.devmaze?.on(channel, listener) ?? (() => {}),
}
