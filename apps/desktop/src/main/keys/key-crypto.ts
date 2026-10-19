import { AppError, type KeyStorageInfo } from '@svs/schema'
import { z } from 'zod'

/**
 * 金鑰的加解密。macOS 的鑰匙圈第一次（或 App 更新、簽章變了之後）存取時會跳出「要不要允許」的提示，
 * 提示沒按之前，呼叫的那條執行緒會整個卡住。Electron 的 safeStorage 又是同步的，放在主行程就會讓
 * 視窗與 MCP 一起當掉，所以 macOS 改成交給另一個行程（同一個 App 的執行檔、同一個簽章，所以鑰匙圈的授權一樣）去做，
 * 主行程只是等它的結果（非同步），等的時候畫面與 MCP 照常運作。
 */
export interface KeyCrypto {
  /** 不碰作業系統就能回答的儲存狀態（macOS／Windows 一律當作可用，真的不能用會在加解密時報錯）。 */
  storageInfo: () => KeyStorageInfo
  /** 回傳 base64 的密文。 */
  encrypt: (plain: string) => Promise<string>
  /** 一次解多筆（一次只會跳一次提示）。解不開的那筆回 null。 */
  decryptMany: (ciphers: string[]) => Promise<(string | null)[]>
}

/** Electron `safeStorage` 的最小介面（方便測試時替換）。 */
export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (cipher: Buffer) => string
  /** Linux 才有：`basic_text` 代表沒有金鑰圈、只是用固定密碼混淆，不算加密。 */
  getSelectedStorageBackend?: () => string
}

const unavailable = (reason: string, cause?: unknown): AppError =>
  new AppError({
    code: 'key_storage_unavailable',
    userMessage: reason,
    ...(cause === undefined ? {} : { cause }),
  })

export const KEYCHAIN_UNAVAILABLE =
  '這台電腦的系統金鑰圈目前無法使用，所以不能安全地儲存服務金鑰。請先登入系統金鑰圈後重新開啟 App。'

/** 直接呼叫 safeStorage（Windows、Linux，以及測試）。 */
export function directKeyCrypto(safeStorage: SafeStorageLike): KeyCrypto {
  const info = (): KeyStorageInfo => {
    if (!safeStorage.isEncryptionAvailable()) {
      return { available: false, kind: 'os', reason: KEYCHAIN_UNAVAILABLE }
    }
    if (safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      return {
        available: false,
        kind: 'os',
        reason:
          '找不到系統金鑰圈（例如 GNOME Keyring 或 KWallet），所以不能安全地儲存服務金鑰。請安裝其中一個並登入後重新開啟 App。',
      }
    }
    return { available: true, kind: 'os' }
  }
  return {
    storageInfo: info,
    encrypt: (plain) => {
      const state = info()
      if (!state.available) return Promise.reject(unavailable(state.reason ?? KEYCHAIN_UNAVAILABLE))
      return Promise.resolve(safeStorage.encryptString(plain).toString('base64'))
    },
    decryptMany: (ciphers) =>
      Promise.resolve(
        ciphers.map((cipher) => {
          try {
            return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
          } catch {
            return null
          }
        }),
      ),
  }
}

/** 主行程與金鑰小幫手之間的訊息（只走 stdin／stdout，不進 log）。 */
export const HelperRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('encrypt'), plain: z.string() }),
  z.object({ op: z.literal('decrypt'), ciphers: z.array(z.string()) }),
])
export type HelperRequest = z.infer<typeof HelperRequestSchema>

export const HelperResponseSchema = z.union([
  z.object({ ok: z.literal(true), cipher: z.string() }),
  z.object({ ok: z.literal(true), plains: z.array(z.string().nullable()) }),
  z.object({ ok: z.literal(false), reason: z.enum(['unavailable', 'failed']) }),
])
export type HelperResponse = z.infer<typeof HelperResponseSchema>

/** 執行一次小幫手：逾時、被拒絕、跑不起來都以 'timeout' | 'crashed' 的錯誤丟出。 */
export type HelperRunner = (request: HelperRequest) => Promise<HelperResponse>

export class HelperTimeoutError extends Error {}
export class HelperCrashedError extends Error {}

export const KEYCHAIN_WAITING =
  '系統鑰匙圈還沒有回應。如果螢幕上有「要允許存取鑰匙圈」的提示，請按「允許」，然後再試一次。'

function mapHelperError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof HelperTimeoutError) {
    return new AppError({
      code: 'key_storage_unavailable',
      userMessage: KEYCHAIN_WAITING,
      retryable: true,
      cause: error,
    })
  }
  return unavailable(
    '沒辦法向系統金鑰圈讀取服務金鑰（可能是你按了「拒絕」，或鑰匙圈目前無法使用）。要再試的話，請重新開啟 App 並在提示出現時按「允許」。',
    error,
  )
}

/** macOS：把鑰匙圈的存取交給另一個行程（見 KeyCrypto 的說明）。 */
export function helperKeyCrypto(run: HelperRunner): KeyCrypto {
  const call = async (request: HelperRequest): Promise<HelperResponse> => {
    let response: HelperResponse
    try {
      response = await run(request)
    } catch (error) {
      throw mapHelperError(error)
    }
    if (!response.ok) {
      throw unavailable(
        response.reason === 'unavailable'
          ? KEYCHAIN_UNAVAILABLE
          : '無法向系統金鑰圈加密服務金鑰，請再試一次。',
      )
    }
    return response
  }
  return {
    storageInfo: () => ({ available: true, kind: 'os' }),
    encrypt: async (plain) => {
      const response = await call({ op: 'encrypt', plain })
      if (!('cipher' in response)) throw unavailable('系統金鑰圈回傳的內容不對，請再試一次。')
      return response.cipher
    },
    decryptMany: async (ciphers) => {
      if (ciphers.length === 0) return []
      const response = await call({ op: 'decrypt', ciphers })
      if (!('plains' in response) || response.plains.length !== ciphers.length) {
        throw unavailable('系統金鑰圈回傳的內容不對，請再試一次。')
      }
      return response.plains
    },
  }
}
