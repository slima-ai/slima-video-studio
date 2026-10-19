import { createProject } from '@svs/db'
import { probe, resolveTools } from '@svs/media'
import type { JobQueue } from '@svs/engine'
import { createMockDriver } from '@svs/providers'
import { GenerationOutputSchema } from '@svs/schema'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createProjectJobQueue } from './job-queue'
import { createMockVideoRenderer } from './mock-video'
import { createProviderServices } from './provider-services'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const open = () => {
  const root = mkdtempSync(join(tmpdir(), 'svs-mock-'))
  dirs.push(root)
  return createProject({ dir: join(root, '示範.svsproj'), name: '示範' }, { appVersion: 'test' })
}

const imageRequest = { capability: 't2i', modelId: 'mock/image', prompt: 'a cat', seed: 1 }

describe('示範供應商 + 任務佇列 + 真的 SQLite 與素材庫', () => {
  it('429 退避重試後成功，圖片存進專案素材庫', async () => {
    const handle = open()
    const driver = createMockDriver(createProviderServices(handle), {
      rateLimitOnCalls: [1],
      retryAfterMs: 20,
    })
    const queue: JobQueue = createProjectJobQueue(handle, { drivers: { mock: driver } })
    queue.start()
    const job = queue.enqueue({
      provider: 'mock',
      modelId: 'mock/image',
      kind: 'image',
      input: imageRequest,
    })
    const done = await queue.wait(job.id)
    queue.stop()

    expect(done).toMatchObject({ status: 'succeeded', attempt: 2 })
    const output = GenerationOutputSchema.parse(done.output)
    if (output.kind !== 'assets') throw new Error('應為素材')
    const asset = output.assets[0]
    expect(asset).toMatchObject({ kind: 'image', mime: 'image/png' })
    const found = handle.assets.find(asset?.hash ?? '')
    expect(found && statSync(found.path).size).toBe(asset?.bytes)
    expect(driver.submitCalls).toBe(2)
    handle.close()
  })

  it('長任務（配音）：submit → poll → 完成，結果是素材庫裡的 WAV', async () => {
    const handle = open()
    const driver = createMockDriver(createProviderServices(handle), { pollsBeforeDone: 1 })
    const queue = createProjectJobQueue(handle, {
      drivers: { mock: driver },
      defaultLimits: { pollIntervalMs: 10 },
    })
    queue.start()
    const job = queue.enqueue({
      provider: 'mock',
      modelId: 'mock/tts',
      kind: 'tts',
      input: { capability: 'tts', modelId: 'mock/tts', text: '你好，世界' },
    })
    const done = await queue.wait(job.id)
    queue.stop()
    expect(done.status).toBe('succeeded')
    expect(driver.pollCalls).toBe(2)
    const output = GenerationOutputSchema.parse(done.output)
    expect(output.kind === 'assets' && output.assets[0]?.mime).toBe('audio/wav')
    handle.close()
  })

  it('示範影片：圖生影片經由 FFmpeg 產出指定長度的 MP4，存進素材庫', async () => {
    const handle = open()
    const tools = resolveTools()
    const driver = createMockDriver(createProviderServices(handle), {
      pollsBeforeDone: 1,
      renderVideo: createMockVideoRenderer(tools),
    })
    const queue = createProjectJobQueue(handle, {
      drivers: { mock: driver },
      defaultLimits: { pollIntervalMs: 10 },
    })
    queue.start()
    const job = queue.enqueue({
      provider: 'mock',
      modelId: 'mock/video',
      kind: 'video',
      input: { capability: 'i2v', modelId: 'mock/video', prompt: 'walk', durationSec: 3 },
    })
    const done = await queue.wait(job.id)
    queue.stop()
    const output = GenerationOutputSchema.parse(done.output)
    if (output.kind !== 'assets') throw new Error('應為素材')
    const found = handle.assets.find(output.assets[0]?.hash ?? '')
    const info = await probe(tools, found?.path ?? '')
    expect(info.durationSec).toBeCloseTo(3, 0)
    expect(info).toMatchObject({ width: 640, height: 360, hasAudio: true })
    handle.close()
  })
})
