import { AppError } from '@svs/schema'

export interface ProviderLabel {
  /** 給使用者看的名稱，例如「OpenRouter」。 */
  name: string
}

/** 解析 Retry-After（秒數或 HTTP 日期）→ 毫秒；看不懂回傳 undefined。 */
export function parseRetryAfter(
  value: string | null,
  now: () => number = Date.now,
): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000))
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now())
}

/**
 * 把供應商的 HTTP 錯誤整理成有型別的 AppError。
 * 可重試：逾時、429、5xx；不可重試：401/403（Key 問題）、402（餘額不足）、其他 4xx（請求被拒）。
 * 供應商的原始訊息只放進 cause（寫 log 用），userMessage 是整理過的白話。
 */
export function httpError(
  provider: ProviderLabel,
  status: number,
  options: { retryAfter?: string | null; detail?: string } = {},
): AppError {
  const cause = new Error(
    `${provider.name} HTTP ${String(status)}${options.detail ? `：${options.detail}` : ''}`,
  )
  const name = provider.name
  if (status === 401 || status === 403) {
    return new AppError({
      code: 'provider_auth_failed',
      userMessage: `${name} 的服務金鑰無效或沒有權限，請到設定頁重新輸入。`,
      cause,
    })
  }
  if (status === 402) {
    return new AppError({
      code: 'provider_insufficient_funds',
      userMessage: `${name} 的餘額不足，請儲值後再試。`,
      cause,
    })
  }
  if (status === 408 || status === 504) {
    return new AppError({
      code: 'provider_timeout',
      retryable: true,
      userMessage: `${name} 回應太久，稍後會自動重試。`,
      cause,
    })
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(options.retryAfter ?? null)
    return new AppError({
      code: 'provider_rate_limited',
      retryable: true,
      userMessage: `${name} 目前請求太頻繁，稍後會自動重試。`,
      cause,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    })
  }
  if (status >= 500) {
    return new AppError({
      code: 'provider_unavailable',
      retryable: true,
      userMessage: `${name} 暫時無法服務，稍後會自動重試。`,
      cause,
    })
  }
  return new AppError({
    code: 'provider_rejected',
    userMessage: `${name} 拒絕了這個請求，請檢查內容或換一個模型。`,
    cause,
  })
}

/** fetch 本身失敗（斷線、DNS、逾時）。 */
export function networkError(provider: ProviderLabel, error: unknown, timedOut: boolean): AppError {
  return new AppError({
    code: timedOut ? 'provider_timeout' : 'provider_unavailable',
    retryable: true,
    userMessage: timedOut
      ? `${provider.name} 回應太久，稍後會自動重試。`
      : `連不上 ${provider.name}，請檢查網路。稍後會自動重試。`,
    cause: error,
  })
}
