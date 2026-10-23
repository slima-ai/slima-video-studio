import { AppError } from '@svs/schema'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { directKeyCrypto, type KeyCrypto } from './key-crypto'
import {
  KEY_FILE_NAME,
  MemoryVault,
  SafeStorageVault,
  createKeyVault,
  normalizeKey,
  type SafeStorageLike,
} from './key-vault'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'svs-keys-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const SECRET = 'sk-test-ABCDEFGH-1234abcd'

/** 假的 safeStorage：可逆的「加密」（反轉字串再 base64），足夠驗證流程。 */
function fakeSafeStorage(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`enc:${plain.split('').reverse().join('')}`),
    decryptString: (cipher) => {
      const text = cipher.toString()
      if (!text.startsWith('enc:')) throw new Error('bad cipher')
      return text.slice(4).split('').reverse().join('')
    },
    ...overrides,
  }
}

describe('normalizeKey', () => {
  it('去掉前後空白；不接受空白、換行、太短或太長的 Key', () => {
    expect(normalizeKey(`  ${SECRET}\n`)).toBe(SECRET)
    for (const bad of [
      '',
      'short',
      'has space inside-key',
      'line1\nline2-line2',
      'x'.repeat(513),
      '全形金鑰全形金鑰全形金鑰',
    ]) {
      expect(() => normalizeKey(bad), bad).toThrow(AppError)
    }
  })

  it('錯誤訊息不會把 Key 原文帶出去', () => {
    try {
      normalizeKey('bad key with spaces SECRET-VALUE')
    } catch (error) {
      expect(String(error)).not.toContain('SECRET-VALUE')
      expect((error as AppError).code).toBe('key_invalid')
    }
  })
})

describe('MemoryVault', () => {
  it('設定、查狀態（末四碼）、取出、刪除', () => {
    const vault = new MemoryVault()
    expect(vault.status('fal')).toEqual({ provider: 'fal', configured: false })
    expect(vault.set('fal', SECRET)).toEqual({
      provider: 'fal',
      configured: true,
      last4: 'abcd',
    })
    expect(vault.get('fal')).toBe(SECRET)
    expect(vault.providers()).toEqual(['fal'])
    expect(vault.delete('fal')).toEqual({ provider: 'fal', configured: false })
    expect(vault.get('fal')).toBeUndefined()
    expect(vault.storage()).toEqual({ available: true, kind: 'memory' })
  })

  it('太短的 Key（12 碼以內）不顯示末四碼，避免洩漏大半個 Key', () => {
    const vault = new MemoryVault()
    expect(vault.set('fal', 'abcdefgh1234')).toEqual({
      provider: 'fal',
      configured: true,
      last4: '1234',
    })
    expect(vault.set('fal', 'abcdefgh')).toEqual({ provider: 'fal', configured: true })
  })

  it('指定 persistPath 時，重新建立後還在（E2E 重開用）', () => {
    const file = join(tmp(), 'vault.json')
    new MemoryVault(file).set('openrouter', SECRET)
    expect(new MemoryVault(file).get('openrouter')).toBe(SECRET)
  })
})

describe('SafeStorageVault', () => {
  const make = (safe = fakeSafeStorage()) => {
    const dir = tmp()
    const file = join(dir, KEY_FILE_NAME)
    return { vault: new SafeStorageVault(directKeyCrypto(safe), file), file, dir }
  }
  const reopen = (file: string, safe = fakeSafeStorage()) =>
    new SafeStorageVault(directKeyCrypto(safe), file)

  it('加密後才寫檔：檔案裡沒有明文；重新建立後讀進來就能取', async () => {
    const { vault, file } = make()
    expect(await vault.save('fal', SECRET)).toMatchObject({ configured: true, last4: 'abcd' })
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('ABCDEFGH')
    const again = reopen(file)
    expect(again.status('fal').last4).toBe('abcd')
    await again.load()
    expect(again.get('fal')).toBe(SECRET)
    expect(again.knownSecrets()).toEqual([SECRET])
  })

  it('檔案權限只有擁有者可讀寫', async () => {
    if (process.platform === 'win32') return
    const { vault, file } = make()
    await vault.save('fal', SECRET)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('金鑰圈不可用時拒絕儲存並說明原因；不會寫出任何檔案', async () => {
    const { vault, file } = make(fakeSafeStorage({ isEncryptionAvailable: () => false }))
    expect(vault.storage()).toMatchObject({ available: false, kind: 'os' })
    const error = await vault.save('fal', SECRET).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('key_storage_unavailable')
    expect((error as AppError).userMessage).toMatch(/金鑰圈/)
    expect(() => readFileSync(file)).toThrow()
  })

  it('Linux 只有 basic_text（沒有金鑰圈）也視為不可用', async () => {
    const { vault } = make(fakeSafeStorage({ getSelectedStorageBackend: () => 'basic_text' }))
    expect(vault.storage().available).toBe(false)
    await expect(vault.save('fal', SECRET)).rejects.toThrow(/GNOME Keyring|KWallet/)
    const ok = make(fakeSafeStorage({ getSelectedStorageBackend: () => 'gnome_libsecret' }))
    expect(ok.vault.storage().available).toBe(true)
  })

  it('刪除、列出；刪除不存在的供應商沒有副作用；刪掉之後記憶體裡也沒有', async () => {
    const { vault } = make()
    await vault.save('fal', SECRET)
    await vault.save('openrouter', `${SECRET}-2`)
    expect(vault.providers().sort()).toEqual(['fal', 'openrouter'])
    expect(vault.delete('fal')).toEqual({ provider: 'fal', configured: false })
    expect(vault.delete('ghost')).toEqual({ provider: 'ghost', configured: false })
    expect(vault.providers()).toEqual(['openrouter'])
    expect(vault.get('fal')).toBeUndefined()
    expect(vault.knownSecrets()).toEqual([`${SECRET}-2`])
  })

  it('解不開（換了電腦或帳號）時回報可行動的錯誤，狀態仍顯示已設定；錯誤不含內部細節', async () => {
    const { vault, file } = make()
    await vault.save('fal', SECRET)
    const other = reopen(
      file,
      fakeSafeStorage({
        decryptString: () => {
          throw new Error('decrypt failed: secret-internal-detail')
        },
      }),
    )
    expect(other.status('fal').configured).toBe(true)
    await other.load()
    expect(() => other.get('fal')).toThrow(/重新輸入/)
    try {
      other.get('fal')
    } catch (error) {
      expect(JSON.stringify((error as AppError).toShape())).not.toContain('secret-internal-detail')
    }
  })

  it('檔案壞掉：移到備份、從空的開始，並通知', async () => {
    const dir = tmp()
    const file = join(dir, KEY_FILE_NAME)
    writeFileSync(file, '{not json')
    const warnings: string[] = []
    const vault = new SafeStorageVault(directKeyCrypto(fakeSafeStorage()), file, (m) =>
      warnings.push(m),
    )
    expect(vault.providers()).toEqual([])
    expect(warnings[0]).toMatch(/corrupt/)
    await vault.save('fal', SECRET)
    const again = reopen(file)
    await again.load()
    expect(again.get('fal')).toBe(SECRET)
  })
})

/** 手動放行的假金鑰圈：模擬 macOS 提示停著不按、按拒絕。 */
function controllableCrypto() {
  const calls = { decrypt: 0, encrypt: 0 }
  const pending: { resolve: (plains: (string | null)[]) => void; reject: (e: unknown) => void }[] =
    []
  const crypto: KeyCrypto = {
    storageInfo: () => ({ available: true, kind: 'os' }),
    encrypt: (plain) => {
      calls.encrypt++
      return Promise.resolve(`enc:${plain}`)
    },
    decryptMany: (ciphers) => {
      calls.decrypt++
      return new Promise((resolve, reject) => {
        pending.push({
          resolve: (plains) => {
            resolve(plains.length === 0 ? ciphers.map((c) => c.replace(/^enc:/, '')) : plains)
          },
          reject,
        })
      })
    },
  }
  return { crypto, calls, pending }
}

describe('鑰匙圈很慢或被拒絕：畫面與 MCP 用到的方法都照常回應', () => {
  const seeded = async () => {
    const dir = tmp()
    const file = join(dir, KEY_FILE_NAME)
    const writer = new SafeStorageVault(directKeyCrypto(fakeSafeStorage()), file)
    await writer.save('fal', SECRET)
    return file
  }
  const denied = () =>
    new AppError({ code: 'key_storage_unavailable', userMessage: '你按了拒絕，沒辦法讀取。' })

  it('提示停著沒按：load 一直等，但 status／providers／storage／knownSecrets／get 立刻回，也不會重複啟動讀取', async () => {
    const file = await seeded()
    const { crypto, calls, pending } = controllableCrypto()
    const vault = new SafeStorageVault(crypto, file)
    const loading = vault.load()
    let settled = false
    void loading.then(() => (settled = true))
    // 這些全部是同步呼叫：能立刻回來，就代表沒有被金鑰圈卡住
    expect(vault.status('fal')).toMatchObject({ configured: true })
    expect(vault.providers()).toEqual(['fal'])
    expect(vault.storage().available).toBe(true)
    expect(vault.knownSecrets()).toEqual([])
    const error = (() => {
      try {
        vault.get('fal')
        return undefined
      } catch (e) {
        return e as AppError
      }
    })()
    expect(error?.retryable).toBe(true)
    expect(error?.userMessage).toContain('請按「允許」')
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(calls.decrypt).toBe(1) // 還在讀的時候不會再開第二次
    // 使用者按了允許
    pending[0]?.resolve([SECRET])
    await loading
    expect(vault.get('fal')).toBe(SECRET)
    expect(vault.knownSecrets()).toEqual([SECRET])
  })

  it('被拒絕：load 丟白話錯誤；馬上再要金鑰會直接得到原因（不會一直重跳提示）；過了一陣子才再試', async () => {
    const file = await seeded()
    const { crypto, calls, pending } = controllableCrypto()
    let now = 1_000
    const warnings: string[] = []
    const vault = new SafeStorageVault(
      crypto,
      file,
      (m) => warnings.push(m),
      () => now,
    )
    const first = vault.load()
    pending[0]?.reject(denied())
    await expect(first).rejects.toThrow('你按了拒絕')
    expect(warnings[0]).toContain('你按了拒絕')
    // 15 秒內：直接丟同一個原因，不再去問金鑰圈
    now += 5_000
    expect(() => vault.get('fal')).toThrow('你按了拒絕')
    expect(calls.decrypt).toBe(1)
    // 之後：背景重試一次（這次請稍後再試），使用者這回按了允許就成功
    now += 20_000
    expect(() => vault.get('fal')).toThrow(/稍等/)
    expect(calls.decrypt).toBe(2)
    pending[1]?.resolve([SECRET])
    await vault.load()
    expect(vault.get('fal')).toBe(SECRET)
  })

  it('沒有存任何金鑰時，load 完全不碰金鑰圈（示範模式與沒填 Key 的人永遠不會被問）', async () => {
    const dir = tmp()
    const { crypto, calls } = controllableCrypto()
    const vault = new SafeStorageVault(crypto, join(dir, KEY_FILE_NAME))
    await vault.load()
    expect(vault.get('fal')).toBeUndefined()
    expect(vault.get('openrouter')).toBeUndefined()
    expect(calls).toEqual({ decrypt: 0, encrypt: 0 })
  })
})

describe('createKeyVault：MemoryVault 只有未打包且明確要求才會啟用', () => {
  const base = { safeStorage: fakeSafeStorage(), userDataDir: tmp() }

  it('未打包：不管有沒有設環境變數，預設都是 MemoryVault（開發與測試永遠不碰真鑰匙圈）', () => {
    for (const env of [
      {},
      { SVS_TEST_VAULT: 'memory' },
      { SVS_TEST_VAULT: 'yes' },
      { SVS_REAL_VAULT: '0' },
      { SVS_REAL_VAULT: 'true' },
    ]) {
      expect(
        createKeyVault({ ...base, isPackaged: false, env }),
        JSON.stringify(env),
      ).toBeInstanceOf(MemoryVault)
    }
  })

  it('未打包要用真的鑰匙圈，必須明確設 SVS_REAL_VAULT=1', () => {
    expect(
      createKeyVault({ ...base, isPackaged: false, env: { SVS_REAL_VAULT: '1' } }),
    ).toBeInstanceOf(SafeStorageVault)
  })

  it('打包版不論環境變數怎麼設，都用 safeStorage', async () => {
    const vault = createKeyVault({
      ...base,
      isPackaged: true,
      env: { SVS_TEST_VAULT: 'memory', SVS_REAL_VAULT: '0' },
      testVaultFile: join(base.userDataDir, 'plain.json'),
    })
    expect(vault).toBeInstanceOf(SafeStorageVault)
    await vault.save('fal', SECRET)
    expect(() => readFileSync(join(base.userDataDir, 'plain.json'))).toThrow()
  })
})

describe('createKeyVault：開發版啟動時從環境變數帶入金鑰', () => {
  const base = { safeStorage: fakeSafeStorage() }
  const OR_KEY = 'sk-or-v1-FAKEFAKEFAKE-0001'
  const FAL_KEY = 'fal-FAKEFAKEFAKE-0002:zzzz'

  it('未打包、有 OPENROUTER_API_KEY／FAL_KEY：放進記憶體金庫，狀態是已設定、取得到', () => {
    const vault = createKeyVault({
      ...base,
      userDataDir: tmp(),
      isPackaged: false,
      env: { OPENROUTER_API_KEY: OR_KEY, FAL_KEY },
    })
    expect(vault).toBeInstanceOf(MemoryVault)
    expect(vault.status('openrouter').configured).toBe(true)
    expect(vault.get('openrouter')).toBe(OR_KEY)
    expect(vault.get('fal')).toBe(FAL_KEY)
  })

  it('未打包、沒有變數：維持空的', () => {
    const vault = createKeyVault({ ...base, userDataDir: tmp(), isPackaged: false, env: {} })
    expect(vault.providers()).toEqual([])
    const empty = createKeyVault({
      ...base,
      userDataDir: tmp(),
      isPackaged: false,
      env: { OPENROUTER_API_KEY: '', FAL_KEY: '' },
    })
    expect(empty.providers()).toEqual([])
  })

  it('打包版：有變數也完全不讀（用 safeStorage、沒有任何供應商、也沒問 info）', () => {
    const infos: string[] = []
    const vault = createKeyVault({
      ...base,
      userDataDir: tmp(),
      isPackaged: true,
      env: { OPENROUTER_API_KEY: OR_KEY, FAL_KEY },
      info: (m) => infos.push(m),
    })
    expect(vault).toBeInstanceOf(SafeStorageVault)
    expect(vault.providers()).toEqual([])
    expect(vault.get('openrouter')).toBeUndefined()
    expect(infos).toEqual([])
  })

  it('明確要用真鑰匙圈（SVS_REAL_VAULT=1）時也不讀環境變數', () => {
    const vault = createKeyVault({
      ...base,
      userDataDir: tmp(),
      isPackaged: false,
      env: { SVS_REAL_VAULT: '1', OPENROUTER_API_KEY: OR_KEY },
    })
    expect(vault).toBeInstanceOf(SafeStorageVault)
    expect(vault.providers()).toEqual([])
  })

  it('log 只寫「Loaded the … key from the environment」，不含金鑰、末四碼；格式不對只警告變數名稱', () => {
    const logs: string[] = []
    createKeyVault({
      ...base,
      userDataDir: tmp(),
      isPackaged: false,
      env: { OPENROUTER_API_KEY: OR_KEY, FAL_KEY: 'bad key with spaces' },
      info: (m) => logs.push(m),
      warn: (m) => logs.push(m),
    })
    expect(logs).toEqual([
      'Loaded the OpenRouter key from the environment',
      'The environment variable FAL_KEY is malformed; ignored',
    ])
    const all = logs.join('\n')
    expect(all).not.toContain(OR_KEY)
    expect(all).not.toContain(OR_KEY.slice(-4))
    expect(all).not.toContain('bad key')
  })

  it('指定了明文落地檔時，環境變數來的金鑰也不會被寫進去', () => {
    const file = join(tmp(), 'plain.json')
    createKeyVault({
      ...base,
      userDataDir: tmp(),
      isPackaged: false,
      env: { OPENROUTER_API_KEY: OR_KEY },
      testVaultFile: file,
    })
    expect(() => readFileSync(file)).toThrow()
  })
})
