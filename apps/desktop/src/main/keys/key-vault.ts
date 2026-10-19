import { AppError, type KeyStatus, type KeyStorageInfo } from '@svs/schema'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

/**
 * 服務金鑰的保管。明文只存在主行程：`get` 只給主行程內的 adapter 用，
 * IPC 只能看到 `status`（有沒有設定、末四碼）。
 */
export interface KeyVault {
  storage: () => KeyStorageInfo
  status: (provider: string) => KeyStatus
  /** 已設定的供應商 ID。 */
  providers: () => string[]
  set: (provider: string, key: string) => KeyStatus
  delete: (provider: string) => KeyStatus
  /** 取出明文。只有主行程的供應商 adapter 可以呼叫，不能接到 IPC。 */
  get: (provider: string) => string | undefined
}

const MIN_LAST4_LENGTH = 12

/** 去掉前後空白後，必須是 8–512 個可見字元（不含空白與換行）。 */
export function normalizeKey(raw: string): string {
  const key = raw.trim()
  if (!/^[\x21-\x7e]{8,512}$/.test(key)) {
    throw new AppError({
      code: 'key_invalid',
      userMessage: '服務金鑰格式不正確：請確認已完整複製，且沒有多餘的空白或換行。',
    })
  }
  return key
}

export function statusOf(provider: string, key: string | undefined): KeyStatus {
  if (key === undefined) return { provider, configured: false }
  return key.length >= MIN_LAST4_LENGTH
    ? { provider, configured: true, last4: key.slice(-4) }
    : { provider, configured: true }
}

/**
 * 開發與測試用的記憶體金庫。**未打包版預設就用它**（除非明確設 `SVS_REAL_VAULT=1`），所以開發與測試
 * 永遠不會碰作業系統的鑰匙圈；打包版一定不會用它（見 createKeyVault）。
 * E2E 要驗證「重開 App 後還在」時可以指定 persistPath，會以**明文**寫入該檔，所以只限測試。
 */
export class MemoryVault implements KeyVault {
  private readonly keys = new Map<string, string>()

  constructor(private readonly persistPath?: string) {
    if (persistPath && existsSync(persistPath)) {
      const saved = z
        .record(z.string(), z.string())
        .parse(JSON.parse(readFileSync(persistPath, 'utf8')))
      for (const [provider, key] of Object.entries(saved)) this.keys.set(provider, key)
    }
  }

  storage(): KeyStorageInfo {
    return { available: true, kind: 'memory' }
  }

  status(provider: string): KeyStatus {
    return statusOf(provider, this.keys.get(provider))
  }

  providers(): string[] {
    return [...this.keys.keys()]
  }

  set(provider: string, key: string): KeyStatus {
    this.keys.set(provider, normalizeKey(key))
    this.persist()
    return this.status(provider)
  }

  delete(provider: string): KeyStatus {
    this.keys.delete(provider)
    this.persist()
    return this.status(provider)
  }

  get(provider: string): string | undefined {
    return this.keys.get(provider)
  }

  private persist(): void {
    if (this.persistPath) {
      writeFileSync(this.persistPath, JSON.stringify(Object.fromEntries(this.keys)), 'utf8')
    }
  }
}

/** Electron `safeStorage` 的最小介面（方便測試時替換）。 */
export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (cipher: Buffer) => string
  /** Linux 才有：`basic_text` 代表沒有金鑰圈、只是用固定密碼混淆，不算加密。 */
  getSelectedStorageBackend?: () => string
}

const FileSchema = z.object({
  version: z.literal(1),
  entries: z.record(
    z.string(),
    z.object({ cipher: z.string(), last4: z.string().length(4).optional() }),
  ),
})
type KeyFile = z.infer<typeof FileSchema>

/** 用作業系統金鑰圈（Keychain / DPAPI / libsecret）加密後存到 userData，不寫進專案資料夾。 */
export class SafeStorageVault implements KeyVault {
  constructor(
    private readonly safeStorage: SafeStorageLike,
    private readonly filePath: string,
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  storage(): KeyStorageInfo {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return {
        available: false,
        kind: 'os',
        reason:
          '這台電腦的系統金鑰圈目前無法使用，所以不能安全地儲存服務金鑰。請先登入系統金鑰圈後重新開啟 App。',
      }
    }
    if (this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      return {
        available: false,
        kind: 'os',
        reason:
          '找不到系統金鑰圈（例如 GNOME Keyring 或 KWallet），所以不能安全地儲存服務金鑰。請安裝其中一個並登入後重新開啟 App。',
      }
    }
    return { available: true, kind: 'os' }
  }

  status(provider: string): KeyStatus {
    const entry = this.read().entries[provider]
    if (!entry) return { provider, configured: false }
    return entry.last4
      ? { provider, configured: true, last4: entry.last4 }
      : { provider, configured: true }
  }

  providers(): string[] {
    return Object.keys(this.read().entries)
  }

  set(provider: string, key: string): KeyStatus {
    const info = this.storage()
    if (!info.available) {
      throw new AppError({
        code: 'key_storage_unavailable',
        userMessage: info.reason ?? '無法儲存服務金鑰。',
      })
    }
    const normalized = normalizeKey(key)
    const file = this.read()
    const last4 = statusOf(provider, normalized).last4
    file.entries[provider] = {
      cipher: this.safeStorage.encryptString(normalized).toString('base64'),
      ...(last4 ? { last4 } : {}),
    }
    this.write(file)
    return this.status(provider)
  }

  delete(provider: string): KeyStatus {
    const file = this.read()
    if (provider in file.entries) {
      const entries = Object.fromEntries(
        Object.entries(file.entries).filter(([id]) => id !== provider),
      )
      this.write({ version: 1, entries })
    }
    return { provider, configured: false }
  }

  get(provider: string): string | undefined {
    const entry = this.read().entries[provider]
    if (!entry) return undefined
    try {
      return this.safeStorage.decryptString(Buffer.from(entry.cipher, 'base64'))
    } catch (error) {
      throw new AppError({
        code: 'key_storage_unavailable',
        userMessage: '無法解開已儲存的服務金鑰（可能換了電腦或系統帳號），請重新輸入。',
        cause: error,
      })
    }
  }

  private read(): KeyFile {
    if (!existsSync(this.filePath)) return { version: 1, entries: {} }
    try {
      return FileSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch {
      // 檔案壞了：留一份備查，從空的開始（使用者重新輸入 Key 即可）
      const backup = `${this.filePath}.corrupt-${String(Date.now())}`
      renameSync(this.filePath, backup)
      this.warn(`Key 檔案格式錯誤，已移到 ${backup}`)
      return { version: 1, entries: {} }
    }
  }

  private write(file: KeyFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.filePath)
    if (process.platform !== 'win32') chmodSync(this.filePath, 0o600)
  }
}

export interface CreateKeyVaultOptions {
  isPackaged: boolean
  env: Readonly<Record<string, string | undefined>>
  safeStorage: SafeStorageLike
  userDataDir: string
  /** MemoryVault 的明文落地檔（只給 E2E 驗證重開用）。 */
  testVaultFile?: string
  warn?: (message: string) => void
}

export const KEY_FILE_NAME = 'keys.enc.json'

/**
 * 決定使用哪個金庫。**未打包版（pnpm dev、E2E、各種測試與腳本）預設用 MemoryVault，不碰作業系統的鑰匙圈**
 * （macOS 的鑰匙圈會跳密碼提示、而且授權綁執行檔，反覆測試會一直打擾使用者）；
 * 要在開發版用真的鑰匙圈，必須明確設 `SVS_REAL_VAULT=1`。打包版不論環境變數怎麼設，都一定是 safeStorage。
 */
export function createKeyVault(options: CreateKeyVaultOptions): KeyVault {
  if (!options.isPackaged && options.env.SVS_REAL_VAULT !== '1') {
    return new MemoryVault(options.testVaultFile)
  }
  return new SafeStorageVault(
    options.safeStorage,
    join(options.userDataDir, KEY_FILE_NAME),
    options.warn,
  )
}
