import { AppError, t } from '@svs/schema'

import { httpError, networkError, type ProviderLabel } from './errors'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface RequestOptions {
  fetch: FetchLike
  provider: ProviderLabel
  signal: AbortSignal
  timeoutMs: number
}

/**
 * 發出請求並把失敗整理成 AppError：呼叫端取消 → cancelled；逾時、斷線 → 可重試；
 * HTTP 非 2xx → 依狀態碼分類。成功時回傳 Response（由呼叫端讀 body）。
 */
export async function request(
  url: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<Response> {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = AbortSignal.any([options.signal, timeout])
  let response: Response
  try {
    response = await options.fetch(url, { ...init, signal })
  } catch (error) {
    if (options.signal.aborted)
      throw new AppError({ code: 'cancelled', userMessage: t('errors.cancelled') })
    throw networkError(options.provider, error, timeout.aborted)
  }
  if (response.ok) return response
  let detail: string | undefined
  try {
    detail = (await response.text()).slice(0, 500)
  } catch {
    detail = undefined
  }
  throw httpError(options.provider, response.status, {
    retryAfter: response.headers.get('retry-after'),
    ...(detail === undefined ? {} : { detail }),
  })
}

/** 讀 JSON body；不是合法 JSON 就回報（可重試，多半是供應商暫時出錯）。 */
export async function readJson(response: Response, provider: ProviderLabel): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new AppError({
      code: 'invalid_response',
      retryable: true,
      userMessage: t('errors.returnedContentThatCouldnT', { name: provider.name }),
      cause: error,
    })
  }
}
