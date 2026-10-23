import { AppError, t } from '@svs/schema'
import { z } from 'zod'

import type { ProviderLabel } from '../http/errors'
import { readJson, request, type FetchLike } from '../http/fetch'

export const FAL_QUEUE_URL = 'https://queue.fal.run'
const PROVIDER: ProviderLabel = { name: 'fal.ai' }

export interface FalOptions {
  /** 每次呼叫時才取 Key（Key 只存在主行程的金庫裡）。 */
  getKey: () => string | undefined
  fetch?: FetchLike
  queueUrl?: string
  timeoutMs?: number
}

const SubmitResponseSchema = z.object({ request_id: z.string().min(1) })

const StatusResponseSchema = z.object({
  status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']),
  /** 有些端點在 COMPLETED 時把失敗原因放在這裡。 */
  error: z.unknown().optional(),
})

export type FalStatus = { state: 'pending' } | { state: 'completed'; failure?: string }

/**
 * fal 的佇列網址只認 `擁有者/應用` 兩段，端點後面的子路徑（例如 `/edit`、`/image-to-video`）
 * 只在送出時使用。查狀態、取結果、取消都要用前兩段。
 */
export function falAppId(endpoint: string): string {
  return endpoint.split('/').slice(0, 2).join('/')
}

export class FalClient {
  private readonly fetch: FetchLike
  private readonly queueUrl: string
  private readonly timeoutMs: number

  constructor(private readonly options: FalOptions) {
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init))
    this.queueUrl = options.queueUrl ?? FAL_QUEUE_URL
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  private headers(): Record<string, string> {
    const key = this.options.getKey()
    if (!key) {
      throw new AppError({
        code: 'provider_auth_failed',
        userMessage: t('errors.theFalAiServiceKey'),
      })
    }
    return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }
  }

  private req(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    return request(
      url,
      { ...init, headers: this.headers() },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: this.timeoutMs },
    )
  }

  /** 把任務排進佇列，回傳 request id。 */
  async submit(
    endpoint: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
    const response = await this.req(
      `${this.queueUrl}/${endpoint}`,
      { method: 'POST', body: JSON.stringify(input) },
      signal,
    )
    const parsed = SubmitResponseSchema.safeParse(await readJson(response, PROVIDER))
    if (!parsed.success) {
      throw new AppError({
        code: 'invalid_response',
        retryable: true,
        userMessage: t('errors.falAiReturnedContentIn'),
        cause: parsed.error,
      })
    }
    return parsed.data.request_id
  }

  async status(endpoint: string, requestId: string, signal: AbortSignal): Promise<FalStatus> {
    const response = await this.req(
      `${this.queueUrl}/${falAppId(endpoint)}/requests/${encodeURIComponent(requestId)}/status`,
      { method: 'GET' },
      signal,
    )
    const parsed = StatusResponseSchema.safeParse(await readJson(response, PROVIDER))
    if (!parsed.success) {
      throw new AppError({
        code: 'invalid_response',
        retryable: true,
        userMessage: t('errors.falAiReturnedAStatus'),
        cause: parsed.error,
      })
    }
    if (parsed.data.status !== 'COMPLETED') return { state: 'pending' }
    const { error } = parsed.data
    if (error === undefined || error === null || error === '') return { state: 'completed' }
    return {
      state: 'completed',
      failure: typeof error === 'string' ? error : JSON.stringify(error),
    }
  }

  /** 取回完成任務的結果（JSON，由 driver 依能力解讀）。 */
  async result(endpoint: string, requestId: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.req(
      `${this.queueUrl}/${falAppId(endpoint)}/requests/${encodeURIComponent(requestId)}`,
      { method: 'GET' },
      signal,
    )
    return readJson(response, PROVIDER)
  }

  /** 只有還在排隊的任務能取消；其他情況 fal 會回 400，視為無需處理。 */
  async cancel(endpoint: string, requestId: string, signal: AbortSignal): Promise<void> {
    try {
      await this.req(
        `${this.queueUrl}/${falAppId(endpoint)}/requests/${encodeURIComponent(requestId)}/cancel`,
        { method: 'PUT' },
        signal,
      )
    } catch (error) {
      if (error instanceof AppError && error.code === 'provider_rejected') return
      throw error
    }
  }

  /**
   * 測試 Key：fal 沒有專用的驗證端點，所以查一個不存在的任務——
   * Key 無效回 401/403，Key 有效則回 404（找不到任務）。
   */
  async testKey(endpoint: string, signal: AbortSignal): Promise<boolean> {
    try {
      await this.status(endpoint, '00000000-0000-0000-0000-000000000000', signal)
      return true
    } catch (error) {
      if (error instanceof AppError && error.code === 'provider_auth_failed') return false
      if (error instanceof AppError && error.code === 'provider_rejected') return true
      throw error
    }
  }

  /** 下載結果檔案（公開網址，不帶 Key）。 */
  async download(
    url: string,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; mime: string | undefined }> {
    const response = await request(
      url,
      { method: 'GET' },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: this.timeoutMs * 4 },
    )
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge()
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw tooLarge()
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim()
    return { bytes, mime: mime === '' ? undefined : mime }
  }
}

const tooLarge = (): AppError =>
  new AppError({ code: 'provider_rejected', userMessage: t('errors.theFileFalAiReturned') })
