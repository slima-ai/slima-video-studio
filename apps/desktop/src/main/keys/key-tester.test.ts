import type { FetchLike } from '@svs/providers'
import { isAppError, type AppError } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { createKeyTester } from './key-tester'
import { MemoryVault } from './key-vault'

const KEY = 'sk-test-SECRETSECRET1234'
const signal = new AbortController().signal

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function setup(provider: string, responder: (url: string) => Response | Error) {
  const keys = new MemoryVault()
  keys.set(provider, KEY)
  const urls: string[] = []
  const fetch: FetchLike = (url) => {
    urls.push(url)
    const result = responder(url)
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  }
  return { test: createKeyTester({ keys, fetch }), urls }
}

const failure = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise
  } catch (error) {
    if (isAppError(error)) return error
    throw error
  }
  throw new Error('應該丟錯')
}

describe('createKeyTester', () => {
  it('OpenRouter：有效 → 回傳剩餘額度', async () => {
    const { test, urls } = setup('openrouter', (url) =>
      url.endsWith('/key')
        ? json({ data: { label: 'sk-or-v1-abc' } })
        : json({ data: { total_credits: 20, total_usage: 7.5 } }),
    )
    expect(await test('openrouter', signal)).toEqual({
      provider: 'openrouter',
      valid: true,
      balanceUsd: 12.5,
    })
    expect(urls).toHaveLength(2)
  })

  it('OpenRouter：查不到餘額（權限不足）不影響結果', async () => {
    const { test } = setup('openrouter', (url) =>
      url.endsWith('/key') ? json({ data: {} }) : json({}, 403),
    )
    expect(await test('openrouter', signal)).toEqual({ provider: 'openrouter', valid: true })
  })

  it('OpenRouter：Key 無效 → valid: false（不是錯誤），也不去查餘額', async () => {
    const { test, urls } = setup('openrouter', () => json({}, 401))
    expect(await test('openrouter', signal)).toEqual({ provider: 'openrouter', valid: false })
    expect(urls).toHaveLength(1)
  })

  it('OpenRouter：斷線 → 可重試的錯誤', async () => {
    const { test } = setup('openrouter', () => new Error('ECONNRESET'))
    expect(await failure(test('openrouter', signal))).toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    })
  })

  it('fal：401 → 無效；404（找不到任務）→ 有效', async () => {
    const bad = setup('fal', () => json({}, 401))
    expect(await bad.test('fal', signal)).toEqual({ provider: 'fal', valid: false })
    const good = setup('fal', () => json({}, 404))
    expect(await good.test('fal', signal)).toEqual({ provider: 'fal', valid: true })
  })

  it('還沒填 Key → 提示先填；不支援的供應商 → 拒絕', async () => {
    const keys = new MemoryVault()
    const test = createKeyTester({ keys })
    expect(await failure(test('fal', signal))).toMatchObject({ code: 'key_invalid' })
    keys.set('other', KEY)
    expect(await failure(test('other', signal))).toMatchObject({ code: 'invalid_request' })
  })

  it('錯誤與回傳都不含 Key', async () => {
    const { test } = setup('openrouter', () => json({ error: KEY }, 500))
    const error = await failure(test('openrouter', signal))
    expect(JSON.stringify(error.toShape())).not.toContain('SECRETSECRET')
  })
})
