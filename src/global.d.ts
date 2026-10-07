import type { DevmazeApi } from '../shared/ipc'

declare global {
  interface Window {
    devmaze: DevmazeApi
  }
}

export {}
