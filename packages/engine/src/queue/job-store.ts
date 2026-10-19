import type { Job, JobStatus } from '@svs/schema'

/** 任務佇列讀寫任務的地方。正式版由 apps/desktop 接上 SQLite（JobsRepository）；測試用 MemoryJobStore。 */
export interface JobStore {
  get: (id: string) => Job | undefined
  /** 新增或整筆覆寫。 */
  put: (job: Job) => void
  /** 依建立時間由舊到新。 */
  list: (filter?: { statuses?: readonly JobStatus[] }) => Job[]
}

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>()

  get(id: string): Job | undefined {
    const job = this.jobs.get(id)
    return job ? structuredClone(job) : undefined
  }

  put(job: Job): void {
    this.jobs.set(job.id, structuredClone(job))
  }

  list(filter: { statuses?: readonly JobStatus[] } = {}): Job[] {
    const { statuses } = filter
    return [...this.jobs.values()]
      .filter((j) => !statuses || statuses.includes(j.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((j) => structuredClone(j))
  }
}
