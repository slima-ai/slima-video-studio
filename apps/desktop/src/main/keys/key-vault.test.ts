import { AppError } from '@svs/schema'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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
    return { vault: new SafeStorageVault(safe, file), file, dir }
  }

  it('加密後才寫檔：檔案裡沒有明文；重新建立後能解回來', () => {
    const { vault, file } = make()
    expect(vault.set('fal', SECRET)).toMatchObject({ configured: true, last4: 'abcd' })
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('ABCDEFGH')
    expect(new SafeStorageVault(fakeSafeStorage(), file).get('fal')).toBe(SECRET)
    expect(new SafeStorageVault(fakeSafeStorage(), file).status('fal').last4).toBe('abcd')
  })

  it('檔案權限只有擁有者可讀寫', () => {
    if (process.platform === 'win32') return
    const { vault, file } = make()
    vault.set('fal', SECRET)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('金鑰圈不可用時拒絕儲存並說明原因；不會寫出任何檔案', () => {
    const { vault, file } = make(fakeSafeStorage({ isEncryptionAvailable: () => false }))
    expect(vault.storage()).toMatchObject({ available: false, kind: 'os' })
    expect(() => vault.set('fal', SECRET)).toThrow(/金鑰圈/)
    try {
      vault.set('fal', SECRET)
      expect.unreachable()
    } catch (error) {
      expect((error as AppError).code).toBe('key_storage_unavailable')
    }
    expect(() => readFileSync(file)).toThrow()
  })

  it('Linux 只有 basic_text（沒有金鑰圈）也視為不可用', () => {
    const { vault } = make(fakeSafeStorage({ getSelectedStorageBackend: () => 'basic_text' }))
    expect(vault.storage().available).toBe(false)
    expect(() => vault.set('fal', SECRET)).toThrow(/GNOME Keyring|KWallet/)
    const ok = make(fakeSafeStorage({ getSelectedStorageBackend: () => 'gnome_libsecret' }))
    expect(ok.vault.storage().available).toBe(true)
  })

  it('刪除、列出；刪除不存在的供應商沒有副作用', () => {
    const { vault } = make()
    vault.set('fal', SECRET)
    vault.set('openrouter', `${SECRET}-2`)
    expect(vault.providers().sort()).toEqual(['fal', 'openrouter'])
    expect(vault.delete('fal')).toEqual({ provider: 'fal', configured: false })
    expect(vault.delete('ghost')).toEqual({ provider: 'ghost', configured: false })
    expect(vault.providers()).toEqual(['openrouter'])
    expect(vault.get('fal')).toBeUndefined()
  })

  it('解不開（換了電腦或帳號）時回報可行動的錯誤，狀態仍顯示已設定', () => {
    const { vault, file } = make()
    vault.set('fal', SECRET)
    const other = new SafeStorageVault(
      fakeSafeStorage({
        decryptString: () => {
          throw new Error('decrypt failed: secret-internal-detail')
        },
      }),
      file,
    )
    expect(other.status('fal').configured).toBe(true)
    expect(() => other.get('fal')).toThrow(/重新輸入/)
    try {
      other.get('fal')
    } catch (error) {
      expect(JSON.stringify((error as AppError).toShape())).not.toContain('secret-internal-detail')
    }
  })

  it('檔案壞掉：移到備份、從空的開始，並通知', () => {
    const dir = tmp()
    const file = join(dir, KEY_FILE_NAME)
    writeFileSync(file, '{not json')
    const warnings: string[] = []
    const vault = new SafeStorageVault(fakeSafeStorage(), file, (m) => warnings.push(m))
    expect(vault.providers()).toEqual([])
    expect(warnings[0]).toMatch(/corrupt/)
    vault.set('fal', SECRET)
    expect(new SafeStorageVault(fakeSafeStorage(), file).get('fal')).toBe(SECRET)
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

  it('打包版不論環境變數怎麼設，都用 safeStorage', () => {
    const vault = createKeyVault({
      ...base,
      isPackaged: true,
      env: { SVS_TEST_VAULT: 'memory', SVS_REAL_VAULT: '0' },
      testVaultFile: join(base.userDataDir, 'plain.json'),
    })
    expect(vault).toBeInstanceOf(SafeStorageVault)
    vault.set('fal', SECRET)
    expect(() => readFileSync(join(base.userDataDir, 'plain.json'))).toThrow()
  })
})
