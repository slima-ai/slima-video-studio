import { GenerationOutputSchema, type AppError, type Job } from '@svs/schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { exampleFromJsonSchema } from './json-example'
import { createMockDriver, mockSize, type MockProviderConfig } from './mock-driver'
import { toLabelText } from './png'
import { memoryServices } from './test-services'

/** 讀 mp3 第一個影格的標頭：取樣率、聲道、位元率。 */
function mp3Format(bytes: Buffer): { sampleRate: number; channels: number; kbps: number } {
  const header = bytes.readUInt32BE(0)
  expect(header >>> 21).toBe(0x7ff) // 影格同步字
  expect((header >>> 19) & 3).toBe(3) // MPEG-1
  expect((header >>> 17) & 3).toBe(1) // Layer III
  return {
    sampleRate: [44100, 48000, 32000][(header >>> 10) & 3] ?? 0,
    channels: ((header >>> 6) & 3) === 3 ? 1 : 2,
    kbps:
      [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][(header >>> 12) & 15] ?? 0,
  }
}

/** 數 mp3 有幾個影格（照標頭算每格長度，一路走到檔尾）。 */
function mp3Frames(bytes: Buffer): number {
  let offset = 0
  let count = 0
  while (offset + 4 <= bytes.length) {
    const header = bytes.readUInt32BE(offset)
    const kbps =
      [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][(header >>> 12) & 15] ?? 0
    const rate = [44100, 48000, 32000][(header >>> 10) & 3] ?? 1
    offset += Math.floor((144 * kbps * 1000) / rate) + ((header >>> 9) & 1)
    count++
  }
  expect(offset).toBe(bytes.length) // 沒有多出來的零碎位元組
  return count
}

const signal = new AbortController().signal
const ctx = { signal }

function job(input: unknown, id = 'job-1'): Job {
  const stamp = '2026-10-12T08:00:00.000Z'
  return {
    id,
    provider: 'mock',
    modelId: 'mock/x',
    kind: 'image',
    status: 'running',
    attempt: 1,
    maxAttempts: 3,
    input,
    createdAt: stamp,
    updatedAt: stamp,
  }
}

const setup = (config: MockProviderConfig = {}) => {
  const services = memoryServices()
  return { services, driver: createMockDriver(services, config) }
}

const image = { capability: 't2i', modelId: 'mock/image', prompt: 'a cat', seed: 42 }
const video = { capability: 'i2v', modelId: 'mock/video', prompt: 'walk', durationSec: 3 }

const fakeVideo: MockProviderConfig['renderVideo'] = (opts) =>
  Promise.resolve({
    bytes: new TextEncoder().encode(`video:${opts.label}`),
    width: opts.width,
    height: opts.height,
    durationSec: opts.durationSec,
  })

describe('exampleFromJsonSchema', () => {
  it('依 Zod 轉出的 JSON Schema 產生符合結構的固定資料', () => {
    const schema = z.object({
      title: z.string(),
      shots: z
        .array(
          z.object({
            description: z.string().min(5),
            size: z.enum(['wide', 'close_up']),
            durationSec: z.number().min(3).max(6),
            characters: z.array(z.string()),
            mood: z.string().nullable(),
            locked: z.boolean().default(false),
          }),
        )
        .min(3)
        .max(6),
    })
    const example = exampleFromJsonSchema(z.toJSONSchema(schema))
    expect(schema.parse(example)).toBeTruthy()
    expect(example).toEqual(exampleFromJsonSchema(z.toJSONSchema(schema))) // 固定
    expect((example as { shots: unknown[] }).shots).toHaveLength(3)
  })

  it('各種寫法：const / enum / default / anyOf / allOf / 數字邊界 / 看不懂就 null', () => {
    expect(exampleFromJsonSchema({ const: 7 })).toBe(7)
    expect(exampleFromJsonSchema({ enum: ['a', 'b'] })).toBe('a')
    expect(exampleFromJsonSchema({ default: 'x', type: 'string' })).toBe('x')
    expect(
      exampleFromJsonSchema({ anyOf: [{ type: 'null' }, { type: 'integer', minimum: 5 }] }),
    ).toBe(5)
    expect(exampleFromJsonSchema({ oneOf: [{ type: 'boolean' }] })).toBe(true)
    expect(
      exampleFromJsonSchema({
        allOf: [
          { type: 'object', properties: { a: { type: 'integer' } } },
          { type: 'object', properties: { b: { type: 'string' } } },
        ],
      }),
    ).toEqual({ a: 1, b: '示範文字' })
    expect(exampleFromJsonSchema({ type: 'number', minimum: 10, maximum: 4 })).toBe(4)
    expect(exampleFromJsonSchema({ type: 'integer', exclusiveMinimum: 2 })).toBe(3)
    expect(exampleFromJsonSchema({ type: ['null', 'string'] })).toBe('示範文字')
    // 常見欄位用中文範例，不會出現英文欄位名；陣列元素保留編號
    expect(exampleFromJsonSchema({ type: 'string' }, 'description')).toMatch(/^示範畫面/)
    expect(
      exampleFromJsonSchema(
        { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
        'names',
      ),
    ).toEqual(['示範角色 1', '示範角色 2'])
    expect(exampleFromJsonSchema({ type: 'string', minLength: 12 })).toHaveLength(12)
    expect(
      exampleFromJsonSchema({ type: 'array', items: { type: 'string' }, maxItems: 1 }),
    ).toHaveLength(1)
    expect(exampleFromJsonSchema({ type: 'null' })).toBeNull()
    expect(exampleFromJsonSchema('nonsense')).toBeNull()
  })
})

describe('Mock driver：LLM', () => {
  it('有 JSON Schema 時回傳符合它的 JSON，並附 token 用量', async () => {
    const { driver } = setup()
    const schema = z.object({ title: z.string(), count: z.number().int() })
    const result = await driver.submit(
      job({
        capability: 'llm',
        modelId: 'mock/llm',
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        jsonSchema: z.toJSONSchema(schema),
      }),
      ctx,
    )
    expect(result.status).toBe('done')
    if (result.status !== 'done') return
    const out = GenerationOutputSchema.parse(result.output)
    expect(out.kind).toBe('text')
    if (out.kind === 'text') {
      expect(schema.parse(JSON.parse(out.text))).toBeTruthy()
      expect(out.usage?.inputTokens).toBeGreaterThan(0)
    }
  })

  it('沒有 schema 時回一段示範文字；fixture 可以覆寫（字串或物件）', async () => {
    const plain = setup()
    const r1 = await plain.driver.submit(
      job({ capability: 'llm', modelId: 'm', messages: [{ role: 'user', content: '你好嗎' }] }),
      ctx,
    )
    expect(r1).toMatchObject({
      status: 'done',
      output: { kind: 'text', text: '（示範回覆）你好嗎' },
    })

    const fixture = setup({
      llm: (req) =>
        req.system === 'json' ? { shots: [] } : req.system === 'text' ? '固定文字' : undefined,
    })
    const req = (system: string) =>
      job({ capability: 'llm', modelId: 'm', system, messages: [{ role: 'user', content: 'x' }] })
    expect(await fixture.driver.submit(req('json'), ctx)).toMatchObject({
      output: { text: '{"shots":[]}' },
    })
    expect(await fixture.driver.submit(req('text'), ctx)).toMatchObject({
      output: { text: '固定文字' },
    })
    expect(await fixture.driver.submit(req('other'), ctx)).toMatchObject({
      output: { text: '（示範回覆）x' },
    })
  })
})

describe('Mock driver：LLM 拆鏡與已建好的角色', () => {
  const schema = z.object({
    shots: z
      .array(z.object({ description: z.string(), characters: z.array(z.string()).default([]) }))
      .min(2),
  })
  const shotsFor = async (system: string): Promise<string[][]> => {
    const { driver } = setup()
    const result = await driver.submit(
      job({
        capability: 'llm',
        modelId: 'mock/llm',
        system,
        messages: [{ role: 'user', content: '故事' }],
        jsonSchema: z.toJSONSchema(schema),
      }),
      ctx,
    )
    if (result.status !== 'done') throw new Error('沒有完成')
    const out = GenerationOutputSchema.parse(result.output)
    if (out.kind !== 'text') throw new Error('不是文字')
    return schema.parse(JSON.parse(out.text)).shots.map((shot) => shot.characters)
  }

  it('Prompt 提到已建好的角色 → 每個鏡頭都由第一位角色出場；沒提到就維持空的', async () => {
    const withNames = await shotsFor('分鏡助手。已經建好的角色有：阿鐵、小花。只輸出 JSON。')
    expect(withNames.length).toBeGreaterThan(1)
    expect(withNames.every((characters) => characters.join() === '阿鐵')).toBe(true)
    const without = await shotsFor('分鏡助手。只輸出 JSON。')
    expect(without.every((characters) => characters.length === 0)).toBe(true)
  })
})

describe('Mock driver：圖片', () => {
  it('同步產出合法的 PNG，大小依長寬比；同樣的請求內容雜湊相同、不同 seed 不同', async () => {
    const { driver, services } = setup()
    const a = await driver.submit(job(image), ctx)
    const b = await driver.submit(job(image), ctx)
    const c = await driver.submit(job({ ...image, seed: 43 }), ctx)
    if (a.status !== 'done' || b.status !== 'done' || c.status !== 'done')
      throw new Error('應同步完成')
    const refA = GenerationOutputSchema.parse(a.output)
    const refB = GenerationOutputSchema.parse(b.output)
    const refC = GenerationOutputSchema.parse(c.output)
    if (refA.kind !== 'assets' || refB.kind !== 'assets' || refC.kind !== 'assets')
      throw new Error('應為素材')
    expect(refA.assets[0]).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      width: 640,
      height: 360,
    })
    expect(refA.assets[0]?.hash).toBe(refB.assets[0]?.hash)
    expect(refA.assets[0]?.hash).not.toBe(refC.assets[0]?.hash)
    const bytes = services.files.get(refA.assets[0]?.hash ?? '')
    expect(Buffer.from(bytes ?? []).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  })

  it('count 張、9:16 直式；圖片編輯也支援', async () => {
    const { driver } = setup()
    const r = await driver.submit(
      job({
        capability: 'edit',
        modelId: 'm',
        prompt: 'x',
        aspectRatio: '9:16',
        count: 3,
        referenceAssets: ['a'.repeat(64)],
      }),
      ctx,
    )
    if (r.status !== 'done') throw new Error('應同步完成')
    const out = GenerationOutputSchema.parse(r.output)
    if (out.kind !== 'assets') throw new Error('應為素材')
    expect(out.assets).toHaveLength(3)
    expect(new Set(out.assets.map((a) => a.hash)).size).toBe(3)
    expect(out.assets[0]).toMatchObject({ width: 360, height: 640 })
  })

  it('標籤只用字型畫得出來的字元，中文會變成 ?', () => {
    expect(toLabelText('shot 3 · 貓')).toBe('SHOT 3 ? ?')
    expect(mockSize('16:9')).toEqual([640, 360])
    expect(mockSize('weird')).toEqual([640, 360])
  })
})

describe('Mock driver：長任務（影片、配音）', () => {
  it('submit 回傳 providerJobId，poll 幾次後才完成', async () => {
    const { driver } = setup({ pollsBeforeDone: 2, renderVideo: fakeVideo, costUsd: () => 0.25 })
    const submitted = await driver.submit(job(video, 'v1'), ctx)
    expect(submitted).toEqual({ status: 'submitted', providerJobId: 'mock-v1' })
    const polling = job(video, 'v1')
    polling.providerJobId = 'mock-v1'
    expect(await driver.poll(polling, ctx)).toEqual({ status: 'pending' })
    expect(await driver.poll(polling, ctx)).toEqual({ status: 'pending' })
    const done = await driver.poll(polling, ctx)
    expect(done).toMatchObject({ status: 'done', costUsd: 0.25 })
    if (done.status !== 'done') return
    expect(GenerationOutputSchema.parse(done.output)).toMatchObject({
      kind: 'assets',
      assets: [{ kind: 'video', mime: 'video/mp4', durationSec: 3, width: 640, height: 360 }],
    })
    expect(driver.submitCalls).toBe(1)
    expect(driver.pollCalls).toBe(3)
  })

  it('重開後記憶體裡沒有進度：poll 直接完成（任務由資料庫接回）', async () => {
    const { driver } = setup({ renderVideo: fakeVideo })
    const restored = job(video, 'old')
    restored.providerJobId = 'mock-old'
    expect(await driver.poll(restored, ctx)).toMatchObject({ status: 'done' })
  })

  it('取消會清掉進度；沒有影片轉檔器時說明原因', async () => {
    const { driver } = setup({ renderVideo: fakeVideo })
    const j = job(video, 'c1')
    j.providerJobId = 'mock-c1'
    await driver.submit(j, ctx)
    await driver.cancel(j)
    expect(await driver.poll(j, ctx)).toMatchObject({ status: 'done' }) // 進度已清掉

    const bare = setup()
    const s = await bare.driver.submit(job(video), ctx)
    expect(s.status).toBe('submitted')
    await expect(bare.driver.poll({ ...job(video), providerJobId: 'x' }, ctx)).rejects.toThrow(
      /FFmpeg/,
    )
  })

  it('配音產生單聲道 32 kHz、128 kbps 的 mp3（和 MiniMax 一樣），長度依文字多寡', async () => {
    const { driver, services } = setup({ pollsBeforeDone: 0 })
    const bytesFor = async (text: string, id: string) => {
      const req = { capability: 'tts', modelId: 'm', text }
      await driver.submit(job(req, id), ctx)
      const done = await driver.poll({ ...job(req, id), providerJobId: `mock-${id}` }, ctx)
      if (done.status !== 'done') throw new Error('應完成')
      const out = GenerationOutputSchema.parse(done.output)
      if (out.kind !== 'assets') throw new Error('應為素材')
      expect(out.assets[0]).toMatchObject({ kind: 'audio', mime: 'audio/mpeg' })
      return {
        bytes: Buffer.from(services.files.get(out.assets[0]?.hash ?? '') ?? []),
        durationSec: out.assets[0]?.durationSec ?? 0,
      }
    }
    const short = await bytesFor('你好，這是一段示範配音。', 't1')
    expect(mp3Format(short.bytes)).toEqual({ sampleRate: 32000, channels: 1, kbps: 128 })
    const long = await bytesFor(
      '這是一段比較長的示範配音，字數多一些，所以聽起來會比較久一點。',
      't2',
    )
    expect(long.durationSec).toBeGreaterThan(short.durationSec)
    // 內容長度就是記下來的長度（誤差不到一個影格）
    expect(Math.abs(short.durationSec - mp3Frames(short.bytes) * (1152 / 32000))).toBeLessThan(1e-6)
  })

  it('配樂產生立體聲 44.1 kHz、192 kbps 的 mp3（和 Lyria 一樣），長度依 durationSec（沒給就 30 秒，最多 60 秒）', async () => {
    const { driver, services } = setup({ pollsBeforeDone: 0 })
    const durationOf = async (extra: Record<string, unknown>, id: string): Promise<number> => {
      const req = { capability: 'music', modelId: 'm', prompt: 'calm', ...extra }
      await driver.submit(job(req, id), ctx)
      const done = await driver.poll({ ...job(req, id), providerJobId: `mock-${id}` }, ctx)
      if (done.status !== 'done') throw new Error('應完成')
      const out = GenerationOutputSchema.parse(done.output)
      if (out.kind !== 'assets') throw new Error('應為素材')
      expect(out.assets[0]).toMatchObject({ kind: 'audio', mime: 'audio/mpeg' })
      expect(mp3Format(Buffer.from(services.files.get(out.assets[0]?.hash ?? '') ?? []))).toEqual({
        sampleRate: 44100,
        channels: 2,
        kbps: 192,
      })
      return out.assets[0]?.durationSec ?? 0
    }
    // 長度取到最近的 mp3 影格（約 26 毫秒）
    expect(await durationOf({ durationSec: 12 }, 'm1')).toBeCloseTo(12, 1)
    expect(await durationOf({}, 'm2')).toBeCloseTo(30, 1)
    expect(await durationOf({ durationSec: 600 }, 'm3')).toBeCloseTo(60, 1)
  })
})

describe('Mock driver：注入失敗', () => {
  const failure = async (promise: Promise<unknown>): Promise<AppError> => {
    try {
      await promise
    } catch (error) {
      return error as AppError
    }
    throw new Error('應該丟錯')
  }

  it('指定第 N 次回 429（可重試、帶等待時間）；其他次正常', async () => {
    const { driver } = setup({ rateLimitOnCalls: [2], retryAfterMs: 1500 })
    await driver.submit(job(image), ctx)
    const error = await failure(driver.submit(job(image), ctx))
    expect(error).toMatchObject({
      code: 'provider_rate_limited',
      retryable: true,
      retryAfterMs: 1500,
    })
    await driver.submit(job(image), ctx)
    expect(driver.submitCalls).toBe(3)
  })

  it('指定第 N 次被拒絕：不可重試', async () => {
    const { driver } = setup({ rejectOnCalls: [1] })
    expect(await failure(driver.submit(job(image), ctx))).toMatchObject({
      code: 'provider_rejected',
      retryable: false,
    })
  })

  it('請求含指定文字就拒絕（不可重試）；不含就照常完成', async () => {
    const { driver } = setup({ rejectText: '【拒絕】' })
    await driver.submit(job(image), ctx)
    const rejected = { ...image, prompt: `一隻貓【拒絕】` }
    expect(await failure(driver.submit(job(rejected), ctx))).toMatchObject({
      code: 'provider_rejected',
      retryable: false,
    })
  })

  it('失敗率依 seed 可重現：0 永遠成功、1 永遠失敗（可重試）', async () => {
    const never = setup({ failureRate: 0 })
    for (let i = 0; i < 5; i++) await never.driver.submit(job(image), ctx)
    const always = setup({ failureRate: 1 })
    expect(await failure(always.driver.submit(job(image), ctx))).toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    })

    const outcomes = async (seed: number): Promise<boolean[]> => {
      const { driver } = setup({ failureRate: 0.5, seed })
      const results: boolean[] = []
      for (let i = 0; i < 20; i++) {
        results.push(
          await driver.submit(job(image), ctx).then(
            () => true,
            () => false,
          ),
        )
      }
      return results
    }
    const a = await outcomes(7)
    expect(a).toEqual(await outcomes(7))
    expect(a.some(Boolean) && a.some((ok) => !ok)).toBe(true)
  })

  it('請求格式不對 → 不可重試的拒絕；取消訊號會中斷延遲', async () => {
    const { driver } = setup()
    expect(await failure(driver.submit(job({ capability: 'nope' }), ctx))).toMatchObject({
      code: 'provider_rejected',
    })
    const controller = new AbortController()
    const slow = setup({ latencyMs: 10_000 })
    const pending = failure(slow.driver.submit(job(image), { signal: controller.signal }))
    controller.abort()
    expect(await pending).toMatchObject({ code: 'cancelled' })
  })

  it('latencyMs 為 0 時不等待；有延遲時真的等', async () => {
    const waits: number[] = []
    const { driver } = setup({
      latencyMs: 250,
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    })
    await driver.submit(job(image), ctx)
    expect(waits).toEqual([250])
  })
})

describe('Mock driver：示範拆鏡', () => {
  it('照「請拆成 N 個鏡頭」產生 N 鏡，畫面描述取自故事、全是中文，景別輪流換', async () => {
    const { driver } = setup()
    const schema = z.object({
      title: z.string(),
      shots: z
        .array(
          z.object({
            description: z.string(),
            size: z.enum(['wide', 'medium', 'close_up']).default('medium'),
            characters: z.array(z.string()).default([]),
          }),
        )
        .min(1)
        .max(12),
    })
    const result = await driver.submit(
      job({
        capability: 'llm',
        modelId: 'mock/llm',
        messages: [
          {
            role: 'user',
            content: '故事：\n一隻貓在下雨的夜晚，找到溫暖的家。\n\n請拆成 5 個鏡頭。',
          },
        ],
        jsonSchema: z.toJSONSchema(schema),
      }),
      ctx,
    )
    if (result.status !== 'done') throw new Error('沒有完成')
    const output = GenerationOutputSchema.parse(result.output)
    if (output.kind !== 'text') throw new Error('不是文字')
    const parsed = schema.parse(JSON.parse(output.text))
    expect(parsed.shots).toHaveLength(5)
    expect(parsed.title).toBe('一隻貓在下雨的夜晚，找到溫暖的家')
    expect(parsed.shots[0]?.description).toBe('開場：一隻貓在下雨的夜晚')
    expect(parsed.shots[4]?.description).toBe('結尾：找到溫暖的家')
    expect(parsed.shots.map((s) => s.size)).toEqual([
      'wide',
      'medium',
      'close_up',
      'wide',
      'medium',
    ])
    for (const shot of parsed.shots) expect(shot.description).not.toMatch(/[a-z]/i)
  })

  it('schema 有 dialogue（一句話勾了旁白）：每一鏡都有台詞，取自那一段故事；沒有 dialogue 就不加', async () => {
    const { driver } = setup()
    const run = async (withDialogue: boolean) => {
      const shot = z.object({
        description: z.string(),
        ...(withDialogue ? { dialogue: z.string().min(1) } : {}),
      })
      const schema = z.object({ title: z.string(), shots: z.array(shot).min(1).max(12) })
      const result = await driver.submit(
        job({
          capability: 'llm',
          modelId: 'mock/llm',
          messages: [
            {
              role: 'user',
              content: '故事：\n一隻貓在下雨的夜晚，找到溫暖的家。\n\n請拆成 3 個鏡頭。',
            },
          ],
          jsonSchema: z.toJSONSchema(schema),
        }),
        ctx,
      )
      if (result.status !== 'done') throw new Error('沒有完成')
      const output = GenerationOutputSchema.parse(result.output)
      if (output.kind !== 'text') throw new Error('不是文字')
      return JSON.parse(output.text) as { shots: { dialogue?: string }[] }
    }
    const withLines = await run(true)
    expect(withLines.shots).toHaveLength(3)
    for (const shot of withLines.shots) expect((shot.dialogue ?? '').length).toBeGreaterThan(0)
    expect(withLines.shots[0]?.dialogue).toBe('一隻貓在下雨的夜晚')
    const without = await run(false)
    for (const shot of without.shots) expect(shot.dialogue).toBeUndefined()
  })
})
