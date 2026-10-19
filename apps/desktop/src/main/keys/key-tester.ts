import { FalClient, OpenRouterClient, type FetchLike } from '@svs/providers'
import { AppError, isAppError, type KeyTestResult } from '@svs/schema'

import type { KeyVault } from './key-vault'

export type KeyTester = (provider: string, signal: AbortSignal) => Promise<KeyTestResult>

/** fal 沒有專用的驗證端點，用任何一個真的存在的端點即可（只會查「某個任務」，不會產生費用）。 */
const FAL_PROBE_ENDPOINT = 'fal-ai/nano-banana-2'

/**
 * 「測試連線」：用已儲存的 Key 向供應商確認是否有效。
 * Key 無效回 `valid: false`（不是錯誤）；斷線、供應商故障等才丟 AppError。
 * 查得到餘額的供應商（OpenRouter）順便回傳；餘額查不到不影響結果。
 */
export function createKeyTester(deps: {
  keys: KeyVault
  fetch?: FetchLike
  /** 測試用：OpenRouter 的位址（本機假伺服器）；沒給就連 OpenRouter。 */
  openrouterBaseUrl?: string
}): KeyTester {
  const { keys } = deps
  const common = (provider: string) => ({
    getKey: () => keys.get(provider),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  })

  return async (provider, signal) => {
    // 金鑰在金鑰圈裡時要先讀進來（非同步；鑰匙圈提示出現時這裡等，畫面與 MCP 照常運作）
    await keys.load()
    if (keys.get(provider) === undefined) {
      throw new AppError({
        code: 'key_invalid',
        userMessage: '還沒有填這個供應商的服務金鑰。',
      })
    }
    if (provider === 'openrouter') {
      const client = new OpenRouterClient({
        ...common(provider),
        endpointFor: () => undefined,
        ...(deps.openrouterBaseUrl === undefined ? {} : { baseUrl: deps.openrouterBaseUrl }),
      })
      try {
        await client.testKey(signal)
      } catch (error) {
        if (isAppError(error) && error.code === 'provider_auth_failed') {
          return { provider, valid: false }
        }
        throw error
      }
      try {
        const { remainingUsd } = await client.balance(signal)
        return { provider, valid: true, balanceUsd: Math.max(0, remainingUsd) }
      } catch {
        return { provider, valid: true }
      }
    }
    if (provider === 'fal') {
      const client = new FalClient(common(provider))
      return { provider, valid: await client.testKey(FAL_PROBE_ENDPOINT, signal) }
    }
    throw new AppError({
      code: 'invalid_request',
      userMessage: '不支援測試這個供應商的連線。',
    })
  }
}
