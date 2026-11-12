import { CostEntrySchema, type CostEntry } from '@svs/schema'
import { and, asc, eq, gte, lt, notInArray, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { AppDb } from '../database'
import { dropNulls } from '../rows'
import { costLedger } from '../tables/execution'

export type NewCostEntry = Omit<CostEntry, 'id' | 'createdAt'>

export interface CostListFilter {
  runId?: string
  /** 含（ISO 時間）。 */
  from?: string
  /** 不含（ISO 時間）。 */
  to?: string
  /** 不算這些供應商（例如示範模式的 mock：示範模式不花錢，估算出來的數字不是真的花費）。 */
  excludeProviders?: readonly string[]
}

/** 花費帳本。優先記供應商回傳的金額；沒有時記估算值並標 estimated。 */
export class CostRepository {
  constructor(
    private readonly db: AppDb,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  record(entry: NewCostEntry): CostEntry {
    const full = CostEntrySchema.parse({
      ...entry,
      id: this.newId(),
      createdAt: this.now().toISOString(),
    })
    this.db
      .insert(costLedger)
      .values({
        id: full.id,
        projectId: full.projectId,
        runId: full.runId ?? null,
        jobId: full.jobId ?? null,
        nodeRunId: full.nodeRunId ?? null,
        provider: full.provider,
        modelId: full.modelId,
        amountUsd: full.amountUsd,
        estimated: full.estimated,
        createdAt: full.createdAt,
      })
      .run()
    return full
  }

  list(projectId: string, filter: CostListFilter = {}): CostEntry[] {
    return this.db
      .select()
      .from(costLedger)
      .where(this.where(projectId, filter))
      .orderBy(asc(costLedger.createdAt))
      .all()
      .map((row) => CostEntrySchema.parse(dropNulls(row)))
  }

  /** 加總（可限定時間範圍或某次執行）。 */
  totalUsd(projectId: string, filter: CostListFilter = {}): number {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${costLedger.amountUsd}), 0)` })
      .from(costLedger)
      .where(this.where(projectId, filter))
      .get()
    return row?.total ?? 0
  }

  /** 其中估算（供應商沒回傳金額）的部分，UI 要標示「約」。 */
  estimatedUsd(projectId: string, filter: CostListFilter = {}): number {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${costLedger.amountUsd}), 0)` })
      .from(costLedger)
      .where(and(this.where(projectId, filter), eq(costLedger.estimated, true)))
      .get()
    return row?.total ?? 0
  }

  /** 某個月（UTC）的花費，給「本月花費」顯示。month 為 1–12。 */
  monthTotalUsd(projectId: string, year: number, month: number): number {
    const from = new Date(Date.UTC(year, month - 1, 1)).toISOString()
    const to = new Date(Date.UTC(year, month, 1)).toISOString()
    return this.totalUsd(projectId, { from, to })
  }

  private where(projectId: string, filter: CostListFilter) {
    return and(
      eq(costLedger.projectId, projectId),
      filter.runId === undefined ? undefined : eq(costLedger.runId, filter.runId),
      filter.from === undefined ? undefined : gte(costLedger.createdAt, filter.from),
      filter.to === undefined ? undefined : lt(costLedger.createdAt, filter.to),
      filter.excludeProviders === undefined || filter.excludeProviders.length === 0
        ? undefined
        : notInArray(costLedger.provider, [...filter.excludeProviders]),
    )
  }
}
