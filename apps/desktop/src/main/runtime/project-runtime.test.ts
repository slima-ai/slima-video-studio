import { ModelRegistry, loadBuiltinModelCards } from '@svs/providers'
import type { IpcEventName, JobSummary } from '@svs/schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createIpcRegistry } from '../ipc/registry'
import { registerAllHandlers } from '../ipc/handlers'
import { MemoryVault } from '../keys/key-vault'
import { ProjectManager } from '../project-manager'
import { testSettingsDeps } from '../settings/test-deps'
import { createProjectRuntime } from './project-runtime'

const dirs: string[] = []
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'svs-runtime-'))
  dirs.push(root)
  const projects = new ProjectManager('test')
  const events: { name: IpcEventName; payload: unknown }[] = []
  const runtime = createProjectRuntime({
    projects,
    keys: new MemoryVault(),
    models: new ModelRegistry(loadBuiltinModelCards()),
    broadcast: (name, payload) => events.push({ name, payload }),
    log,
    tools: () => undefined,
    pollIntervalMs: 5,
  })
  cleanups.push(() => {
    runtime.dispose()
    projects.close()
  })
  return { root, projects, runtime, events }
}

const llmInput = {
  capability: 'llm',
  modelId: 'mock/llm',
  messages: [{ role: 'user', content: '請把這個故事拆成鏡頭' }],
}

describe('createProjectRuntime', () => {
  it('沒有開啟專案時沒有佇列；開專案後建立、關專案後移除，並通知畫面重新載入', () => {
    const { root, projects, runtime, events } = setup()
    expect(runtime.queue()).toBeUndefined()
    projects.create(join(root, 'a.svsproj'), 'A')
    expect(runtime.queue()).toBeDefined()
    projects.close()
    expect(runtime.queue()).toBeUndefined()
    expect(events.filter((e) => e.name === 'queue.reset')).toHaveLength(2)
  })

  it('summarize：任務對到快速開始的 each[n] 節點時帶上「第 n+1 鏡」，其他沒有', () => {
    const { root, projects, runtime } = setup()
    const info = projects.create(join(root, 'a.svsproj'), 'A')
    const handle = projects.current()
    if (!handle) throw new Error('應該有開啟的專案')
    const now = '2026-10-12T08:00:00.000Z'
    handle.repos.runs.saveRun({
      id: 'r1',
      projectId: info.id,
      workflowId: 'w1',
      status: 'running',
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      startedAt: now,
      createdAt: now,
    })
    for (const [id, nodeId] of [
      ['n-shot', 'each[1]/image'],
      ['n-other', 'breakdown'],
    ] as const) {
      handle.repos.runs.saveNodeRun({
        id,
        runId: 'r1',
        nodeId,
        status: 'running',
        cacheKey: 'a'.repeat(64),
        startedAt: now,
      })
    }
    const job = {
      id: 'j1',
      provider: 'mock',
      modelId: 'mock/image',
      kind: 'image' as const,
      status: 'queued' as const,
      attempt: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    }
    expect(runtime.summarize({ ...job, nodeRunId: 'n-shot' }).stepLabel).toBe('第 2 鏡')
    expect(runtime.summarize({ ...job, nodeRunId: 'n-other' }).stepLabel).toBeUndefined()
    expect(runtime.summarize(job).stepLabel).toBeUndefined()
  })

  it('示範任務跑完整個流程，每次狀態變化都會廣播摘要（不含完整請求）', async () => {
    const { root, projects, runtime, events } = setup()
    projects.create(join(root, 'a.svsproj'), 'A')
    const queue = runtime.queue()
    if (!queue) throw new Error('應該有佇列')
    const job = queue.enqueue({
      provider: 'mock',
      modelId: 'mock/llm',
      kind: 'llm',
      input: llmInput,
    })
    const done = await queue.wait(job.id)
    expect(done.status).toBe('succeeded')

    const changes = events
      .filter((e) => e.name === 'queue.changed')
      .map((e) => e.payload as JobSummary)
    expect(changes.at(-1)).toMatchObject({
      id: job.id,
      status: 'succeeded',
      promptPreview: '請把這個故事拆成鏡頭',
    })
    expect(JSON.stringify(changes)).not.toContain('"messages"')
  })

  it('換專案：舊的佇列停止，新專案從自己的任務清單開始', () => {
    const { root, projects, runtime } = setup()
    projects.create(join(root, 'a.svsproj'), 'A')
    const first = runtime.queue()
    first?.enqueue({ provider: 'mock', modelId: 'mock/llm', kind: 'llm', input: llmInput })
    projects.create(join(root, 'b.svsproj'), 'B')
    const second = runtime.queue()
    expect(second).not.toBe(first)
    expect(second?.list()).toEqual([])
  })

  it('重新開啟專案會接回上次沒做完的任務清單', async () => {
    const { root, projects, runtime } = setup()
    const dir = join(root, 'a.svsproj')
    projects.create(dir, 'A')
    const queue = runtime.queue()
    const job = queue?.enqueue({
      provider: 'mock',
      modelId: 'mock/llm',
      kind: 'llm',
      input: llmInput,
    })
    if (!queue || !job) throw new Error('應該有佇列')
    await queue.wait(job.id)
    projects.open(dir)
    expect(
      runtime
        .queue()
        ?.list()
        .map((j) => j.id),
    ).toEqual([job.id])
  })
})

describe('queue IPC', () => {
  function ipc() {
    const env = setup()
    const registry = createIpcRegistry(log)
    const keys = new MemoryVault()
    registerAllHandlers(registry, {
      info: { name: 'n', version: '1', platform: 'linux', packaged: false },
      projects: env.projects,
      keys,
      ...testSettingsDeps(keys),
      runtime: env.runtime,
    })
    const call = (channel: string, payload: unknown) =>
      registry.dispatch({ channel, payload }, { emit: vi.fn() })
    return { ...env, call }
  }

  it('沒有開啟專案：清單是空的，取消與重試回報「先開啟專案」', async () => {
    const { call } = ipc()
    expect(await call('queue.list', {})).toEqual({ ok: true, data: { jobs: [] } })
    expect(await call('queue.cancel', { jobId: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'project_not_found' },
    })
    expect(await call('queue.retry', { jobId: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'project_not_found' },
    })
  })

  it('列出任務、取消排隊中的任務、重試已取消的任務', async () => {
    const { root, projects, runtime, call } = ipc()
    projects.create(join(root, 'a.svsproj'), 'A')
    const queue = runtime.queue()
    if (!queue) throw new Error('應該有佇列')
    // 用沒有 Key 的 fal 任務：送出前就會失敗，不會真的連網
    const job = queue.enqueue({
      provider: 'fal',
      modelId: 'fal/nano-banana-2',
      kind: 'image',
      input: { capability: 't2i', modelId: 'fal/nano-banana-2', prompt: '一隻貓' },
    })
    const cancelled = await call('queue.cancel', { jobId: job.id })
    expect(cancelled).toMatchObject({ ok: true, data: { id: job.id, status: 'cancelled' } })
    const listed = await call('queue.list', {})
    expect(listed).toMatchObject({
      ok: true,
      data: { jobs: [{ id: job.id, promptPreview: '一隻貓' }] },
    })
    const retried = await call('queue.retry', { jobId: job.id })
    expect(retried).toMatchObject({ ok: true, data: { id: job.id } })
  })

  it('找不到的任務回報錯誤', async () => {
    const { root, projects, call } = ipc()
    projects.create(join(root, 'a.svsproj'), 'A')
    const result = await call('queue.cancel', { jobId: 'nope' })
    expect(result).toMatchObject({ ok: false })
  })
})
