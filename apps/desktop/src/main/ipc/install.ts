import {
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNEL,
  type IpcEventName,
  type IpcEventPayload,
  type IpcResult,
  t,
} from '@svs/schema'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

import type { Logger } from '../logger'
import { isInternalUrl } from '../navigation'
import { parseEventPayload, type HandlerContext, type IpcRegistry } from './registry'

/** 把 registry 接到 Electron 的 ipcMain；只接受來自 App 自己頁面的請求。 */
export function installIpc(
  registry: IpcRegistry,
  getAppUrl: () => string,
  log: Logger,
): { broadcast: <E extends IpcEventName>(event: E, payload: IpcEventPayload<E>) => void } {
  ipcMain.handle(
    IPC_INVOKE_CHANNEL,
    async (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<unknown>> => {
      const senderUrl = event.senderFrame?.url ?? ''
      if (!isInternalUrl(senderUrl, getAppUrl())) {
        log.warn(`Rejected IPC from an external page: ${senderUrl}`)
        return {
          ok: false,
          error: {
            code: 'untrusted_sender',
            retryable: false,
            userMessage: t('services.thisRequestIsnTFrom'),
          },
        }
      }
      const ctx: HandlerContext = {
        emit: (name, payload) => {
          event.sender.send(IPC_EVENT_CHANNEL, {
            name,
            payload: parseEventPayload(name, payload),
          })
        },
      }
      return registry.dispatch(raw, ctx)
    },
  )

  return {
    // 主行程主動通知所有視窗（例如任務進度）；payload 先照合約驗證
    broadcast: (name, payload) => {
      const message = { name, payload: parseEventPayload(name, payload) }
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC_EVENT_CHANNEL, message)
      }
    },
  }
}
