import type { ProjectHandle } from '@svs/db'
import type { Job, JobStatus } from '@svs/schema'

import type { ProjectManager } from '../project-manager'
import type { AppSpendLedger } from './app-ledger'

/** 對帳補記了多少。 */
export interface ReconcileResult {
  usd: number
  count: number
}

/** 示範模式的假結果不是真的花費，一律不補。 */
const NOT_REAL_PROVIDERS = new Set(['mock'])

const UNFINISHED: readonly JobStatus[] = ['queued', 'running', 'submitted', 'polling']

/**
 * 任務成功、任務記錄上有供應商回報的金額，但花費帳本沒有同一個 jobId 的紀錄：補記一筆。
 * 例如 App 關掉時影片還在輪詢，重開後佇列把任務接回、做完了——那時引擎的執行已經不在，沒有人替它記帳。
 * 冪等：補過的帳本就有那個 jobId，下次不會再補。記在 App 層帳本的（專案關掉時記的）也算已記。
 */
export function reconcileJobCosts(
  handle: ProjectHandle,
  appLedger?: AppSpendLedger,
): ReconcileResult | undefined {
  if (handle.closed) return undefined
  const booked = new Set<string>()
  for (const entry of handle.repos.costs.list(handle.projectId)) {
    if (entry.jobId !== undefined) booked.add(entry.jobId)
  }
  for (const entry of appLedger?.list() ?? []) {
    if (entry.jobId !== undefined) booked.add(entry.jobId)
  }
  let usd = 0
  let count = 0
  for (const job of handle.repos.jobs.list({ statuses: ['succeeded'] })) {
    if (job.costUsd === undefined || job.costUsd <= 0) continue
    if (NOT_REAL_PROVIDERS.has(job.provider) || booked.has(job.id)) continue
    handle.repos.costs.record({
      projectId: handle.projectId,
      provider: job.provider,
      modelId: job.modelId,
      amountUsd: job.costUsd,
      estimated: false,
      jobId: job.id,
    })
    usd += job.costUsd
    count += 1
  }
  return count === 0 ? undefined : { usd, count }
}

export interface CostReconcilerDeps {
  projects: ProjectManager
  appLedger?: AppSpendLedger
  /** 訂閱目前專案任務佇列的狀態改變；沒有佇列就回 undefined。 */
  subscribeJobs: (listener: (job: Job) => void) => (() => void) | undefined
  /** 有新的提示可以取走了（叫畫面來取）。 */
  onNotice?: () => void
}

export interface CostReconciler {
  /** 取走補記的提示（累加起來的金額與筆數）；取完就清掉，只出現一次。 */
  takeNotice: () => ReconcileResult | undefined
  dispose: () => void
}

/**
 * 開專案時對帳一次；開專案時還沒做完的任務（重開後佇列接回的），這次做完了也再對一次。
 * 補了錢就留一則提示，等畫面取走。
 */
export function createCostReconciler(deps: CostReconcilerDeps): CostReconciler {
  let notice: ReconcileResult | undefined
  let stopWatching: (() => void) | undefined

  const run = (handle: ProjectHandle): void => {
    const result = reconcileJobCosts(handle, deps.appLedger)
    if (!result) return
    notice = {
      usd: (notice?.usd ?? 0) + result.usd,
      count: (notice?.count ?? 0) + result.count,
    }
    deps.onNotice?.()
  }

  const unsubscribe = deps.projects.onChange((handle) => {
    stopWatching?.()
    stopWatching = undefined
    if (!handle) return
    const resumed = new Set(handle.repos.jobs.list({ statuses: UNFINISHED }).map((job) => job.id))
    run(handle)
    if (resumed.size === 0) return
    stopWatching = deps.subscribeJobs((job) => {
      if (job.status !== 'succeeded' || !resumed.delete(job.id)) return
      run(handle)
    })
  })

  return {
    takeNotice: () => {
      const taken = notice
      notice = undefined
      return taken
    },
    dispose: () => {
      unsubscribe()
      stopWatching?.()
    },
  }
}
