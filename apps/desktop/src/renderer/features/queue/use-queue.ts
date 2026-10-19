import type { JobSummary } from '@svs/schema'
import { useCallback, useEffect, useState } from 'react'

import { call, errorText } from '../../lib/svs'

/** 狀態的先後（時間一樣時用它判斷哪個比較新）。 */
const STAGE: Record<JobSummary['status'], number> = {
  queued: 0,
  running: 1,
  submitted: 2,
  polling: 3,
  succeeded: 4,
  failed: 4,
  cancelled: 4,
}

/** b 比 a 舊：更新時間比較早，或時間一樣但狀態還在前面的階段。 */
const isOlder = (b: JobSummary, a: JobSummary): boolean =>
  b.updatedAt < a.updatedAt || (b.updatedAt === a.updatedAt && STAGE[b.status] < STAGE[a.status])

/**
 * 新的在前；已經在清單裡的任務就地更新（保持原本的位置）。
 * 比手上的還舊的更新不採用：重新載入的清單或晚到的事件不會把「完成」蓋回「送出中」。
 */
export function upsertJob(
  jobs: JobSummary[],
  job: JobSummary,
  /** 使用者自己按的取消、重試：主行程回來的就是現在的狀態，一律採用。 */
  force = false,
): JobSummary[] {
  const index = jobs.findIndex((j) => j.id === job.id)
  if (index === -1) return [job, ...jobs]
  const current = jobs[index]
  if (!force && current && isOlder(job, current)) return jobs
  return jobs.map((j, i) => (i === index ? job : j))
}

export interface QueueState {
  jobs: JobSummary[]
  error: string | undefined
  cancel: (jobId: string) => void
  retry: (jobId: string) => void
}

/** 任務清單：先載入一次，之後靠主行程推送的事件保持最新。 */
export function useQueue(): QueueState {
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(() => {
    call('queue.list', {})
      .then(({ jobs: list }) => {
        // 載入期間收到的更新如果比清單裡的新，留著
        setJobs((current) =>
          [...list].reverse().map((job) => {
            const known = current.find((j) => j.id === job.id)
            return known && isOlder(job, known) ? known : job
          }),
        )
        setError(undefined)
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }, [])

  useEffect(() => {
    load()
    const offChanged = window.svs.on('queue.changed', (job) => {
      setJobs((current) => upsertJob(current, job))
    })
    const offReset = window.svs.on('queue.reset', load)
    return () => {
      offChanged()
      offReset()
    }
  }, [load])

  const act = (channel: 'queue.cancel' | 'queue.retry', jobId: string): void => {
    setError(undefined)
    call(channel, { jobId })
      .then((job) => {
        setJobs((current) => upsertJob(current, job, true))
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }

  return {
    jobs,
    error,
    cancel: (jobId) => {
      act('queue.cancel', jobId)
    },
    retry: (jobId) => {
      act('queue.retry', jobId)
    },
  }
}
