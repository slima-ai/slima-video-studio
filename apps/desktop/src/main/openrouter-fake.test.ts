import { OpenRouterClient, type FetchLike } from '@svs/providers'
import { FAKE_OPENROUTER_KEY, startFakeOpenRouter, type FakeOpenRouter } from '@svs/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createKeyTester } from './keys/key-tester'
import { MemoryVault } from './keys/key-vault'

// 真的 OpenRouterClient 對一個真的（本機）HTTP 伺服器：證明 baseUrl 接得起來，文字、圖片、影片、
// 金鑰測試都真的走了網路請求。假伺服器的回應長相是照文件與 client 的 schema 寫的，真實 API 要真的 Key 才驗得到。
const signal = new AbortController().signal

let fake: FakeOpenRouter
beforeEach(async () => {
  fake = await startFakeOpenRouter()
})
afterEach(async () => {
  await fake.close()
})

const client = (key: string | undefined = FAKE_OPENROUTER_KEY) =>
  new OpenRouterClient({
    getKey: () => key,
    endpointFor: (modelId) => `fake/${modelId}`,
    baseUrl: fake.url,
  })

const BreakdownSchema = z.object({
  title: z.string(),
  shots: z.array(z.object({ description: z.string(), size: z.enum(['wide', 'close_up']) })),
})

describe('假 OpenRouter + 真的 OpenRouterClient', () => {
  it('文字：結構化輸出，照「請拆成 N 個鏡頭」出 N 鏡，內容符合 schema', async () => {
    const jsonSchema = z.toJSONSchema(BreakdownSchema) as Record<string, unknown>
    const result = await client().chat(
      {
        modelId: 'llm',
        capability: 'llm',
        messages: [{ role: 'user', content: '故事：\n一隻貓找到家\n\n請拆成 4 個鏡頭。' }],
        jsonSchema,
      },
      signal,
    )
    const data = BreakdownSchema.parse(JSON.parse(result.text))
    expect(data.shots).toHaveLength(4)
    expect(data.shots[0]?.description).toContain('一隻貓找到家')
    expect(result.costUsd).toBeGreaterThan(0)
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /chat/completions'])
  })

  it('圖片：回得來一張合法的 PNG', async () => {
    const image = await client().generateImage(
      {
        modelId: 'image',
        capability: 't2i',
        prompt: '雨夜的貓',
        aspectRatio: '16:9',
        referenceDataUris: [],
      },
      signal,
    )
    expect(image.mime).toBe('image/png')
    expect([...image.bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47])
  })

  it('影片：送出 → 輪詢（第一次還在進行、第二次完成）→ 下載到 MP4', async () => {
    const c = client()
    const id = await c.submitVideo({ model: 'fake/video', prompt: '貓走過雨夜' }, signal)
    expect((await c.videoStatus(id, signal)).state).toBe('pending')
    expect((await c.videoStatus(id, signal)).state).toBe('completed')
    const video = await c.downloadVideo(id, signal, 50_000_000)
    expect(video.mime).toBe('video/mp4')
    // MP4 的第 5～8 個位元組是 "ftyp"
    expect(Buffer.from(video.bytes.slice(4, 8)).toString('ascii')).toBe('ftyp')
  })

  it('Key 錯：401 整理成 provider_auth_failed；沒填 Key 不會送出請求', async () => {
    await expect(
      client('sk-or-wrong').chat(
        { modelId: 'llm', capability: 'llm', messages: [{ role: 'user', content: 'hi' }] },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'provider_auth_failed' })
    const before = fake.requests.length
    await expect(client('').testKey(signal)).rejects.toMatchObject({
      code: 'provider_auth_failed',
    })
    expect(fake.requests).toHaveLength(before)
  })

  describe('金鑰測試器（設定頁的「測試連線」）', () => {
    it('給了 openrouterBaseUrl：打到假伺服器，Key 對 → valid 並帶餘額', async () => {
      const keys = new MemoryVault()
      keys.set('openrouter', FAKE_OPENROUTER_KEY)
      const result = await createKeyTester({ keys, openrouterBaseUrl: fake.url })(
        'openrouter',
        signal,
      )
      expect(result).toEqual({ provider: 'openrouter', valid: true, balanceUsd: 9.5 })
      expect(fake.requests.map((r) => r.path)).toEqual(['/key', '/credits'])
    })

    it('Key 錯 → valid: false', async () => {
      const keys = new MemoryVault()
      keys.set('openrouter', 'sk-or-wrong')
      const result = await createKeyTester({ keys, openrouterBaseUrl: fake.url })(
        'openrouter',
        signal,
      )
      expect(result).toEqual({ provider: 'openrouter', valid: false })
    })

    it('沒給 openrouterBaseUrl：預設行為不變，連的是 openrouter.ai', async () => {
      const keys = new MemoryVault()
      keys.set('openrouter', FAKE_OPENROUTER_KEY)
      const urls: string[] = []
      const fetch: FetchLike = (url) => {
        urls.push(url)
        return Promise.resolve(new Response('{}', { status: 401 }))
      }
      await createKeyTester({ keys, fetch })('openrouter', signal)
      expect(urls[0]).toBe('https://openrouter.ai/api/v1/key')
      expect(fake.requests).toHaveLength(0)
    })
  })
})
