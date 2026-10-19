import { createProject, openProject } from '@svs/db'
import type { JobDriver } from '@svs/engine'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createProjectJobQueue } from './job-queue'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe('專案資料庫上的任務佇列（真的 SQLite）', () => {
  it('App 在任務 submitted 時被強制結束，重開專案後接著輪詢完成，且不重複送出', async () => {
    const root = mkdtempSync(join(tmpdir(), 'svs-jq-'))
    dirs.push(root)
    const dir = join(root, '短片.svsproj')
    const env = { appVersion: 'test' }
    let submits = 0
    let polls = 0
    const driver: JobDriver = {
      submit: () => {
        submits++
        return Promise.resolve({ status: 'submitted', providerJobId: 'req-1' })
      },
      poll: () => {
        polls++
        return Promise.resolve({ status: 'done', output: { url: 'https://x/y.mp4' }, costUsd: 0.3 })
      },
    }
    const options = { drivers: { fal: driver }, defaultLimits: { pollIntervalMs: 20 } }

    // 第一次執行：送出後就「被強制結束」（stop 之後關閉資料庫，沒有任何收尾）
    const first = createProject({ dir, name: '短片' }, env)
    const queue1 = createProjectJobQueue(first, options)
    queue1.start()
    const job = queue1.enqueue({
      provider: 'fal',
      modelId: 'kling-3.0',
      kind: 'video',
      input: { prompt: '貓' },
    })
    for (let i = 0; i < 50 && queue1.get(job.id)?.status !== 'submitted'; i++) await sleep(10)
    expect(first.repos.jobs.get(job.id)).toMatchObject({
      status: 'submitted',
      providerJobId: 'req-1',
    })
    queue1.stop()
    first.close()

    // 第二次執行：只靠資料庫接回
    const second = openProject(dir, env)
    const queue2 = createProjectJobQueue(second, options)
    queue2.start()
    const done = await queue2.wait(job.id)
    queue2.stop()

    expect(done).toMatchObject({
      status: 'succeeded',
      output: { url: 'https://x/y.mp4' },
      costUsd: 0.3,
      input: { prompt: '貓' },
    })
    expect(second.repos.jobs.get(job.id)?.status).toBe('succeeded')
    expect(submits).toBe(1)
    expect(polls).toBeGreaterThanOrEqual(1)
    second.close()
  })
})
