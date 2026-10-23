import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createAllowance } from './allowance'
import { createRedactor } from './redact'
import { clientOf } from './server'
import { createTokenStore } from './token'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'svs-mcp-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('連線 token', () => {
  it('第一次用就產生、存成檔案（權限 600）；重開後還是同一組', () => {
    const file = join(tmp(), 'mcp-token')
    const first = createTokenStore(file).get()
    expect(first).toMatch(/^svs_[A-Za-z0-9_-]{43}$/)
    expect(existsSync(file)).toBe(true)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(createTokenStore(file).get()).toBe(first)
  })

  it('regenerate 換一組新的並寫回檔案；檔案壞掉就重新產生', () => {
    const file = join(tmp(), 'mcp-token')
    const store = createTokenStore(file)
    const old = store.get()
    const next = store.regenerate()
    expect(next).not.toBe(old)
    expect(readFileSync(file, 'utf8')).toBe(next)
    writeFileSync(file, 'garbage')
    const repaired = createTokenStore(file).get()
    expect(repaired).toMatch(/^svs_/)
    expect(repaired).not.toBe('garbage')
  })
})

describe('AI 工具額度', () => {
  const make = (opts: { allowance: number; demo?: boolean }) => {
    const file = join(tmp(), 'committed.json')
    const state = {
      allowance: opts.allowance,
      demo: opts.demo ?? false,
      spend: { dir: '/project-a', spentUsd: 0 } as { dir: string; spentUsd: number } | undefined,
    }
    const build = () =>
      createAllowance({
        file,
        allowanceUsd: () => state.allowance,
        demoMode: () => state.demo,
        spend: () => state.spend,
      })
    return { build, state, file }
  }

  it('預設額度 0：任何要花錢的預留都被拒絕，而且說明還剩多少', () => {
    const { build } = make({ allowance: 0 })
    expect(build().reserve(0.01)).toEqual({
      ok: false,
      requestedUsd: 0.01,
      remainingUsd: 0,
      allowanceUsd: 0,
    })
  })

  it('額度內可以預留，預留的金額只增不減；超過剩下的就拒絕且不扣', () => {
    const { build } = make({ allowance: 1 })
    const a = build()
    expect(a.reserve(0.4)).toEqual({ ok: true, remainingUsd: 0.6 })
    expect(a.reserve(0.7)).toMatchObject({ ok: false, remainingUsd: 0.6 })
    expect(a.status()).toEqual({ allowanceUsd: 1, committedUsd: 0.4, remainingUsd: 0.6 })
    expect(a.reserve(0.6)).toMatchObject({ ok: true })
    expect(a.status().remainingUsd).toBe(0)
  })

  it('做完以後預留改成實際花的，多預留的退回；實際比預留多也只算到預留', () => {
    const { build, state } = make({ allowance: 1 })
    const a = build()
    a.reserve(0.5)
    state.spend = { dir: '/project-a', spentUsd: 0.2 }
    expect(a.settle()).toBeCloseTo(0.3)
    expect(a.status().committedUsd).toBeCloseTo(0.2)
    expect(a.hasOpen()).toBe(false)
    a.reserve(0.1)
    state.spend = { dir: '/project-a', spentUsd: 0.9 }
    expect(a.settle()).toBe(0)
    expect(a.status().committedUsd).toBeCloseTo(0.3)
  })

  it('兩次預留接在一起結算：起點取最早的那次，退回的是總預留減實際', () => {
    const { build, state } = make({ allowance: 2 })
    const a = build()
    a.reserve(0.5)
    state.spend = { dir: '/project-a', spentUsd: 0.1 }
    a.reserve(0.5)
    state.spend = { dir: '/project-a', spentUsd: 0.4 }
    expect(a.settle()).toBeCloseTo(0.6)
    expect(a.status().committedUsd).toBeCloseTo(0.4)
  })

  it('專案換了或讀不到專案就不退（算不出這一段花了多少）；沒預留就沒什麼好結算', () => {
    const { build, state } = make({ allowance: 1 })
    const a = build()
    expect(a.settle()).toBe(0)
    a.reserve(0.5)
    state.spend = { dir: '/project-b', spentUsd: 0 }
    expect(a.settle()).toBe(0)
    expect(a.status().committedUsd).toBe(0.5)
    state.spend = undefined
    a.reserve(0.2)
    state.spend = { dir: '/project-a', spentUsd: 0 }
    expect(a.settle()).toBe(0)
    expect(a.status().committedUsd).toBe(0.7)
  })

  it('還沒結算的預留存在檔案裡，重開 App 後照樣能結算；歸零連同它一起清掉', () => {
    const { build, state } = make({ allowance: 1 })
    build().reserve(0.5)
    state.spend = { dir: '/project-a', spentUsd: 0.1 }
    const reopened = build()
    expect(reopened.hasOpen()).toBe(true)
    expect(reopened.settle()).toBeCloseTo(0.4)
    reopened.reserve(0.3)
    reopened.reset()
    expect(build().hasOpen()).toBe(false)
  })

  it('已預留的金額存在檔案裡，重開後還在；人按歸零才重新算；額度由人（設定）調整', () => {
    const { build, state } = make({ allowance: 1 })
    build().reserve(0.5)
    const reopened = build()
    expect(reopened.status().committedUsd).toBe(0.5)
    state.allowance = 2
    expect(reopened.status().remainingUsd).toBe(1.5)
    reopened.reset()
    expect(build().status().committedUsd).toBe(0)
  })

  it('示範模式不花真錢：不預留、不擋', () => {
    const { build } = make({ allowance: 0, demo: true })
    const a = build()
    expect(a.reserve(5)).toMatchObject({ ok: true })
    expect(a.status().committedUsd).toBe(0)
  })

  it('檔案壞掉當作 0', () => {
    const { build, file } = make({ allowance: 1 })
    writeFileSync(file, '{not json')
    expect(build().status().committedUsd).toBe(0)
  })
})

describe('遮蔽', () => {
  it('文字裡出現的金鑰與 token 一律換掉；太短的字串不算（避免把一般文字誤傷）', () => {
    const r = createRedactor(() => ['sk-live-AAAAAAAA', undefined, 'abc'])
    expect(r.redact('key=sk-live-AAAAAAAA and again sk-live-AAAAAAAA; abc')).toBe(
      'key=[redacted] and again [redacted]; abc',
    )
  })
})

describe('對方報的名字（initialize）', () => {
  it('只有 initialize 帶 clientInfo.name 才有；其他請求、壞格式、空字串都沒有；太長的截掉', () => {
    const init = (name: unknown) => ({ method: 'initialize', params: { clientInfo: { name } } })
    expect(clientOf(init('claude-code'))).toEqual({ client: 'claude-code' })
    expect(clientOf({ method: 'tools/list' })).toEqual({})
    expect(clientOf(init(''))).toEqual({})
    expect(clientOf(init(42))).toEqual({})
    expect(clientOf(null)).toEqual({})
    expect(clientOf([init('x')])).toEqual({})
    expect(clientOf(init('a'.repeat(100))).client).toHaveLength(64)
  })
})
