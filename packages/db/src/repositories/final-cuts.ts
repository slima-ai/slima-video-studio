import { desc, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { AppDb } from '../database'
import { finalCuts } from '../tables/canvas'

export interface FinalCut {
  id: string
  version: number
  assetHash: string
  durationSec?: number
  /** 依順序用了哪些影片版本。 */
  takeIds: string[]
  createdAt: string
}

export interface NewFinalCut {
  assetHash: string
  durationSec?: number | undefined
  takeIds: readonly string[]
}

/** 接好的成品：每接一次一個版本。 */
export class FinalCutRepository {
  constructor(
    private readonly db: AppDb,
    private readonly projectId: string,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  /** 存一個新版本（版本號接在最新的後面）。 */
  record(input: NewFinalCut): FinalCut {
    const row = this.db
      .select({ max: sql<number>`coalesce(max(${finalCuts.version}), 0)` })
      .from(finalCuts)
      .where(eq(finalCuts.projectId, this.projectId))
      .get()
    const cut: FinalCut = {
      id: this.newId(),
      version: (row?.max ?? 0) + 1,
      assetHash: input.assetHash,
      ...(input.durationSec === undefined ? {} : { durationSec: input.durationSec }),
      takeIds: [...input.takeIds],
      createdAt: this.now().toISOString(),
    }
    this.db
      .insert(finalCuts)
      .values({
        id: cut.id,
        projectId: this.projectId,
        version: cut.version,
        assetHash: cut.assetHash,
        durationSec: cut.durationSec ?? null,
        takeIds: cut.takeIds,
        createdAt: cut.createdAt,
      })
      .run()
    return cut
  }

  /** 最新的成品；還沒接過就是 undefined。 */
  latest(): FinalCut | undefined {
    const row = this.db
      .select()
      .from(finalCuts)
      .where(eq(finalCuts.projectId, this.projectId))
      .orderBy(desc(finalCuts.version))
      .limit(1)
      .get()
    if (!row) return undefined
    return {
      id: row.id,
      version: row.version,
      assetHash: row.assetHash,
      ...(row.durationSec === null ? {} : { durationSec: row.durationSec }),
      takeIds: row.takeIds,
      createdAt: row.createdAt,
    }
  }
}
