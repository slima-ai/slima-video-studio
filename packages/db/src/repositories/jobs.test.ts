import type { Job } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { newProject, reopen } from '../__tests__/helpers'

const NOW = '2026-10-12T07:36:49.000Z'

function job(id: string, patch: Partial<Job> = {}): Job {
  return {
    id,
    provider: 'fal',
    modelId: 'kling-3.0',
    kind: 'video',
    status: 'queued',
    attempt: 0,
    maxAttempts: 3,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  }
}

describe('JobsRepository', () => {
  it('put 新增後 get 能完整讀回（含 JSON 輸入輸出與錯誤）', () => {
    const { repos } = newProject()
    const full = job('j1', {
      status: 'failed',
      providerJobId: 'req-1',
      input: { prompt: '貓', seed: 7 },
      output: { url: 'https://x/y.mp4' },
      costUsd: 0.42,
      nextRunAt: NOW,
      error: { code: 'provider_rejected', retryable: false, userMessage: '內容被拒絕' },
    })
    repos.jobs.put(full)
    expect(repos.jobs.get('j1')).toEqual(full)
    expect(repos.jobs.get('nope')).toBeUndefined()
  })

  it('同 id 再 put 會整筆覆寫，並能清掉選填欄位', () => {
    const { repos } = newProject()
    repos.jobs.put(job('j1', { status: 'polling', providerJobId: 'req-1', input: { a: 1 } }))
    repos.jobs.put(job('j1', { status: 'queued', attempt: 1 }))
    expect(repos.jobs.get('j1')).toEqual(job('j1', { status: 'queued', attempt: 1 }))
    expect(repos.jobs.list()).toHaveLength(1)
  })

  it('list 依建立時間排序，可用狀態、供應商與數量過濾', () => {
    const { repos } = newProject()
    repos.jobs.put(job('a', { createdAt: '2026-10-12T07:00:01.000Z', status: 'succeeded' }))
    repos.jobs.put(job('b', { createdAt: '2026-10-12T07:00:02.000Z', provider: 'openrouter' }))
    repos.jobs.put(job('c', { createdAt: '2026-10-12T07:00:03.000Z', status: 'polling' }))
    expect(repos.jobs.list().map((j) => j.id)).toEqual(['a', 'b', 'c'])
    expect(repos.jobs.list({ statuses: ['queued', 'polling'] }).map((j) => j.id)).toEqual([
      'b',
      'c',
    ])
    expect(repos.jobs.list({ provider: 'openrouter' }).map((j) => j.id)).toEqual(['b'])
    expect(repos.jobs.list({ limit: 2 }).map((j) => j.id)).toEqual(['b', 'c'])
  })

  it('關掉專案再開，任務還在', () => {
    const handle = newProject()
    handle.repos.jobs.put(job('j1', { status: 'submitted', providerJobId: 'req-9' }))
    handle.close()
    const again = reopen(handle)
    expect(again.repos.jobs.get('j1')).toMatchObject({
      status: 'submitted',
      providerJobId: 'req-9',
    })
  })
  it('usageByAsset：每個素材花了多久、多少錢；沒回報金額就看帳本，失敗的不算', () => {
    const { repos, projectId } = newProject()
    const out = (hash: string) => ({ kind: 'assets', assets: [{ kind: 'image', hash }] })
    const A = 'a'.repeat(64)
    const B = 'b'.repeat(64)
    const C = 'c'.repeat(64)
    repos.jobs.put(
      job('j1', {
        status: 'succeeded',
        output: out(A),
        costUsd: 0.25,
        updatedAt: '2026-10-12T07:36:52.200Z',
      }),
    )
    repos.jobs.put(
      job('j2', { status: 'succeeded', output: out(B), updatedAt: '2026-10-12T07:36:50.000Z' }),
    )
    repos.costs.record({
      provider: 'fal',
      modelId: 'm',
      estimated: true,
      projectId,
      amountUsd: 0.07,
      jobId: 'j2',
    })
    repos.jobs.put(job('j3', { status: 'failed', output: out(C) }))

    const usage = repos.jobs.usageByAsset([A, B, C, 'd'.repeat(64)])
    expect(usage.get(A)).toEqual({ durationMs: 3200, costUsd: 0.25, costEstimated: false })
    expect(usage.get(B)).toEqual({ durationMs: 1000, costUsd: 0.07, costEstimated: true })
    expect(usage.has(C)).toBe(false)
    expect(usage.size).toBe(2)
    expect(repos.jobs.usageByAsset([]).size).toBe(0)
  })

  it('usageByAsset：自動裁掉黑邊的圖（另一個素材）用原圖那次生成的花費與時間，並標 letterboxTrimmed', async () => {
    const { repos, assets } = newProject()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    const original = await assets.put(png, 'image/png', { width: 1, height: 1 })
    const trimmed = await assets.put(Buffer.concat([png, Buffer.from([0])]), 'image/png', {
      width: 1,
      height: 1,
      trimmedFrom: original.hash,
    })
    repos.jobs.put(
      job('j1', {
        status: 'succeeded',
        output: { kind: 'assets', assets: [{ kind: 'image', hash: original.hash }] },
        costUsd: 0.14,
        updatedAt: '2026-10-12T07:36:52.200Z',
      }),
    )
    const usage = repos.jobs.usageByAsset([original.hash, trimmed.hash])
    expect(usage.get(original.hash)).toEqual({
      durationMs: 3200,
      costUsd: 0.14,
      costEstimated: false,
    })
    expect(usage.get(trimmed.hash)).toEqual({
      durationMs: 3200,
      costUsd: 0.14,
      costEstimated: false,
      letterboxTrimmed: true,
    })
    // 找不到原圖那次生成：還是標裁過，只是沒有花費與時間
    const orphan = await assets.put(Buffer.concat([png, Buffer.from([1])]), 'image/png', {
      trimmedFrom: 'e'.repeat(64),
    })
    expect(repos.jobs.usageByAsset([orphan.hash]).get(orphan.hash)).toEqual({
      durationMs: 0,
      letterboxTrimmed: true,
    })
  })
})
