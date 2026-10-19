import {
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNEL,
  IpcEventEnvelopeSchema,
  IpcResultSchema,
  ipcEvents,
  isIpcChannel,
  isIpcEventName,
  type IpcResult,
  type SvsApi,
} from '@svs/schema'

/** 跟 Electron 的 ipcRenderer 溝通的最小介面，方便在測試裡替換。 */
export interface Transport {
  invoke: (channel: string, message: unknown) => Promise<unknown>
  on: (channel: string, listener: (message: unknown) => void) => () => void
}

const unknownChannel = (): IpcResult<never> => ({
  ok: false,
  error: { code: 'unknown_channel', retryable: false, userMessage: '這個功能不存在。' },
})

/** 建立 `window.svs`。沒有在合約定義的 channel / 事件，在這裡就會被擋下。 */
export function createSvsApi(transport: Transport): SvsApi {
  const listeners = new Map<string, Set<(payload: never) => void>>()

  transport.on(IPC_EVENT_CHANNEL, (message) => {
    const envelope = IpcEventEnvelopeSchema.safeParse(message)
    if (!envelope.success || !isIpcEventName(envelope.data.name)) return
    const name = envelope.data.name
    const payload = ipcEvents[name].safeParse(envelope.data.payload)
    if (!payload.success) return
    for (const listener of listeners.get(name) ?? []) listener(payload.data as never)
  })

  return Object.freeze({
    invoke: (async (channel: string, payload: unknown) => {
      if (!isIpcChannel(channel)) return unknownChannel()
      const result = IpcResultSchema.safeParse(
        await transport.invoke(IPC_INVOKE_CHANNEL, { channel, payload }),
      )
      if (!result.success) {
        return {
          ok: false,
          error: {
            code: 'invalid_response',
            retryable: false,
            userMessage: '發生內部錯誤。',
          },
        } satisfies IpcResult<never>
      }
      return result.data
    }) as SvsApi['invoke'],

    on: (event: string, listener: (payload: never) => void) => {
      if (!isIpcEventName(event)) return () => undefined
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
  })
}
