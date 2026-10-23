import { AppError, t } from '@svs/schema'

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
 * 金鑰或帳戶的額度用完，供應商卻回 403：OpenRouter 的金鑰上限是 403「Key limit exceeded (total limit)」
 * （body 的 error.metadata.scope 是 key_limit），fal.ai 沒餘額的字樣（Exhausted balance）沒有真實樣本，是照印象寫的。
 * 這時金鑰本身沒問題，叫人重貼金鑰沒有用，要告訴他去加值或調高上限。
 */
const QUOTA_EXHAUSTED =
  /key limit exceeded|key_limit|exhausted balance|insufficient (?:credits|balance)/i

/**
 * 把供應商的 HTTP 錯誤整理成有型別的 AppError。
 * 可重試：逾時、429、5xx；不可重試：401/403（Key 問題；額度用完的 403 另算餘額不足）、402（餘額不足）、其他 4xx（請求被拒）。
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
  if ((status === 401 || status === 403) && QUOTA_EXHAUSTED.test(options.detail ?? '')) {
    return new AppError({
      code: 'provider_insufficient_funds',
      userMessage: t('errors.keyLimitReached', { name }),
      cause,
    })
  }
  if (status === 401 || status === 403) {
    return new AppError({
      code: 'provider_auth_failed',
      userMessage: t('errors.theServiceKeyForIs', { name }),
      cause,
    })
  }
  if (status === 402) {
    return new AppError({
      code: 'provider_insufficient_funds',
      userMessage: t('errors.hasRunOutOfBalance', { name }),
      cause,
    })
  }
  if (status === 408 || status === 504) {
    return new AppError({
      code: 'provider_timeout',
      retryable: true,
      userMessage: t('errors.tookTooLongToRespond', { name }),
      cause,
    })
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(options.retryAfter ?? null)
    return new AppError({
      code: 'provider_rate_limited',
      retryable: true,
      userMessage: t('errors.isGettingTooManyRequests', { name }),
      cause,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    })
  }
  if (status >= 500) {
    return new AppError({
      code: 'provider_unavailable',
      retryable: true,
      userMessage: t('errors.isTemporarilyUnavailableItWill', { name }),
      cause,
    })
  }
  return new AppError({
    code: 'provider_rejected',
    userMessage: t('errors.rejectedThisRequestCheckThe', { name }),
    cause,
  })
}

/** fetch 本身失敗（斷線、DNS、逾時）。 */
export function networkError(provider: ProviderLabel, error: unknown, timedOut: boolean): AppError {
  return new AppError({
    code: timedOut ? 'provider_timeout' : 'provider_unavailable',
    retryable: true,
    userMessage: timedOut
      ? t('errors.tookTooLongToRespond', { name: provider.name })
      : t('errors.couldnTReachCheckYour', { name: provider.name }),
    cause: error,
  })
}
