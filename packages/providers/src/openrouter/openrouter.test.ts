import { type AppError, type Job } from '@svs/schema'
import { describe, expect, it, vi } from 'vitest'

import { parseRetryAfter } from '../http/errors'
import type { FetchLike } from '../http/fetch'
import { OpenRouterClient } from './client'
import { memoryServices } from '../mock/test-services'
import { createOpenRouterDriver } from './driver'

const KEY = 'sk-or-v1-SUPERSECRETKEY'
const signal = new AbortController().signal

interface Call {
  url: string
  init: RequestInit
  body?: Record<string, unknown>
}

function fakeFetch(...responses: (Response | Error | ((call: Call) => Response))[]) {
  const calls: Call[] = []
  const impl: FetchLike = (url, init) => {
    const call: Call = {
      url,
      init,
      ...(typeof init.body === 'string'
        ? { body: JSON.parse(init.body) as Record<string, unknown> }
        : {}),
    }
    calls.push(call)
    const next = responses.shift()
    if (next === undefined) return Promise.reject(new Error('沒有預備的回應'))
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(typeof next === 'function' ? next(call) : next)
  }
  return { impl, calls }
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

const completion = (content: string, extra: Record<string, unknown> = {}) =>
  json({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0042 },
    ...extra,
  })

const make = (
  fetchImpl: FetchLike,
  overrides: { getKey?: () => string | undefined; timeoutMs?: number } = {},
) =>
  new OpenRouterClient({
    getKey: () => KEY,
    endpointFor: (id) =>
      id === 'openrouter/claude-sonnet-5.5' ? 'anthropic/claude-sonnet-5.5' : undefined,
    fetch: fetchImpl,
    ...overrides,
  })

const req = {
  capability: 'llm' as const,
  modelId: 'openrouter/claude-sonnet-5.5',
  system: '你是助手',
  messages: [{ role: 'user' as const, content: '你好' }],
}

const failure = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise
  } catch (error) {
    return error as AppError
  }
  throw new Error('應該丟錯')
}

describe('OpenRouterClient.chat', () => {
  it('成功：送出正確的請求，回傳文字、token 用量與供應商回報的花費', async () => {
    const { impl, calls } = fakeFetch(completion('你好！'))
    const result = await make(impl).chat(
      { ...req, maxTokens: 500, temperature: 0.3, seed: 7 },
      signal,
    )
    expect(result).toEqual({
      text: '你好！',
      usage: { inputTokens: 120, outputTokens: 30 },
      costUsd: 0.0042,
    })
    const call = calls[0]
    expect(call?.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((call?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    expect(call?.body).toMatchObject({
      model: 'anthropic/claude-sonnet-5.5',
      stream: false,
      max_tokens: 500,
      temperature: 0.3,
      seed: 7,
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '你好' },
      ],
    })
    expect(call?.body).not.toHaveProperty('response_format')
  })

  it('結構化輸出：附上 JSON Schema', async () => {
    const { impl, calls } = fakeFetch(completion('{"a":1}'))
    const schema = { type: 'object', properties: { a: { type: 'number' } } }
    await make(impl).chat({ ...req, jsonSchema: schema }, signal)
    expect(calls[0]?.body?.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'result', strict: true, schema },
    })
  })

  it('沒有 usage 也可以；沒有 system 時不送 system 訊息', async () => {
    const { impl, calls } = fakeFetch(json({ choices: [{ message: { content: 'ok' } }] }))
    const noSystem = { ...req, system: undefined }
    expect(await make(impl).chat(noSystem, signal)).toEqual({ text: 'ok' })
    expect((calls[0]?.body?.messages as unknown[]).length).toBe(1)
  })

  it('401 → Key 無效（不可重試），訊息和錯誤內容都不含 Key', async () => {
    const { impl } = fakeFetch(json({ error: { message: `bad key ${KEY}` } }, { status: 401 }))
    const error = await failure(make(impl).chat(req, signal))
    expect(error).toMatchObject({ code: 'provider_auth_failed', retryable: false })
    expect(error.userMessage).toContain('OpenRouter')
    expect(JSON.stringify(error.toShape())).not.toContain('SUPERSECRET')
  })

  it('429 → 可重試，並帶上 Retry-After；5xx → 可重試；402 → 餘額不足；400 → 被拒絕', async () => {
    const { impl } = fakeFetch(
      json({}, { status: 429, headers: { 'retry-after': '7' } }),
      json({}, { status: 503 }),
      json({}, { status: 402 }),
      json({}, { status: 400 }),
      json({}, { status: 408 }),
    )
    const client = make(impl)
    expect(await failure(client.chat(req, signal))).toMatchObject({
      code: 'provider_rate_limited',
      retryable: true,
      retryAfterMs: 7000,
    })
    expect(await failure(client.chat(req, signal))).toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    })
    expect(await failure(client.chat(req, signal))).toMatchObject({
      code: 'provider_insufficient_funds',
      retryable: false,
    })
    expect(await failure(client.chat(req, signal))).toMatchObject({
      code: 'provider_rejected',
      retryable: false,
    })
    expect(await failure(client.chat(req, signal))).toMatchObject({
      code: 'provider_timeout',
      retryable: true,
    })
  })

  it('HTTP 200 但 body 是錯誤：依裡面的代碼分類', async () => {
    const { impl } = fakeFetch(
      json({ error: { code: 429, message: 'slow down' } }),
      json({ error: { message: 'weird' } }),
    )
    const client = make(impl)
    expect(await failure(client.chat(req, signal))).toMatchObject({ code: 'provider_rate_limited' })
    expect(await failure(client.chat(req, signal))).toMatchObject({ code: 'provider_unavailable' })
  })

  it('斷線 → 可重試；逾時 → 逾時（可重試）；呼叫端取消 → cancelled', async () => {
    const dropped = fakeFetch(new TypeError('fetch failed'))
    expect(await failure(make(dropped.impl).chat(req, signal))).toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    })

    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    expect(await failure(make(hang, { timeoutMs: 20 }).chat(req, signal))).toMatchObject({
      code: 'provider_timeout',
      retryable: true,
    })

    const controller = new AbortController()
    const pending = failure(make(hang).chat(req, controller.signal))
    controller.abort()
    expect(await pending).toMatchObject({ code: 'cancelled' })
  })

  it('內容格式不對、內容為空（被過濾）、body 不是 JSON', async () => {
    const { impl } = fakeFetch(
      json({ nope: true }),
      json({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }),
      new Response('<html>bad gateway</html>', { status: 200 }),
    )
    const client = make(impl)
    expect(await failure(client.chat(req, signal))).toMatchObject({
      code: 'invalid_response',
      retryable: true,
    })
    expect(await failure(client.chat(req, signal))).toMatchObject({ code: 'provider_rejected' })
    expect(await failure(client.chat(req, signal))).toMatchObject({
      code: 'invalid_response',
      retryable: true,
    })
  })

  it('沒有 Key、不認得的模型：在送出請求前就回報', async () => {
    const { impl, calls } = fakeFetch()
    expect(await failure(make(impl, { getKey: () => undefined }).chat(req, signal))).toMatchObject({
      code: 'provider_auth_failed',
    })
    expect(
      await failure(make(impl).chat({ ...req, modelId: 'openrouter/ghost' }, signal)),
    ).toMatchObject({
      code: 'invalid_request',
    })
    expect(calls).toHaveLength(0)
  })
})

describe('OpenRouterClient.stream / testKey / balance', () => {
  const sse = (lines: string[]): Response =>
    new Response(lines.join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })

  it('串流：依序吐出文字片段，略過註解與不認得的行，遇到 [DONE] 結束', async () => {
    const { impl, calls } = fakeFetch(
      sse([
        ': OPENROUTER PROCESSING',
        '',
        'data: {"choices":[{"delta":{"content":"你"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"好"}}]}',
        'data: {broken',
        'data: {"choices":[{"delta":{}}]}',
        'data: [DONE]',
        'data: {"choices":[{"delta":{"content":"不該出現"}}]}',
      ]),
    )
    const chunks: string[] = []
    for await (const piece of make(impl).stream(req, signal)) chunks.push(piece)
    expect(chunks).toEqual(['你', '好'])
    expect(calls[0]?.body?.stream).toBe(true)
  })

  it('串流一開始就失敗時丟出型別化錯誤', async () => {
    const { impl } = fakeFetch(json({}, { status: 401 }))
    const consume = async (): Promise<void> => {
      for await (const chunk of make(impl).stream(req, signal)) expect(chunk).toBeDefined()
    }
    expect(await failure(consume())).toMatchObject({ code: 'provider_auth_failed' })
  })

  it('測試連線與查餘額', async () => {
    const { impl, calls } = fakeFetch(
      json({ data: { label: 'sk-or-v1-abc...xyz' } }),
      json({ data: { total_credits: 10, total_usage: 3.25 } }),
      json({ data: {} }),
      json({ weird: 1 }),
    )
    const client = make(impl)
    expect(await client.testKey(signal)).toEqual({ label: 'sk-or-v1-abc...xyz' })
    expect(await client.balance(signal)).toEqual({
      totalCredits: 10,
      totalUsage: 3.25,
      remainingUsd: 6.75,
    })
    expect(calls.map((c) => c.url)).toEqual([
      'https://openrouter.ai/api/v1/key',
      'https://openrouter.ai/api/v1/credits',
    ])
    expect(await client.testKey(signal)).toEqual({})
    expect(await failure(client.balance(signal))).toMatchObject({ code: 'invalid_response' })
  })
})

const job = (input: unknown): Job => ({
  id: 'j1',
  provider: 'openrouter',
  modelId: 'openrouter/claude-sonnet-5.5',
  kind: 'llm',
  status: 'running',
  attempt: 1,
  maxAttempts: 3,
  input,
  createdAt: '2026-10-12T08:00:00.000Z',
  updatedAt: '2026-10-12T08:00:00.000Z',
})

describe('createOpenRouterDriver：文字', () => {
  it('submit：同步完成，輸出文字、用量與花費', async () => {
    const { impl } = fakeFetch(completion('結果'))
    const driver = createOpenRouterDriver({
      getKey: () => KEY,
      endpointFor: () => 'anthropic/claude-sonnet-5.5',
      fetch: impl,
      services: memoryServices(),
    })
    expect(await driver.submit(job(req), { signal })).toEqual({
      status: 'done',
      output: { kind: 'text', text: '結果', usage: { inputTokens: 120, outputTokens: 30 } },
      costUsd: 0.0042,
    })
  })

  it('語音請求會被拒絕；文字任務不需要輪詢', async () => {
    const fetchSpy = vi.fn()
    const driver = createOpenRouterDriver({
      getKey: () => KEY,
      endpointFor: () => 'x',
      fetch: fetchSpy,
      services: memoryServices(),
    })
    expect(
      await failure(driver.submit(job({ capability: 'tts', modelId: 'x', text: 'p' }), { signal })),
    ).toMatchObject({ code: 'provider_rejected' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await failure(driver.poll(job(req), { signal }))).toMatchObject({
      code: 'internal_error',
    })
  })
})

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])
const dataUrl = (bytes: Uint8Array, mime = 'image/png'): string =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`

const imageCompletion = (url: string, cost = 0.134) =>
  json({
    choices: [{ message: { content: '', images: [{ type: 'image_url', image_url: { url } }] } }],
    usage: { cost },
  })

const ENDPOINTS: Record<string, string> = {
  t2i: 'google/gemini-3-pro-image',
  edit: 'google/gemini-3-pro-image',
  t2v: 'google/veo-3.1-lite',
  i2v: 'google/veo-3.1-lite',
  r2v: 'kwaivgi/kling-v3.0-std',
}

function makeMedia(...responses: (Response | Error | ((call: Call) => Response))[]) {
  const { impl, calls } = fakeFetch(...responses)
  const services = memoryServices()
  const driver = createOpenRouterDriver({
    getKey: () => KEY,
    endpointFor: (_id, capability) => ENDPOINTS[capability],
    fetch: impl,
    services,
  })
  return { driver, calls, services }
}

const mediaJob = (input: unknown, providerJobId?: string): Job => ({
  ...job(input),
  modelId: 'openrouter/media',
  kind: 'image',
  ...(providerJobId === undefined ? {} : { providerJobId }),
})

describe('createOpenRouterDriver：圖片', () => {
  it('文生圖：用 modalities 與 aspect_ratio 送出，解出 data URL、存進素材庫、回報花費', async () => {
    const { driver, calls, services } = makeMedia(imageCompletion(dataUrl(PNG)))
    const result = await driver.submit(
      mediaJob({ capability: 't2i', modelId: 'm', prompt: '夜晚的街角', aspectRatio: '16:9' }),
      { signal },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(calls[0]?.body).toMatchObject({
      model: 'google/gemini-3-pro-image',
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '16:9' },
      messages: [{ role: 'user', content: '夜晚的街角' }],
    })
    expect(result).toMatchObject({ status: 'done', costUsd: 0.134 })
    const assets = (result as { output: { assets: { hash: string; mime: string }[] } }).output
      .assets
    expect(assets).toHaveLength(1)
    expect(assets[0]?.mime).toBe('image/png')
    expect(services.files.get(assets[0]?.hash ?? '')).toEqual(PNG)
  })

  it('改圖：參考圖以 data URI 跟在文字後面；多張各送一次，花費加總、seed 錯開', async () => {
    const { driver, calls, services } = makeMedia(
      imageCompletion(dataUrl(PNG), 0.1),
      imageCompletion(dataUrl(Uint8Array.from([0x89, 0x50, 9, 9])), 0.2),
    )
    const ref = await services.assets.put(PNG, 'image/png')
    const result = await driver.submit(
      mediaJob({
        capability: 'edit',
        modelId: 'm',
        prompt: '換成雨天',
        referenceAssets: [ref.hash],
        count: 2,
        seed: 10,
      }),
      { signal },
    )
    const content = (calls[0]?.body?.messages as { content: unknown }[])[0]?.content
    expect(content).toEqual([
      { type: 'text', text: '換成雨天' },
      { type: 'image_url', image_url: { url: dataUrl(PNG) } },
    ])
    expect(calls.map((c) => c.body?.seed).sort()).toEqual([10, 11])
    expect(result).toMatchObject({ status: 'done' })
    expect((result as { costUsd: number }).costUsd).toBeCloseTo(0.3)
    expect((result as { output: { assets: unknown[] } }).output.assets).toHaveLength(2)
  })

  it('回應沒有圖片（被過濾）：不可重試的錯誤；Key 沒填、HTTP 200 夾帶錯誤也整理成白話', async () => {
    const empty = makeMedia(json({ choices: [{ message: { content: '抱歉' } }] }))
    expect(
      await failure(
        empty.driver.submit(
          mediaJob({ capability: 't2i', modelId: 'm', prompt: 'p', aspectRatio: '1:1' }),
          { signal },
        ),
      ),
    ).toMatchObject({ code: 'provider_rejected', retryable: false })

    const inline = makeMedia(json({ error: { code: 402, message: 'no credits' } }))
    expect(
      await failure(
        inline.driver.submit(
          mediaJob({ capability: 't2i', modelId: 'm', prompt: 'p', aspectRatio: '1:1' }),
          { signal },
        ),
      ),
    ).toMatchObject({ code: 'provider_insufficient_funds' })
  })
})

const imagesResponse = (bytes: Uint8Array, cost = 0.042) =>
  json({ data: [{ b64_json: Buffer.from(bytes).toString('base64') }], usage: { cost } })

/** gpt-image 這類走 POST /images 的模型：模型卡的 imageApi 決定品質檔位。 */
function makeImagesApi(...responses: (Response | Error | ((call: Call) => Response))[]) {
  const { impl, calls } = fakeFetch(...responses)
  const services = memoryServices()
  const driver = createOpenRouterDriver({
    getKey: () => KEY,
    endpointFor: () => 'openai/gpt-image-2',
    imageApiFor: (modelId) =>
      modelId === 'openrouter/gpt-image-2-high' ? { quality: 'high' } : { quality: 'medium' },
    fetch: impl,
    services,
  })
  return { driver, calls, services }
}

describe('createOpenRouterDriver：圖片走 POST /images（gpt-image）', () => {
  it('文生圖：送到 /images，欄位照實測的格式；不走 chat/completions、不送 modalities 與 seed', async () => {
    const { driver, calls, services } = makeImagesApi(imagesResponse(PNG))
    const result = await driver.submit(
      mediaJob({
        capability: 't2i',
        modelId: 'openrouter/gpt-image-2',
        prompt: '夜晚的街角',
        aspectRatio: '16:9',
        seed: 5,
      }),
      { signal },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/images')
    expect(calls[0]?.body).toEqual({
      model: 'openai/gpt-image-2',
      prompt: '夜晚的街角',
      aspect_ratio: '16:9',
      quality: 'medium',
      output_format: 'png',
      n: 1,
    })
    expect(result).toMatchObject({ status: 'done', costUsd: 0.042 })
    const assets = (result as { output: { assets: { hash: string; mime: string }[] } }).output
      .assets
    expect(assets).toHaveLength(1)
    expect(assets[0]?.mime).toBe('image/png')
    expect(services.files.get(assets[0]?.hash ?? '')).toEqual(PNG)
  })

  it('高畫質那張卡送 quality: high', async () => {
    const { driver, calls } = makeImagesApi(imagesResponse(PNG, 0.145))
    const result = await driver.submit(
      mediaJob({
        capability: 't2i',
        modelId: 'openrouter/gpt-image-2-high',
        prompt: 'p',
        aspectRatio: '1:1',
      }),
      { signal },
    )
    expect(calls[0]?.body).toMatchObject({ quality: 'high', aspect_ratio: '1:1' })
    expect(result).toMatchObject({ costUsd: 0.145 })
  })

  it('改圖：參考圖放 input_references（data URI）；多張各送一次、n 都是 1，花費加總', async () => {
    const { driver, calls, services } = makeImagesApi(
      imagesResponse(PNG, 0.1),
      imagesResponse(Uint8Array.from([0x89, 0x50, 9, 9]), 0.2),
    )
    const ref = await services.assets.put(PNG, 'image/png')
    const result = await driver.submit(
      mediaJob({
        capability: 'edit',
        modelId: 'openrouter/gpt-image-2',
        prompt: '換成雨天',
        referenceAssets: [ref.hash],
        count: 2,
      }),
      { signal },
    )
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.url).toBe('https://openrouter.ai/api/v1/images')
      expect(call.body).toMatchObject({
        n: 1,
        input_references: [{ type: 'image_url', image_url: { url: dataUrl(PNG) } }],
      })
    }
    expect((result as { costUsd: number }).costUsd).toBeCloseTo(0.3)
    expect((result as { output: { assets: unknown[] } }).output.assets).toHaveLength(2)
  })

  it('模型卡沒有 imageApi（例如 Gemini）仍走 chat/completions', async () => {
    const { impl, calls } = fakeFetch(imageCompletion(dataUrl(PNG)))
    const driver = createOpenRouterDriver({
      getKey: () => KEY,
      endpointFor: () => 'google/gemini-3-pro-image',
      imageApiFor: () => undefined,
      fetch: impl,
      services: memoryServices(),
    })
    await driver.submit(
      mediaJob({ capability: 't2i', modelId: 'm', prompt: 'p', aspectRatio: '16:9' }),
      { signal },
    )
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('回應沒有圖（被過濾）、格式不對、HTTP 200 夾帶錯誤、HTTP 錯誤：都整理成白話的型別化錯誤', async () => {
    const input = mediaJob({
      capability: 't2i',
      modelId: 'openrouter/gpt-image-2',
      prompt: 'p',
      aspectRatio: '16:9',
    })
    const attempt = (response: Response) =>
      failure(makeImagesApi(response).driver.submit(input, { signal }))

    expect(await attempt(json({ data: [] }))).toMatchObject({
      code: 'provider_rejected',
      retryable: false,
    })
    expect(await attempt(json({ data: [{}] }))).toMatchObject({ code: 'provider_rejected' })
    expect(await attempt(json({ images: 'x' }))).toMatchObject({
      code: 'invalid_response',
      retryable: true,
    })
    expect(await attempt(json({ error: { code: 402, message: 'no credits' } }))).toMatchObject({
      code: 'provider_insufficient_funds',
    })
    expect(await attempt(json({ error: { message: 'boom' } }, { status: 500 }))).toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    })
    // 模型被內容規則擋下常是 400：給白話提示，供應商原文只留在 cause
    const rejected = await attempt(
      json({ error: { message: 'moderation_blocked' } }, { status: 400 }),
    )
    expect(rejected).toMatchObject({ code: 'provider_rejected' })
    expect(rejected.userMessage).not.toContain('moderation_blocked')
  })

  it('供應商只給網址時也能下載；Key 沒填在送出前就回報', async () => {
    const { driver, calls } = makeImagesApi(
      json({ data: [{ url: 'https://cdn.example/a.png' }], usage: { cost: 0.042 } }),
      () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
    )
    const result = await driver.submit(
      mediaJob({
        capability: 't2i',
        modelId: 'openrouter/gpt-image-2',
        prompt: 'p',
        aspectRatio: '16:9',
      }),
      { signal },
    )
    expect(calls[1]?.url).toBe('https://cdn.example/a.png')
    expect(result).toMatchObject({ status: 'done' })

    const noKey = createOpenRouterDriver({
      getKey: () => undefined,
      endpointFor: () => 'openai/gpt-image-2',
      imageApiFor: () => ({ quality: 'medium' }),
      fetch: vi.fn(),
      services: memoryServices(),
    })
    expect(
      await failure(
        noKey.submit(
          mediaJob({ capability: 't2i', modelId: 'm', prompt: 'p', aspectRatio: '16:9' }),
          { signal },
        ),
      ),
    ).toMatchObject({ code: 'provider_auth_failed' })
  })
})

const t2vInput = {
  capability: 't2v',
  modelId: 'm',
  prompt: '貓走過雨夜',
  durationSec: 5,
  aspectRatio: '9:16',
  audio: true,
}

describe('createOpenRouterDriver：寬鬆解析（還沒用真金鑰驗證的格式）', () => {
  it('圖片網址在其他常見位置也找得到：content 陣列、url 直接放在項目上、文字裡夾 data URL', async () => {
    const variants = [
      { content: [{ type: 'image_url', image_url: { url: dataUrl(PNG) } }] },
      { images: [{ url: dataUrl(PNG) }] },
      { content: `好的 ${dataUrl(PNG)} 完成` },
    ]
    for (const message of variants) {
      const { driver, services } = makeMedia(json({ choices: [{ message }] }))
      const result = await driver.submit(
        mediaJob({ capability: 't2i', modelId: 'm', prompt: 'p', aspectRatio: '1:1' }),
        { signal },
      )
      const hash = (result as { output: { assets: { hash: string }[] } }).output.assets[0]?.hash
      expect(services.files.get(hash ?? '')).toEqual(PNG)
    }
  })

  it('影片狀態：不認得的字串當成還在進行；success／succeeded 算完成；帶 error 或失敗類字串算失敗', async () => {
    const { driver } = makeMedia(
      json({ status: 'queued' }),
      json({ status: 'processing' }),
      json({ status: 'queued', error: { message: 'bad prompt', code: 400 } }),
      json({ status: 'canceled' }),
      json({ status: 'completed' }),
      new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    )
    const j = mediaJob(t2vInput, 'vid_1')
    expect(await driver.poll(j, { signal })).toEqual({ status: 'pending' })
    expect(await driver.poll(j, { signal })).toEqual({ status: 'pending' })
    const withError = await driver.poll(j, { signal })
    expect(withError).toMatchObject({ status: 'failed' })
    expect(JSON.stringify(withError)).not.toContain('bad prompt')
    expect(await driver.poll(j, { signal })).toMatchObject({ status: 'failed' })
    expect(await driver.poll(j, { signal })).toMatchObject({ status: 'done' })
  })

  it('送出影片被 400 拒絕：給白話提示（可能不支援首尾幀或參考圖），原始內容只在 cause', async () => {
    const { driver } = makeMedia(
      new Response('{"error":"unknown field frame_images"}', { status: 400 }),
    )
    const error = await failure(driver.submit(mediaJob(t2vInput), { signal }))
    expect(error).toMatchObject({ code: 'provider_rejected', retryable: false })
    expect(error.userMessage).toContain('換一個影片模型')
    expect(error.userMessage).not.toContain('frame_images')
  })
})

describe('createOpenRouterDriver：影片', () => {
  const t2v = {
    capability: 't2v',
    modelId: 'm',
    prompt: '貓走過雨夜',
    durationSec: 5,
    aspectRatio: '9:16',
    audio: true,
    seed: 3,
  }

  it('文生影片：POST /videos，回傳工作編號', async () => {
    const { driver, calls } = makeMedia(
      json({ id: 'vid_1', polling_url: 'https://x/y', status: 'pending' }, { status: 202 }),
    )
    expect(await driver.submit(mediaJob(t2v), { signal })).toEqual({
      status: 'submitted',
      providerJobId: 'vid_1',
    })
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/videos')
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.body).toEqual({
      model: 'google/veo-3.1-lite',
      prompt: '貓走過雨夜',
      duration: 5,
      aspect_ratio: '9:16',
      generate_audio: true,
      seed: 3,
    })
  })

  it('Veo 3.1 Lite 只收 4、6、8 秒：送 5 秒會被 400 擋下（2026-10-18 實測）；驅動不偷改秒數，給白話提示，原始訊息只在 cause', async () => {
    const { driver, calls } = makeMedia(
      new Response(
        '{"error":{"message":"Duration 5s is not supported for this model. Supported durations: 4, 6, 8s","code":400}}',
        { status: 400 },
      ),
    )
    const error = await failure(driver.submit(mediaJob({ ...t2v, audio: false }), { signal }))
    // 請求照使用者要的秒數原樣送出，由供應商決定要不要收
    expect(calls[0]?.body?.duration).toBe(5)
    expect(error).toMatchObject({ code: 'provider_rejected', retryable: false })
    expect(error.userMessage).toContain('換一個影片模型')
    expect(error.userMessage).not.toContain('Supported durations')
  })

  it('圖生影片：首幀、尾幀放進 frame_images；參考生影片：放進 input_references', async () => {
    const { driver, calls, services } = makeMedia(json({ id: 'a' }), json({ id: 'b' }))
    const first = await services.assets.put(PNG, 'image/png')
    const last = await services.assets.put(Uint8Array.from([0xff, 0xd8, 1]), 'image/jpeg')
    await driver.submit(
      mediaJob({
        ...t2v,
        capability: 'i2v',
        startFrameAsset: first.hash,
        endFrameAsset: last.hash,
      }),
      { signal },
    )
    expect(calls[0]?.body?.frame_images).toEqual([
      { type: 'image_url', image_url: { url: dataUrl(PNG) }, frame_type: 'first_frame' },
      {
        type: 'image_url',
        image_url: { url: dataUrl(Uint8Array.from([0xff, 0xd8, 1]), 'image/jpeg') },
        frame_type: 'last_frame',
      },
    ])
    await driver.submit(mediaJob({ ...t2v, capability: 'r2v', referenceAssets: [first.hash] }), {
      signal,
    })
    expect(calls[1]?.body?.model).toBe('kwaivgi/kling-v3.0-std')
    expect(calls[1]?.body?.input_references).toEqual([
      { type: 'image_url', image_url: { url: dataUrl(PNG) } },
    ])
  })

  it('圖生影片沒有起始畫面：直接回報請求不完整，不會送出', async () => {
    const { driver, calls } = makeMedia()
    expect(
      await failure(driver.submit(mediaJob({ ...t2v, capability: 'i2v' }), { signal })),
    ).toMatchObject({ code: 'invalid_request' })
    expect(calls).toHaveLength(0)
  })

  it('輪詢：排隊與生成中都是 pending；完成就帶 Key 下載、存進素材庫並回報花費', async () => {
    const { driver, calls, services } = makeMedia(
      json({ status: 'pending' }),
      json({ status: 'in_progress' }),
      json({
        status: 'completed',
        generation_id: 'gen_1',
        unsigned_urls: ['https://openrouter.ai/api/v1/videos/vid_1/content?index=0'],
        usage: { cost: 0.25, is_byok: false },
      }),
      new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    )
    const j = mediaJob(t2v, 'vid_1')
    expect(await driver.poll(j, { signal })).toEqual({ status: 'pending' })
    expect(await driver.poll(j, { signal })).toEqual({ status: 'pending' })
    const done = await driver.poll(j, { signal })
    expect(done).toMatchObject({ status: 'done', costUsd: 0.25 })
    const asset = (
      done as { output: { assets: { hash: string; mime: string; durationSec: number }[] } }
    ).output.assets[0]
    expect(asset).toMatchObject({ mime: 'video/mp4', durationSec: 5 })
    expect(services.files.get(asset?.hash ?? '')).toEqual(MP4)
    expect(calls.map((c) => c.url)).toEqual([
      'https://openrouter.ai/api/v1/videos/vid_1',
      'https://openrouter.ai/api/v1/videos/vid_1',
      'https://openrouter.ai/api/v1/videos/vid_1',
      'https://openrouter.ai/api/v1/videos/vid_1/content?index=0',
    ])
    // 下載要帶 Key（網址沒有預先簽名）
    expect(new Headers(calls[3]?.init.headers).get('authorization')).toBe(`Bearer ${KEY}`)
  })

  it('失敗、取消、過期：回報任務失敗，原因只放 cause、不給使用者看原文', async () => {
    const { driver } = makeMedia(
      json({ status: 'failed', error: 'content policy violation' }),
      json({ status: 'expired' }),
    )
    const j = mediaJob(t2v, 'vid_1')
    const failed = await driver.poll(j, { signal })
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'provider_rejected' } })
    expect(JSON.stringify(failed)).not.toContain('content policy')
    expect(await driver.poll(j, { signal })).toMatchObject({ status: 'failed' })
  })

  it('輪詢遇到暫時性錯誤（5xx）就丟出去，下次再問；影片太大回報失敗；缺工作編號是內部錯誤', async () => {
    const flaky = makeMedia(new Response('boom', { status: 503 }))
    expect(await failure(flaky.driver.poll(mediaJob(t2v, 'vid_1'), { signal }))).toMatchObject({
      retryable: true,
    })

    const big = makeMedia(
      json({ status: 'completed' }),
      new Response(MP4, {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': String(600 * 1024 * 1024) },
      }),
    )
    expect(await big.driver.poll(mediaJob(t2v, 'vid_1'), { signal })).toMatchObject({
      status: 'failed',
    })

    expect(await failure(big.driver.poll(mediaJob(t2v), { signal }))).toMatchObject({
      code: 'internal_error',
    })
  })
})

describe('parseRetryAfter', () => {
  it('秒數、HTTP 日期、看不懂', () => {
    expect(parseRetryAfter('2')).toBe(2000)
    expect(parseRetryAfter('0.5')).toBe(500)
    expect(
      parseRetryAfter('Mon, 12 Oct 2026 08:00:10 GMT', () => Date.parse('2026-10-12T08:00:00Z')),
    ).toBe(10_000)
    expect(
      parseRetryAfter('Mon, 12 Oct 2026 07:00:00 GMT', () => Date.parse('2026-10-12T08:00:00Z')),
    ).toBe(0)
    expect(parseRetryAfter('soon')).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
  })
})
