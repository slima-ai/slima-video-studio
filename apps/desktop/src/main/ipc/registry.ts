import {
  AppError,
  IpcEnvelopeSchema,
  ipcContract,
  ipcEvents,
  isAppError,
  isIpcChannel,
  type AppErrorShape,
  type IpcChannel,
  type IpcEventName,
  type IpcEventPayload,
  type IpcParsedRequest,
  type IpcResponse,
  type IpcResult,
} from '@svs/schema'

import type { Logger } from '../logger'

/** handler 可以用的工具（每次呼叫都綁定到發出請求的視窗）。 */
export interface HandlerContext {
  emit: <E extends IpcEventName>(event: E, payload: IpcEventPayload<E>) => void
}

export type IpcHandler<C extends IpcChannel> = (
  payload: IpcParsedRequest<C>,
  ctx: HandlerContext,
) => IpcResponse<C> | Promise<IpcResponse<C>>

export interface IpcRegistry {
  /** 註冊 channel 的實作；channel 必須在合約內，且不能重複註冊。 */
  registerHandler: <C extends IpcChannel>(channel: C, impl: IpcHandler<C>) => void
  /** 處理 renderer 傳來的原始訊息，永遠回傳型別化結果，不會 throw。 */
  dispatch: (raw: unknown, ctx: HandlerContext) => Promise<IpcResult<unknown>>
  /** 合約內還沒有實作的 channel。 */
  missingHandlers: () => IpcChannel[]
}

/** 錯誤細節只寫進 log。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return typeof error === 'string' ? error : JSON.stringify(error)
}

const fail = (error: AppErrorShape): IpcResult<never> => ({ ok: false, error })

export function createIpcRegistry(log: Pick<Logger, 'error' | 'warn'>): IpcRegistry {
  // 這裡的 handler 型別被抹掉了；進出都會經過 Zod 驗證，所以安全。
  const handlers = new Map<string, (payload: unknown, ctx: HandlerContext) => unknown>()

  return {
    registerHandler(channel, impl) {
      if (handlers.has(channel)) throw new Error(`channel 重複註冊：${channel}`)
      handlers.set(channel, impl as (payload: unknown, ctx: HandlerContext) => unknown)
    },

    missingHandlers() {
      return (Object.keys(ipcContract) as IpcChannel[]).filter((c) => !handlers.has(c))
    },

    async dispatch(raw, ctx) {
      const envelope = IpcEnvelopeSchema.safeParse(raw)
      if (!envelope.success) {
        log.warn('IPC 訊息格式錯誤')
        return fail({
          code: 'invalid_request',
          retryable: false,
          userMessage: '請求格式不正確。',
        })
      }
      const { channel, payload } = envelope.data

      const impl = handlers.get(channel)
      if (!isIpcChannel(channel) || !impl) {
        log.warn(`呼叫了未定義的 channel：${channel}`)
        return fail({
          code: 'unknown_channel',
          retryable: false,
          userMessage: '這個功能不存在。',
        })
      }

      const parsedRequest = ipcContract[channel].request.safeParse(payload)
      if (!parsedRequest.success) {
        log.warn(`IPC ${channel} 的 payload 驗證失敗：${parsedRequest.error.message}`)
        return fail({
          code: 'invalid_request',
          retryable: false,
          userMessage: '請求內容不正確。',
        })
      }

      let result: unknown
      try {
        result = await impl(parsedRequest.data, ctx)
      } catch (error) {
        if (isAppError(error)) {
          if (error.cause !== undefined)
            log.error(`IPC ${channel} 失敗：${describeError(error.cause)}`)
          return fail(error.toShape())
        }
        // 未知錯誤：細節只進 log，不把原始訊息丟給 renderer
        log.error(`IPC ${channel} 發生未預期錯誤：${describeError(error)}`)
        return fail(
          new AppError({
            code: 'internal_error',
            userMessage: '發生未預期的錯誤，請稍後再試。',
          }).toShape(),
        )
      }

      const parsedResponse = ipcContract[channel].response.safeParse(result)
      if (!parsedResponse.success) {
        log.error(`IPC ${channel} 的回傳值不符合合約：${parsedResponse.error.message}`)
        return fail({
          code: 'invalid_response',
          retryable: false,
          userMessage: '發生內部錯誤。',
        })
      }
      return { ok: true, data: parsedResponse.data }
    },
  }
}

/** 驗證事件 payload；不符合合約就 throw（這是程式錯誤，不是使用者錯誤）。 */
export function parseEventPayload<E extends IpcEventName>(
  event: E,
  payload: unknown,
): IpcEventPayload<E> {
  // 每個事件的 schema 輸出就是它的 payload 型別；泛型 E 讓 TS 無法自己對上，這裡明確轉型
  return ipcEvents[event].parse(payload) as IpcEventPayload<E>
}
