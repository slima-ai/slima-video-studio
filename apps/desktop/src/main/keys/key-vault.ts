import { AppError, type KeyStatus, type KeyStorageInfo, t, msg } from '@svs/schema'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

import { directKeyCrypto, type KeyCrypto, type SafeStorageLike } from './key-crypto'

export type { SafeStorageLike } from './key-crypto'

/**
 * 服務金鑰的保管。明文只存在主行程：`get` 只給主行程內的 adapter 用，
 * IPC 只能看到 `status`（有沒有設定、末四碼）。
 *
 * **除了 `save`／`load` 之外，所有方法都不碰作業系統的金鑰圈**（所以不會卡住）：
 * 金鑰圈的存取很慢、而且可能停在「要不要允許」的提示上，只能用非同步的 `save`／`load`。
 */
export interface KeyVault {
  /** 儲存狀態（不碰金鑰圈）。 */
  storage: () => KeyStorageInfo
  status: (provider: string) => KeyStatus
  /** 已設定的供應商 ID。 */
  providers: () => string[]
  /** 加密並存起來（非同步；金鑰圈提示出現時不會卡住畫面）。 */
  save: (provider: string, key: string) => Promise<KeyStatus>
  delete: (provider: string) => KeyStatus
  /** 把已存的金鑰從金鑰圈讀進記憶體（非同步、可重複呼叫）。讀不到會丟白話錯誤。 */
  load: () => Promise<void>
  /**
   * 取出明文，只看記憶體、從不碰金鑰圈。只有主行程的供應商 adapter 可以呼叫，不能接到 IPC。
   * 有存、但還沒讀進來時：丟「可重試」的白話錯誤，並在背景開始讀。
   */
  get: (provider: string) => string | undefined
  /** 目前在記憶體裡的金鑰明文（給回傳內容過濾用；不碰金鑰圈）。 */
  knownSecrets: () => string[]
}

const MIN_LAST4_LENGTH = 12

/** 去掉前後空白後，必須是 8–512 個可見字元（不含空白與換行）。 */
export function normalizeKey(raw: string): string {
  const key = raw.trim()
  if (!/^[\x21-\x7e]{8,512}$/.test(key)) {
    throw new AppError({
      code: 'key_invalid',
      userMessage: t('settings.theApiKeyDoesnT'),
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

  /** 只放進記憶體、不寫 persistPath（環境變數來的金鑰不該因為測試用的明文檔落地）。 */
  seed(provider: string, key: string): KeyStatus {
    this.keys.set(provider, normalizeKey(key))
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

  save(provider: string, key: string): Promise<KeyStatus> {
    return Promise.resolve(this.set(provider, key))
  }

  load(): Promise<void> {
    return Promise.resolve()
  }

  knownSecrets(): string[] {
    return [...this.keys.values()]
  }

  private persist(): void {
    if (this.persistPath) {
      writeFileSync(this.persistPath, JSON.stringify(Object.fromEntries(this.keys)), 'utf8')
    }
  }
}

const FileSchema = z.object({
  version: z.literal(1),
  entries: z.record(
    z.string(),
    z.object({ cipher: z.string(), last4: z.string().length(4).optional() }),
  ),
})
type KeyFile = z.infer<typeof FileSchema>

const LOADING_MESSAGE = msg('settings.theApiKeyIsStill')
/** 讀取失敗之後，這麼久之內不再自動重試（避免一直跳提示）。 */
const RETRY_AFTER_MS = 15_000

/**
 * 用作業系統金鑰圈加密後存到 userData，不寫進專案資料夾。
 * 讀寫金鑰圈都經過 KeyCrypto（非同步，macOS 在另一個行程裡做），所以金鑰圈停在提示上時，
 * 畫面與 MCP 都照常運作；明文讀進來之後只留在記憶體。
 */
export class SafeStorageVault implements KeyVault {
  private readonly cache = new Map<string, string>()
  /** 讀過、但解不開的供應商（換了電腦或系統帳號）。 */
  private readonly broken = new Set<string>()
  private inflight: Promise<void> | undefined
  private failure: { error: AppError; at: number } | undefined

  constructor(
    private readonly crypto: KeyCrypto,
    private readonly filePath: string,
    private readonly warn: (message: string) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  storage(): KeyStorageInfo {
    return this.crypto.storageInfo()
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

  async save(provider: string, key: string): Promise<KeyStatus> {
    const info = this.storage()
    if (!info.available) {
      throw new AppError({
        code: 'key_storage_unavailable',
        userMessage: info.reason ?? t('settings.couldnTSaveTheApi'),
      })
    }
    const normalized = normalizeKey(key)
    const cipher = await this.crypto.encrypt(normalized)
    const file = this.read()
    const last4 = statusOf(provider, normalized).last4
    file.entries[provider] = { cipher, ...(last4 ? { last4 } : {}) }
    this.write(file)
    this.cache.set(provider, normalized)
    this.broken.delete(provider)
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
    this.cache.delete(provider)
    this.broken.delete(provider)
    return { provider, configured: false }
  }

  load(): Promise<void> {
    if (this.inflight) return this.inflight
    const pending = Object.entries(this.read().entries).filter(
      ([provider]) => !this.cache.has(provider) && !this.broken.has(provider),
    )
    if (pending.length === 0) return Promise.resolve()
    const run = async (): Promise<void> => {
      const plains = await this.crypto.decryptMany(pending.map(([, entry]) => entry.cipher))
      pending.forEach(([provider], index) => {
        const plain = plains[index]
        if (typeof plain === 'string') this.cache.set(provider, plain)
        else this.broken.add(provider)
      })
      this.failure = undefined
    }
    const task = run()
      .catch((error: unknown) => {
        const failure =
          error instanceof AppError
            ? error
            : new AppError({
                code: 'key_storage_unavailable',
                userMessage: t('settings.couldnTReadTheSaved'),
                cause: error,
              })
        this.failure = { error: failure, at: this.now() }
        this.warn(t('settings.couldnTReadTheApi2', { userMessage: failure.userMessage }))
        throw failure
      })
      .finally(() => {
        this.inflight = undefined
      })
    this.inflight = task
    return task
  }

  get(provider: string): string | undefined {
    const cached = this.cache.get(provider)
    if (cached !== undefined) return cached
    if (!(provider in this.read().entries)) return undefined
    if (this.broken.has(provider)) {
      throw new AppError({
        code: 'key_storage_unavailable',
        userMessage: t('settings.couldnTUnlockTheSaved'),
      })
    }
    // 還沒讀進來：剛失敗過就直接說原因，不要一直重試；否則在背景開始讀，這次請使用者稍後再試
    const failed = this.failure
    if (failed && this.now() - failed.at < RETRY_AFTER_MS) throw failed.error
    this.load().catch(() => undefined)
    throw new AppError({
      code: 'key_storage_unavailable',
      userMessage: t(LOADING_MESSAGE),
      retryable: true,
    })
  }

  knownSecrets(): string[] {
    return [...this.cache.values()]
  }

  private read(): KeyFile {
    if (!existsSync(this.filePath)) return { version: 1, entries: {} }
    try {
      return FileSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch {
      // 檔案壞了：留一份備查，從空的開始（使用者重新輸入 Key 即可）
      const backup = `${this.filePath}.corrupt-${String(Date.now())}`
      renameSync(this.filePath, backup)
      this.warn(`The key file was malformed; moved to ${backup}`)
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
  /** 沒給 crypto 時用 safeStorage 直接加解密（測試用）。 */
  safeStorage?: SafeStorageLike
  crypto?: KeyCrypto
  userDataDir: string
  /** MemoryVault 的明文落地檔（只給 E2E 驗證重開用）。 */
  testVaultFile?: string
  warn?: (message: string) => void
  /** 只用來記「已從環境變數載入某供應商金鑰」；絕不帶金鑰內容。 */
  info?: (message: string) => void
}

/** 開發版啟動時可以從環境變數帶進來的金鑰；變數名稱與 `pnpm smoke:real` 一致。 */
const ENV_KEYS = [
  { provider: 'openrouter', variable: 'OPENROUTER_API_KEY', label: 'OpenRouter' },
  { provider: 'fal', variable: 'FAL_KEY', label: 'fal.ai' },
] as const

export const KEY_FILE_NAME = 'keys.enc.json'

/**
 * 決定使用哪個金庫。**未打包版（pnpm dev、E2E、各種測試與腳本）預設用 MemoryVault，不碰作業系統的鑰匙圈**
 * （macOS 的鑰匙圈會跳密碼提示、而且授權綁執行檔，反覆測試會一直打擾使用者）；
 * 要在開發版用真的鑰匙圈，必須明確設 `SVS_REAL_VAULT=1`。打包版不論環境變數怎麼設，都一定是 safeStorage。
 * 開發版的記憶體金庫啟動時會讀 `OPENROUTER_API_KEY`／`FAL_KEY`（給展示片與手動試用，不用在畫面上貼金鑰）。
 */
export function createKeyVault(options: CreateKeyVaultOptions): KeyVault {
  if (!options.isPackaged && options.env.SVS_REAL_VAULT !== '1') {
    const vault = new MemoryVault(options.testVaultFile)
    // 開發版專用：環境變數有金鑰就放進記憶體金庫（重開就沒了、不寫檔、不碰鑰匙圈）。
    // 打包版不會走到這裡，所以永遠不讀環境變數。
    for (const { provider, variable, label } of ENV_KEYS) {
      const value = options.env[variable]
      if (!value) continue
      try {
        vault.seed(provider, value)
        options.info?.(`Loaded the ${label} key from the environment`)
      } catch {
        options.warn?.(`The environment variable ${variable} is malformed; ignored`)
      }
    }
    return vault
  }
  const crypto =
    options.crypto ?? (options.safeStorage ? directKeyCrypto(options.safeStorage) : undefined)
  if (!crypto) throw new Error('createKeyVault 需要 crypto 或 safeStorage')
  return new SafeStorageVault(crypto, join(options.userDataDir, KEY_FILE_NAME), options.warn)
}
