import { JobSchema, type Job, type JobStatus } from '@svs/schema'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import type { AppDb } from '../database'
import { dropNulls } from '../rows'
import { costLedger, jobs } from '../tables/execution'

/** 某個素材是花了多久、多少錢生成的。 */
export interface AssetUsage {
  durationMs: number
  costUsd?: number
  /** 花費是估算的（供應商沒有回報實際金額）。 */
  costEstimated?: boolean
  /** 這張圖是自動裁掉黑邊之後的版本（花費與時間算的是裁之前那次生成）。 */
  letterboxTrimmed?: boolean
}

export interface JobListFilter {
  statuses?: readonly JobStatus[]
  provider?: string
  limit?: number
}

/**
 * 任務佇列的持久層。任務狀態每次改變都整筆寫回（put），
 * App 被強制結束後重開，佇列靠這張表接回 submitted / polling 的任務。
 */
export class JobsRepository {
  get(id: string): Job | undefined {
    const row = this.db.select().from(jobs).where(eq(jobs.id, id)).get()
    return row ? toJob(row) : undefined
  }

  /** 新增或整筆覆寫。 */
  put(job: Job): void {
    const row = toRow(JobSchema.parse(job))
    this.db.insert(jobs).values(row).onConflictDoUpdate({ target: jobs.id, set: row }).run()
  }

  /** 依建立時間由舊到新；有 limit 時改成取最新的 N 筆（仍由舊到新排列）。 */
  list(filter: JobListFilter = {}): Job[] {
    const conditions = [
      filter.statuses ? inArray(jobs.status, [...filter.statuses]) : undefined,
      filter.provider ? eq(jobs.provider, filter.provider) : undefined,
    ].filter((c) => c !== undefined)
    const where = conditions.length > 0 ? and(...conditions) : undefined
    if (filter.limit === undefined) {
      return this.db.select().from(jobs).where(where).orderBy(asc(jobs.createdAt)).all().map(toJob)
    }
    return this.db
      .select()
      .from(jobs)
      .where(where)
      .orderBy(desc(jobs.createdAt))
      .limit(filter.limit)
      .all()
      .map(toJob)
      .reverse()
  }

  /**
   * 這些素材各是哪一次生成花了多久、多少錢（只看成功的任務；同一個素材被生成過多次就取最新的）。
   * 只讀必要的欄位，不解析整筆任務，畫面每次更新都可以呼叫。
   */
  usageByAsset(hashes: readonly string[]): Map<string, AssetUsage> {
    const usage = new Map<string, AssetUsage>()
    if (hashes.length === 0) return usage
    const hash = sql<string | null>`json_extract(${jobs.output}, '$.assets[0].hash')`
    const trimmed = sql<number | null>`json_extract(${jobs.output}, '$.assets[0].letterboxTrimmed')`
    const rows = this.db
      .select({
        id: jobs.id,
        hash,
        trimmed,
        costUsd: jobs.costUsd,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .where(and(eq(jobs.status, 'succeeded'), inArray(hash, [...hashes])))
      .orderBy(asc(jobs.createdAt))
      .all()
    const ledger = new Map<string, { usd: number; estimated: boolean }>()
    const needsLedger = rows.filter((r) => r.costUsd === null).map((r) => r.id)
    if (needsLedger.length > 0) {
      const entries = this.db
        .select({
          jobId: costLedger.jobId,
          amountUsd: costLedger.amountUsd,
          estimated: costLedger.estimated,
        })
        .from(costLedger)
        .where(inArray(costLedger.jobId, needsLedger))
        .all()
      for (const entry of entries) {
        if (!entry.jobId) continue
        const before = ledger.get(entry.jobId)
        ledger.set(entry.jobId, {
          usd: (before?.usd ?? 0) + entry.amountUsd,
          estimated: (before?.estimated ?? false) || entry.estimated,
        })
      }
    }
    for (const row of rows) {
      if (!row.hash) continue
      const started = Date.parse(row.createdAt)
      const ended = Date.parse(row.updatedAt)
      const spent =
        row.costUsd === null ? ledger.get(row.id) : { usd: row.costUsd, estimated: false }
      usage.set(row.hash, {
        durationMs:
          Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0,
        ...(spent ? { costUsd: spent.usd, costEstimated: spent.estimated } : {}),
        ...(row.trimmed ? { letterboxTrimmed: true } : {}),
      })
    }
    return usage
  }

  constructor(private readonly db: AppDb) {}
}

type JobRow = typeof jobs.$inferSelect

function toJob(row: JobRow): Job {
  return JobSchema.parse(dropNulls(row))
}

function toRow(job: Job): typeof jobs.$inferInsert {
  return {
    id: job.id,
    nodeRunId: job.nodeRunId ?? null,
    provider: job.provider,
    modelId: job.modelId,
    kind: job.kind,
    status: job.status,
    providerJobId: job.providerJobId ?? null,
    input: job.input ?? null,
    output: job.output ?? null,
    costUsd: job.costUsd ?? null,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    nextRunAt: job.nextRunAt ?? null,
    error: job.error ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}
