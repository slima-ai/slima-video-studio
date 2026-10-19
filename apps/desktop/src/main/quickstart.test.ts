import { createProject } from '@svs/db'
import { createRegistry } from '@svs/engine'
import { probe, resolveTools } from '@svs/media'
import { ModelRegistry, createMockDriver, loadBuiltinModelCards } from '@svs/providers'
import { AssetRefSchema } from '@svs/schema'
import {
  buildQuickStart,
  quickStartItemCounts,
  registerQuickStartNodes,
  STUDIO_SERVICE_KEY,
} from '@svs/workflows'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createProjectEngine } from './project-engine'
import { createProjectJobQueue } from './job-queue'
import { createMockVideoRenderer } from './mock-video'
import { createProviderServices } from './provider-services'
import { createStudioServices } from './studio-services'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const models = { llm: 'mock/llm', image: 'mock/image', video: 'mock/video' }

function setup(shots: number) {
  const root = mkdtempSync(join(tmpdir(), 'svs-qs-'))
  dirs.push(root)
  const handle = createProject(
    { dir: join(root, '貓.svsproj'), name: '貓' },
    { appVersion: 'test' },
  )
  const tools = resolveTools()
  const driver = createMockDriver(createProviderServices(handle), {
    pollsBeforeDone: 1,
    renderVideo: createMockVideoRenderer(tools),
    llm: (req) =>
      req.jsonSchema
        ? {
            title: '雨天的貓',
            shots: Array.from({ length: shots }, (_, i) => ({
              description: `鏡頭${String(i + 1)}：貓在雨中走`,
              size: 'wide',
              cameraMove: null,
              characters: ['小花'],
              mood: '安靜',
            })),
          }
        : undefined,
  })
  const queue = createProjectJobQueue(handle, {
    drivers: { mock: driver },
    defaultLimits: { pollIntervalMs: 10 },
  })
  queue.start()
  const registry = createRegistry()
  registerQuickStartNodes(registry)
  const prices = new ModelRegistry(loadBuiltinModelCards())
  const engine = createProjectEngine(handle, {
    registry,
    services: { [STUDIO_SERVICE_KEY]: createStudioServices({ queue, handle, tools }) },
    priceLookup: (id, usage) => prices.estimate(id, usage),
  })
  return { handle, queue, engine, tools }
}

const options = (shotCount: number) => ({
  story: '一隻貓在雨天裡找到溫暖的家',
  style: 'anime' as const,
  shotCount,
  durationSec: 3,
  aspectRatio: '16:9' as const,
  models,
})

describe('快速開始（示範模式，不連網、不用 Key）', () => {
  it('故事 → 拆鏡 → 每鏡首幀與影片 → 接成一支 MP4，時長約等於鏡頭數 × 3 秒', async () => {
    const { handle, queue, engine, tools } = setup(4)
    const flow = buildQuickStart(options(4))
    const result = await engine.run(flow, {
      projectId: handle.projectId,
      itemCounts: quickStartItemCounts(options(4)),
    })
    queue.stop()

    expect(result.run.status).toBe('succeeded')
    const joined = AssetRefSchema.parse((result.outputs.get('join') as { video: unknown }).video)
    const info = await probe(tools, handle.assets.find(joined.hash)?.path ?? '')
    expect(info.durationSec).toBeCloseTo(12, 0)
    expect(info).toMatchObject({ width: 640, height: 360, hasVideo: true })

    // 4 鏡 × (首幀 + 影片) + 1 次 LLM
    const jobs = handle.repos.jobs.list()
    expect(jobs.filter((j) => j.kind === 'llm')).toHaveLength(1)
    expect(jobs.filter((j) => j.kind === 'image')).toHaveLength(4)
    expect(jobs.filter((j) => j.kind === 'video')).toHaveLength(4)
    expect(jobs.every((j) => j.status === 'succeeded')).toBe(true)

    // 花費有入帳（示範供應商沒回報金額，所以全是估算），且沒超過預設上限
    expect(result.run.estimatedCostUsd).toBeGreaterThan(0)
    expect(handle.repos.costs.totalUsd(handle.projectId)).toBeGreaterThan(0)
    expect(handle.repos.costs.estimatedUsd(handle.projectId)).toBeCloseTo(
      handle.repos.costs.totalUsd(handle.projectId),
    )
    handle.close()
  })

  it('再執行一次：全部走快取，不再送出任何任務、不再花錢', async () => {
    const { handle, queue, engine } = setup(3)
    const flow = buildQuickStart(options(3))
    const run = () =>
      engine.run(flow, {
        projectId: handle.projectId,
        itemCounts: quickStartItemCounts(options(3)),
      })
    await run()
    const jobsBefore = handle.repos.jobs.list().length
    const costBefore = handle.repos.costs.totalUsd(handle.projectId)

    const second = await run()
    queue.stop()
    expect(second.run.status).toBe('succeeded')
    expect(handle.repos.jobs.list()).toHaveLength(jobsBefore)
    expect(handle.repos.costs.totalUsd(handle.projectId)).toBe(costBefore)
    expect(second.run.actualCostUsd).toBe(0)
    handle.close()
  })

  it('換一批（variation）才會重新生成；預算太低時一個任務都不送', async () => {
    const { handle, queue, engine } = setup(2)
    await engine.run(buildQuickStart(options(2)), { projectId: handle.projectId })
    const before = handle.repos.jobs.list().length
    await engine.run(buildQuickStart({ ...options(2), variation: 1 }), {
      projectId: handle.projectId,
    })
    expect(handle.repos.jobs.list().length).toBeGreaterThan(before)

    const jobsNow = handle.repos.jobs.list().length
    await expect(
      engine.run(buildQuickStart({ ...options(2), variation: 2 }), {
        projectId: handle.projectId,
        itemCounts: quickStartItemCounts(options(2)),
        budget: { perRunLimitUsd: 0.01 },
      }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' })
    queue.stop()
    expect(handle.repos.jobs.list()).toHaveLength(jobsNow)
    handle.close()
  })
})
