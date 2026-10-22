import { isAppError, type AppError, type Job } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import type { FetchLike } from '../http/fetch'
import { memoryServices } from '../mock/test-services'
import { FalClient, falAppId } from './client'
import { createFalDriver } from './driver'

const KEY = 'fal-SUPERSECRETKEY:abc'
const signal = new AbortController().signal

interface Call {
  url: string
  init: RequestInit
  body?: Record<string, unknown>
}

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = []
  const impl: FetchLike = (url, init) => {
    calls.push({
      url,
      init,
      ...(typeof init.body === 'string'
        ? { body: JSON.parse(init.body) as Record<string, unknown> }
        : {}),
    })
    const next = responses.shift()
    if (next === undefined) return Promise.reject(new Error('沒有預備的回應'))
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next)
  }
  return { impl, calls }
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

const file = (bytes: Uint8Array, type: string, init: ResponseInit = {}): Response =>
  new Response(bytes, { status: 200, headers: { 'content-type': type }, ...init })

const failure = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise
  } catch (error) {
    if (isAppError(error)) return error
    throw error
  }
  throw new Error('應該丟錯')
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])

const ENDPOINTS: Record<string, string> = {
  t2i: 'fal-ai/nano-banana-2',
  edit: 'fal-ai/nano-banana-2/edit',
  t2v: 'fal-ai/kling-video/v3/pro/text-to-video',
  i2v: 'fal-ai/kling-video/v3/pro/image-to-video',
}

const makeDriver = (impl: FetchLike, services = memoryServices()) => ({
  services,
  driver: createFalDriver({
    getKey: () => KEY,
    endpointFor: (_modelId, capability) => ENDPOINTS[capability],
    fetch: impl,
    services,
  }),
})

const job = (input: unknown, extra: Partial<Job> = {}): Job => ({
  id: 'j1',
  provider: 'fal',
  modelId: 'fal/x',
  kind: 'image',
  status: 'running',
  attempt: 1,
  maxAttempts: 3,
  input,
  createdAt: '2026-10-12T08:00:00.000Z',
  updatedAt: '2026-10-12T08:00:00.000Z',
  ...extra,
})

const t2i = { capability: 't2i', modelId: 'fal/nano-banana-2', prompt: 'a cat', count: 2 }

describe('falAppId', () => {
  it('只取前兩段（查狀態、取結果不帶子路徑）', () => {
    expect(falAppId('fal-ai/nano-banana-2/edit')).toBe('fal-ai/nano-banana-2')
    expect(falAppId('fal-ai/kling-video/v3/pro/image-to-video')).toBe('fal-ai/kling-video')
  })
})

describe('FalClient', () => {
  it('submit：POST 到完整端點，用 Key 授權，回傳 request id', async () => {
    const { impl, calls } = fakeFetch(json({ request_id: 'r-1' }))
    const client = new FalClient({ getKey: () => KEY, fetch: impl })
    expect(await client.submit('fal-ai/nano-banana-2/edit', { prompt: 'x' }, signal)).toBe('r-1')
    expect(calls[0]?.url).toBe('https://queue.fal.run/fal-ai/nano-banana-2/edit')
    expect(calls[0]?.init.method).toBe('POST')
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(`Key ${KEY}`)
    expect(calls[0]?.body).toEqual({ prompt: 'x' })
  })

  it('沒有 Key → 提示到設定頁填入（不可重試）', async () => {
    const { impl, calls } = fakeFetch()
    const client = new FalClient({ getKey: () => undefined, fetch: impl })
    const error = await failure(client.submit('fal-ai/x', {}, signal))
    expect(error).toMatchObject({ code: 'provider_auth_failed', retryable: false })
    expect(calls).toHaveLength(0)
  })

  it('submit 回傳格式不對 → 可重試的 invalid_response', async () => {
    const { impl } = fakeFetch(json({ nope: true }))
    const client = new FalClient({ getKey: () => KEY, fetch: impl })
    expect(await failure(client.submit('fal-ai/x', {}, signal))).toMatchObject({
      code: 'invalid_response',
      retryable: true,
    })
  })

  it('status：IN_QUEUE / IN_PROGRESS 都是等待中；COMPLETED 帶 error 視為失敗', async () => {
    const { impl, calls } = fakeFetch(
      json({ status: 'IN_QUEUE' }),
      json({ status: 'IN_PROGRESS' }),
      json({ status: 'COMPLETED' }),
      json({ status: 'COMPLETED', error: { type: 'x' } }),
    )
    const client = new FalClient({ getKey: () => KEY, fetch: impl })
    const ask = () => client.status('fal-ai/kling-video/v3/pro/image-to-video', 'r 1', signal)
    expect(await ask()).toEqual({ state: 'pending' })
    expect(await ask()).toEqual({ state: 'pending' })
    expect(await ask()).toEqual({ state: 'completed' })
    expect(await ask()).toEqual({ state: 'completed', failure: '{"type":"x"}' })
    expect(calls[0]?.url).toBe('https://queue.fal.run/fal-ai/kling-video/requests/r%201/status')
  })

  it('status 格式不對 → 可重試的 invalid_response', async () => {
    const { impl } = fakeFetch(json({ status: 'WAT' }))
    const client = new FalClient({ getKey: () => KEY, fetch: impl })
    expect(await failure(client.status('fal-ai/x', 'r', signal))).toMatchObject({
      code: 'invalid_response',
      retryable: true,
    })
  })

  it('cancel：PUT cancel；fal 說不能取消（400）就當作已經在跑，不丟錯', async () => {
    const { impl, calls } = fakeFetch(json({}), json({}, { status: 400 }))
    const client = new FalClient({ getKey: () => KEY, fetch: impl })
    await client.cancel('fal-ai/x/edit', 'r', signal)
    await client.cancel('fal-ai/x/edit', 'r', signal)
    expect(calls[0]?.init.method).toBe('PUT')
    expect(calls[0]?.url).toBe('https://queue.fal.run/fal-ai/x/requests/r/cancel')
  })

  it('cancel 遇到 401 照樣丟錯', async () => {
    const { impl } = fakeFetch(json({}, { status: 401 }))
    const client = new FalClient({ getKey: () => KEY, fetch: impl })
    expect(await failure(client.cancel('fal-ai/x', 'r', signal))).toMatchObject({
      code: 'provider_auth_failed',
    })
  })

  it('testKey：401 → 無效；404 → 有效；網路錯誤照丟', async () => {
    const { impl } = fakeFetch(
      json({}, { status: 401 }),
      json({}, { status: 404 }),
      json({}, { status: 503 }),
    )
    const client = new FalClient({ getKey: () => KEY, fetch: impl })
    expect(await client.testKey('fal-ai/x', signal)).toBe(false)
    expect(await client.testKey('fal-ai/x', signal)).toBe(true)
    expect(await failure(client.testKey('fal-ai/x', signal))).toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    })
  })

  it('download：檔案太大（宣告或實際）就拒絕', async () => {
    const { impl } = fakeFetch(
      file(PNG, 'image/png', { headers: { 'content-length': '999999' } }),
      file(PNG, 'image/png'),
    )
    const client = new FalClient({ getKey: () => KEY, fetch: impl })
    expect(await failure(client.download('https://x/a.png', signal, 100))).toMatchObject({
      code: 'provider_rejected',
    })
    expect(await failure(client.download('https://x/a.png', signal, 3))).toMatchObject({
      code: 'provider_rejected',
    })
  })

  it('下載不帶 Key，且會取出 content-type', async () => {
    const { impl, calls } = fakeFetch(file(PNG, 'image/png; charset=binary'))
    const client = new FalClient({ getKey: () => KEY, fetch: impl })
    const result = await client.download('https://cdn.fal.media/a.png', signal, 1000)
    expect(result.mime).toBe('image/png')
    expect(JSON.stringify(calls[0]?.init.headers ?? {})).not.toContain('Key')
  })
})

describe('createFalDriver', () => {
  it('submit t2i：送出圖片參數，回傳 submitted', async () => {
    const { impl, calls } = fakeFetch(json({ request_id: 'r-1' }))
    const { driver } = makeDriver(impl)
    const result = await driver.submit(job({ ...t2i, seed: 7 }), { signal })
    expect(result).toEqual({ status: 'submitted', providerJobId: 'r-1' })
    expect(calls[0]?.url).toBe('https://queue.fal.run/fal-ai/nano-banana-2')
    expect(calls[0]?.body).toEqual({
      prompt: 'a cat',
      aspect_ratio: '16:9',
      num_images: 2,
      output_format: 'png',
      seed: 7,
    })
  })

  it('submit edit：參考圖轉成 data URI（依檔頭判斷格式）', async () => {
    const { impl, calls } = fakeFetch(json({ request_id: 'r-2' }))
    const { driver, services } = makeDriver(impl)
    const ref = await services.assets.put(PNG, 'image/png')
    await driver.submit(
      job({
        capability: 'edit',
        modelId: 'fal/nano-banana-2',
        prompt: 'x',
        referenceAssets: [ref.hash],
      }),
      { signal },
    )
    expect(calls[0]?.url).toBe('https://queue.fal.run/fal-ai/nano-banana-2/edit')
    const urls = calls[0]?.body?.image_urls as string[]
    expect(urls[0]).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
  })

  it('submit i2v：首幀、尾幀、秒數（字串）、音訊', async () => {
    const { impl, calls } = fakeFetch(json({ request_id: 'r-3' }))
    const { driver, services } = makeDriver(impl)
    const start = await services.assets.put(PNG, 'image/png')
    const end = await services.assets.put(Uint8Array.from([0xff, 0xd8, 9]), 'image/jpeg')
    await driver.submit(
      job({
        capability: 'i2v',
        modelId: 'fal/kling-3.0-pro',
        prompt: 'walk',
        durationSec: 4.6,
        audio: true,
        startFrameAsset: start.hash,
        endFrameAsset: end.hash,
      }),
      { signal },
    )
    expect(calls[0]?.url).toContain('image-to-video')
    expect(calls[0]?.body).toMatchObject({
      duration: '5',
      generate_audio: true,
      aspect_ratio: '16:9',
    })
    expect(calls[0]?.body).toHaveProperty('start_image_url')
    expect(calls[0]?.body).not.toHaveProperty('image_url')
    expect(String(calls[0]?.body?.end_image_url)).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('submit i2v：模型原生的運鏡參數併進請求', async () => {
    const { impl, calls } = fakeFetch(json({ request_id: 'r-3b' }))
    const { driver, services } = makeDriver(impl)
    const start = await services.assets.put(PNG, 'image/png')
    await driver.submit(
      job({
        capability: 'i2v',
        modelId: 'fal/kling-3.0-pro',
        prompt: 'walk',
        durationSec: 5,
        startFrameAsset: start.hash,
        cameraMove: 'orbit',
        cameraParams: { camera_control: { type: 'orbit' } },
      }),
      { signal },
    )
    expect(calls[0]?.body).toMatchObject({ camera_control: { type: 'orbit' } })
    // 預設清單的 ID 只是紀錄，不會直接當成供應商欄位送出
    expect(calls[0]?.body).not.toHaveProperty('cameraMove')
  })

  it('submit i2v／t2v：負面提示放進 negative_prompt；沒有就不送這個欄位', async () => {
    const { impl, calls } = fakeFetch(
      json({ request_id: 'n-1' }),
      json({ request_id: 'n-2' }),
      json({ request_id: 'n-3' }),
    )
    const { driver, services } = makeDriver(impl)
    const start = await services.assets.put(PNG, 'image/png')
    const base = { modelId: 'fal/kling-3.0-pro', prompt: 'walk', durationSec: 5 }
    await driver.submit(
      job({
        ...base,
        capability: 'i2v',
        startFrameAsset: start.hash,
        negativePrompt: 'mouth, arms',
      }),
      { signal },
    )
    expect(calls[0]?.body).toMatchObject({ negative_prompt: 'mouth, arms' })
    await driver.submit(job({ ...base, capability: 't2v', negativePrompt: 'blur' }), { signal })
    expect(calls[1]?.body).toMatchObject({ negative_prompt: 'blur' })
    await driver.submit(job({ ...base, capability: 'i2v', startFrameAsset: start.hash }), {
      signal,
    })
    expect(calls[2]?.body).not.toHaveProperty('negative_prompt')
  })

  it('submit i2v 沒有起始畫面 → invalid_request；t2v 不需要', async () => {
    const { impl, calls } = fakeFetch(json({ request_id: 'r-4' }))
    const { driver } = makeDriver(impl)
    const base = { modelId: 'fal/kling-3.0-pro', prompt: 'p', durationSec: 5 }
    expect(
      await failure(driver.submit(job({ ...base, capability: 'i2v' }), { signal })),
    ).toMatchObject({ code: 'invalid_request' })
    await driver.submit(job({ ...base, capability: 't2v' }), { signal })
    expect(calls[0]?.body).toMatchObject({ prompt: 'p', duration: '5', generate_audio: false })
  })

  it('不是圖片或影片的請求、找不到端點都會被拒絕', async () => {
    const { impl } = fakeFetch()
    const { driver } = makeDriver(impl)
    const llm = { capability: 'llm', modelId: 'm', messages: [{ role: 'user', content: 'x' }] }
    expect(await failure(driver.submit(job(llm), { signal }))).toMatchObject({
      code: 'provider_rejected',
    })
    const r2v = { capability: 'r2v', modelId: 'm', prompt: 'p', durationSec: 5 }
    expect(await failure(driver.submit(job(r2v), { signal }))).toMatchObject({
      code: 'invalid_request',
    })
  })

  it('poll：等待中 → pending', async () => {
    const { impl } = fakeFetch(json({ status: 'IN_PROGRESS' }))
    const { driver } = makeDriver(impl)
    expect(await driver.poll(job(t2i, { providerJobId: 'r-1' }), { signal })).toEqual({
      status: 'pending',
    })
  })

  it('poll：完成後下載圖片、存進素材庫，輸出 assets', async () => {
    const { impl, calls } = fakeFetch(
      json({ status: 'COMPLETED' }),
      json({
        images: [
          {
            url: 'https://cdn.fal.media/a.png',
            content_type: 'image/png',
            width: 1024,
            height: 576,
          },
          { url: 'https://cdn.fal.media/b.png' },
        ],
      }),
      file(PNG, 'image/png'),
      file(Uint8Array.from([0x89, 0x50, 9, 9]), 'image/png'),
    )
    const { driver, services } = makeDriver(impl)
    const result = await driver.poll(job(t2i, { providerJobId: 'r-1' }), { signal })
    expect(result.status).toBe('done')
    if (result.status !== 'done') return
    const output = result.output as { kind: string; assets: { hash: string; width?: number }[] }
    expect(output.kind).toBe('assets')
    expect(output.assets).toHaveLength(2)
    expect(output.assets[0]).toMatchObject({ kind: 'image', mime: 'image/png', width: 1024 })
    expect(services.files.has(output.assets[0]?.hash ?? '')).toBe(true)
    expect(calls[1]?.url).toBe('https://queue.fal.run/fal-ai/nano-banana-2/requests/r-1')
  })

  it('poll：影片結果記下秒數與 mp4', async () => {
    const { impl } = fakeFetch(
      json({ status: 'COMPLETED' }),
      json({ video: { url: 'https://cdn.fal.media/v.mp4' } }),
      file(MP4, 'video/mp4'),
    )
    const { driver } = makeDriver(impl)
    const input = { capability: 't2v', modelId: 'fal/kling-3.0-pro', prompt: 'p', durationSec: 5 }
    const result = await driver.poll(job(input, { providerJobId: 'r-9', kind: 'video' }), {
      signal,
    })
    expect(result).toMatchObject({
      status: 'done',
      output: { assets: [{ kind: 'video', mime: 'video/mp4', durationSec: 5 }] },
    })
  })

  it('poll：完成但沒有任何檔案（內容被過濾）→ 任務失敗，不可重試', async () => {
    const { impl } = fakeFetch(json({ status: 'COMPLETED' }), json({ images: [] }))
    const { driver } = makeDriver(impl)
    const result = await driver.poll(job(t2i, { providerJobId: 'r-1' }), { signal })
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'provider_rejected', retryable: false },
    })
  })

  it('poll：fal 回報任務失敗（COMPLETED 帶 error）→ failed，且不洩漏原始訊息', async () => {
    const { impl } = fakeFetch(json({ status: 'COMPLETED', error: `boom ${KEY}` }))
    const { driver } = makeDriver(impl)
    const result = await driver.poll(job(t2i, { providerJobId: 'r-1' }), { signal })
    expect(result.status).toBe('failed')
    expect(JSON.stringify(result)).not.toContain('SUPERSECRET')
  })

  it('poll：取結果遇到 422 → failed；遇到 503 → 丟出可重試錯誤（任務不會重送）', async () => {
    const { impl } = fakeFetch(
      json({ status: 'COMPLETED' }),
      json({ detail: 'bad' }, { status: 422 }),
      json({ status: 'COMPLETED' }),
      json({}, { status: 503 }),
    )
    const { driver } = makeDriver(impl)
    const j = job(t2i, { providerJobId: 'r-1' })
    expect(await driver.poll(j, { signal })).toMatchObject({
      status: 'failed',
      error: { code: 'provider_rejected' },
    })
    expect(await failure(driver.poll(j, { signal }))).toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    })
  })

  it('poll：沒有 providerJobId → internal_error', async () => {
    const { impl } = fakeFetch()
    const { driver } = makeDriver(impl)
    expect(await failure(driver.poll(job(t2i), { signal }))).toMatchObject({
      code: 'internal_error',
    })
  })

  it('cancel：沒有遠端編號就什麼都不做；有編號就呼叫 cancel', async () => {
    const { impl, calls } = fakeFetch(json({}))
    const { driver } = makeDriver(impl)
    await driver.cancel(job(t2i))
    expect(calls).toHaveLength(0)
    await driver.cancel(job(t2i, { providerJobId: 'r-1' }))
    expect(calls[0]?.url).toBe('https://queue.fal.run/fal-ai/nano-banana-2/requests/r-1/cancel')
  })

  it('testKey 走 t2i 端點', async () => {
    const { impl } = fakeFetch(json({}, { status: 404 }))
    const { driver } = makeDriver(impl)
    expect(await driver.testKey(signal)).toBe(true)
  })
})
