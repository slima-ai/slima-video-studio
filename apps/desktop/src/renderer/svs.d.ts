import type { SvsApi } from '@svs/schema'

declare global {
  interface Window {
    /** 由 preload 暴露的型別化 IPC。 */
    svs: SvsApi
  }
}

export {}
