import type { ProjectHandle } from '@svs/db'
import { JobQueue, type JobDriver, type JobQueueOptions } from '@svs/engine'

export interface ProjectJobQueueOptions extends Omit<JobQueueOptions, 'store' | 'drivers'> {
  drivers: Record<string, JobDriver>
}

/** 把專案資料庫（jobs 表）接成任務佇列的儲存層。呼叫端負責 start() / stop()。 */
export function createProjectJobQueue(
  handle: ProjectHandle,
  options: ProjectJobQueueOptions,
): JobQueue {
  const { jobs } = handle.repos
  return new JobQueue({
    ...options,
    // 專案關閉後，進行中的請求收尾時不能再寫資料庫（任務狀態維持關閉前的樣子，下次開啟會接回）
    store: {
      get: (id) => (handle.closed ? undefined : jobs.get(id)),
      put: (job) => {
        if (!handle.closed) jobs.put(job)
      },
      list: (filter) => (handle.closed ? [] : jobs.list(filter)),
    },
  })
}
