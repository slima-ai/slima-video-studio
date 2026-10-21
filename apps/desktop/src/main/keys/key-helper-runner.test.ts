import { AppError } from '@svs/schema'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  HelperCrashedError,
  HelperTimeoutError,
  helperKeyCrypto,
  type HelperRunner,
} from './key-crypto'
import { createHelperRunner } from './key-helper-runner'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** 用 node 跑一支假的「小幫手」腳本（真的行程、真的 stdin／stdout、真的 kill），不需要 Electron。 */
function fakeHelper(body: string, timeoutMs = 5_000) {
  const dir = mkdtempSync(join(tmpdir(), 'svs-helper-'))
  dirs.push(dir)
  const script = join(dir, 'helper.js')
  writeFileSync(script, body)
  return {
    script,
    run: createHelperRunner({ execPath: process.execPath, appPath: script, timeoutMs }),
  }
}

const ECHO = `
let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  const req = JSON.parse(input)
  if (process.argv.join(' ').includes('SECRET')) process.exit(9)
  if (req.op === 'encrypt') process.stdout.write(JSON.stringify({ ok: true, cipher: 'enc:' + req.plain }))
  else process.stdout.write(JSON.stringify({ ok: true, plains: req.ciphers.map((c) => c.replace('enc:', '')) }))
})
`

describe('金鑰小幫手的執行（真的子行程）', () => {
  it('請求走 stdin、結果走 stdout；命令列上沒有機密', async () => {
    const { run } = fakeHelper(ECHO)
    const crypto = helperKeyCrypto(run)
    const cipher = await crypto.encrypt('SECRET-PLAIN-12345')
    expect(cipher).toBe('enc:SECRET-PLAIN-12345')
    expect(await crypto.decryptMany(['enc:a-secret-value', 'enc:b'])).toEqual([
      'a-secret-value',
      'b',
    ])
    expect(await crypto.decryptMany([])).toEqual([])
  })

  it('提示沒人按（小幫手一直不結束）：逾時、殺掉它，丟「可重試」的白話錯誤', async () => {
    const { run } = fakeHelper('setInterval(() => {}, 1000)', 300)
    // 不量牆鐘時間（機器忙、起子行程慢時會被拖慢）：小幫手永遠不結束，沒有逾時保護的話這一行會一直等下去，
    // 測試會卡到 vitest 的逾時而紅
    await expect(run({ op: 'decrypt', ciphers: ['x'] })).rejects.toBeInstanceOf(HelperTimeoutError)
    const error = await helperKeyCrypto(run)
      .decryptMany(['x'])
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).retryable).toBe(true)
    expect((error as AppError).userMessage).toContain('請按「允許」')
  })

  it('跑不起來、當掉、輸出不是預期格式：白話錯誤，不含系統訊息或路徑', async () => {
    const crashed = fakeHelper('process.exit(3)')
    const garbage = fakeHelper("process.stdout.write('not json at all /Users/someone/secret')")
    const missing = createHelperRunner({
      execPath: '/no/such/executable',
      appPath: '/no/such/app',
      timeoutMs: 2_000,
    })
    for (const run of [crashed.run, garbage.run, missing]) {
      await expect(run({ op: 'encrypt', plain: 'x' })).rejects.toBeInstanceOf(HelperCrashedError)
      const error = await helperKeyCrypto(run)
        .encrypt('abcdefgh')
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).userMessage).not.toMatch(/\/Users|\/no\/such|ENOENT|spawn/)
      expect((error as AppError).userMessage).toContain('金鑰圈')
    }
  })

  it('小幫手自己回報鑰匙圈不能用：說明怎麼辦', async () => {
    const { run } = fakeHelper(
      "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({ ok: false, reason: 'unavailable' })))",
    )
    const error = await helperKeyCrypto(run)
      .encrypt('abcdefgh')
      .catch((e: unknown) => e)
    expect((error as AppError).userMessage).toContain('系統金鑰圈目前無法使用')
  })

  it('ELECTRON_RUN_AS_NODE 不會傳給小幫手（否則它沒有 safeStorage）', async () => {
    const { run } = fakeHelper(`
      process.stdin.resume()
      process.stdin.on('end', () => process.stdout.write(JSON.stringify(
        process.env.ELECTRON_RUN_AS_NODE === undefined
          ? { ok: true, plains: ['absent'] } : { ok: true, plains: ['present'] })))`)
    const previous = process.env.ELECTRON_RUN_AS_NODE
    process.env.ELECTRON_RUN_AS_NODE = '1'
    try {
      expect(await helperKeyCrypto(run).decryptMany(['x'])).toEqual(['absent'])
    } finally {
      if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE
      else process.env.ELECTRON_RUN_AS_NODE = previous
    }
  })
})

describe('helperKeyCrypto 對回應的檢查', () => {
  it('回傳筆數對不上、型別不對時當作錯誤，不會把錯的東西當成金鑰', async () => {
    const wrongCount: HelperRunner = () => Promise.resolve({ ok: true, plains: ['only-one'] })
    await expect(helperKeyCrypto(wrongCount).decryptMany(['a', 'b'])).rejects.toBeInstanceOf(
      AppError,
    )
    const wrongShape: HelperRunner = () => Promise.resolve({ ok: true, cipher: 'x' })
    await expect(helperKeyCrypto(wrongShape).decryptMany(['a'])).rejects.toBeInstanceOf(AppError)
    await expect(
      helperKeyCrypto(() => Promise.resolve({ ok: true, plains: [] })).encrypt('abcdefgh'),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('不碰作業系統就能回答儲存狀態：一律可用（真的不能用會在加解密時報錯）', () => {
    expect(helperKeyCrypto(() => Promise.reject(new Error('不該被呼叫'))).storageInfo()).toEqual({
      available: true,
      kind: 'os',
    })
  })
})
