import type { Job } from '@svs/schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectManager } from '../project-manager'
import { createAppLedger } from './app-ledger'
import { createCostReconciler, reconcileJobCosts } from './reconcile'

// 任務成功了、錢也花了（任務記錄上有金額），但花費帳本沒有同一個 jobId 的紀錄
// （例如 App 關掉時影片還在輪詢，重開後佇列接回、做完了，沒有任何一段程式會替它記帳）。
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'svs-reconcile-'))
  roots.push(root)
  const ledger = createAppLedger({})
  const projects = new ProjectManager('test', ledger)
  projects.create(join(root, 'p.svsproj'), '測試專案')
  const handle = projects.current()
  if (!handle) throw new Error('應該有專案')
  const job = (id: string, extra: Partial<Job> = {}): Job => ({
    id,
    provider: 'fal',
    modelId: 'fal/video',
    kind: 'video',
    status: 'succeeded',
    attempt: 1,
    maxAttempts: 3,
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:05:00.000Z',
    costUsd: 0.4,
    ...extra,
  })
  return { projects, handle, ledger, job }
}
const total = (handle: NonNullable<ReturnType<typeof setup>['handle']>): number =>
  handle.repos.costs.totalUsd(handle.projectId)

describe('開專案時對帳：任務上有金額、帳本沒記的，補記一次', () => {
  it('補記：金額進專案帳本（帶 jobId）、回報補了多少；再對一次什麼都不補（冪等）', () => {
    const { handle, ledger, job } = setup()
    handle.repos.jobs.put(job('j1'))
    handle.repos.jobs.put(job('j2', { costUsd: 0.25, modelId: 'fal/other' }))
    const first = reconcileJobCosts(handle, ledger)
    expect(first?.count).toBe(2)
    expect(first?.usd).toBeCloseTo(0.65, 9)
    expect(total(handle)).toBeCloseTo(0.65, 9)
    expect(handle.repos.costs.list(handle.projectId).map((e) => e.jobId)).toEqual(['j1', 'j2'])
    expect(reconcileJobCosts(handle, ledger)).toBeUndefined()
    expect(total(handle)).toBeCloseTo(0.65, 9)
  })

  it('帳本裡已經有這個任務的紀錄：不補', () => {
    const { handle, ledger, job } = setup()
    handle.repos.jobs.put(job('j1'))
    handle.repos.costs.record({
      projectId: handle.projectId,
      provider: 'fal',
      modelId: 'fal/video',
      amountUsd: 0.4,
      estimated: false,
      jobId: 'j1',
    })
    expect(reconcileJobCosts(handle, ledger)).toBeUndefined()
    expect(total(handle)).toBeCloseTo(0.4, 9)
  })

  it('已經記在 App 層帳本的任務（專案關掉時記的）：不補，免得算兩次', () => {
    const { handle, ledger, job } = setup()
    handle.repos.jobs.put(job('j1'))
    ledger.record({
      provider: 'fal',
      modelId: 'fal/video',
      amountUsd: 0.4,
      jobId: 'j1',
      reason: 'x',
    })
    expect(reconcileJobCosts(handle, ledger)).toBeUndefined()
    expect(total(handle)).toBe(0)
  })

  it('示範模式（mock）、沒成功、沒金額的任務：都不補', () => {
    const { handle, ledger, job } = setup()
    handle.repos.jobs.put(job('m1', { provider: 'mock', modelId: 'mock/video' }))
    handle.repos.jobs.put(job('f1', { status: 'failed' }))
    handle.repos.jobs.put(job('c1', { status: 'cancelled' }))
    handle.repos.jobs.put(job('n1', { costUsd: undefined }))
    handle.repos.jobs.put(job('z1', { costUsd: 0 }))
    expect(reconcileJobCosts(handle, ledger)).toBeUndefined()
    expect(total(handle)).toBe(0)
  })
})

describe('對帳器：提示只出現一次；接回的任務這次做完了也補', () => {
  it('開專案時有補：留一則提示，取走一次就沒了；沒有漏記的專案不留提示', () => {
    const { projects, handle, ledger, job } = setup()
    const onNotice = vi.fn()
    const reconciler = createCostReconciler({
      projects,
      appLedger: ledger,
      subscribeJobs: () => undefined,
      onNotice,
    })
    // 這個專案沒有漏記：什麼都不留
    projects.open(handle.dir)
    expect(reconciler.takeNotice()).toBeUndefined()
    expect(onNotice).not.toHaveBeenCalled()

    const again = projects.current()
    if (!again) throw new Error('應該有專案')
    again.repos.jobs.put(job('j1'))
    projects.open(again.dir)
    expect(onNotice).toHaveBeenCalledTimes(1)
    const notice = reconciler.takeNotice()
    expect(notice?.count).toBe(1)
    expect(notice?.usd).toBeCloseTo(0.4, 9)
    expect(reconciler.takeNotice()).toBeUndefined()

    // 同一個專案再開一次：已經補過，不再補、不再提示
    projects.open(again.dir)
    expect(reconciler.takeNotice()).toBeUndefined()
    expect(onNotice).toHaveBeenCalledTimes(1)
    const last = projects.current()
    expect(last?.repos.costs.totalUsd(last.projectId)).toBeCloseTo(0.4, 9)
    reconciler.dispose()
  })

  it('開專案時還沒做完的任務（接回的）：這次做完了就補記，並留提示', () => {
    const { projects, handle, ledger, job } = setup()
    handle.repos.jobs.put(job('j1', { status: 'polling', costUsd: undefined }))
    let listener: ((job: Job) => void) | undefined
    const reconciler = createCostReconciler({
      projects,
      appLedger: ledger,
      subscribeJobs: (l) => {
        listener = l
        return () => {
          listener = undefined
        }
      },
      onNotice: () => undefined,
    })
    projects.open(handle.dir)
    const opened = projects.current()
    if (!opened) throw new Error('應該有專案')
    expect(reconciler.takeNotice()).toBeUndefined()

    // 任務做完：先寫進資料庫（佇列都是先存再通知），再通知
    const done = job('j1', { status: 'succeeded', costUsd: 0.9 })
    opened.repos.jobs.put(done)
    listener?.(done)
    expect(opened.repos.costs.totalUsd(opened.projectId)).toBeCloseTo(0.9, 9)
    expect(reconciler.takeNotice()?.usd).toBeCloseTo(0.9, 9)

    // 不是接回的任務（這次新開的）做完了：由呼叫它的那段程式記帳，這裡不碰
    const fresh = job('new1', { costUsd: 0.3 })
    opened.repos.jobs.put(fresh)
    listener?.(fresh)
    expect(opened.repos.costs.totalUsd(opened.projectId)).toBeCloseTo(0.9, 9)
    reconciler.dispose()
  })
})
