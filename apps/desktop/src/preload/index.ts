import { contextBridge, ipcRenderer } from 'electron'

import { createSvsApi } from './api'

// renderer 只拿得到 window.svs.invoke / window.svs.on，拿不到 ipcRenderer 本體。
contextBridge.exposeInMainWorld(
  'svs',
  createSvsApi({
    invoke: (channel, message) => ipcRenderer.invoke(channel, message) as Promise<unknown>,
    on: (channel, listener) => {
      const wrapped = (_event: unknown, message: unknown): void => {
        listener(message)
      }
      ipcRenderer.on(channel, wrapped)
      return () => {
        ipcRenderer.removeListener(channel, wrapped)
      }
    },
  }),
)
