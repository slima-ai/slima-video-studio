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
  /** 接片的結果（還沒混音）；有聲音時 assetHash 是混音後的成品，重混從這支開始。沒有聲音就沒有。 */
  baseAssetHash?: string
  /** 混音用了哪一組聲音的指紋；沒有聲音就沒有。 */
  soundKey?: string
  /** 接片當下各鏡裁切的指紋；一鏡都沒裁（舊的成品也是）就沒有。 */
  trimKey?: string
  createdAt: string
}

export interface NewFinalCut {
  assetHash: string
  durationSec?: number | undefined
  takeIds: readonly string[]
  baseAssetHash?: string | undefined
  soundKey?: string | undefined
  trimKey?: string | undefined
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
      ...(input.baseAssetHash === undefined ? {} : { baseAssetHash: input.baseAssetHash }),
      ...(input.soundKey === undefined ? {} : { soundKey: input.soundKey }),
      ...(input.trimKey === undefined ? {} : { trimKey: input.trimKey }),
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
        baseAssetHash: cut.baseAssetHash ?? null,
        soundKey: cut.soundKey ?? null,
        trimKey: cut.trimKey ?? null,
        createdAt: cut.createdAt,
      })
      .run()
    return cut
  }

  /** 最新的成品；還沒接過就是 undefined。只向資料庫要最新的那一筆，不把所有版本撈回來再挑。 */
  latest(): FinalCut | undefined {
    const row = this.db
      .select()
      .from(finalCuts)
      .where(eq(finalCuts.projectId, this.projectId))
      .orderBy(desc(finalCuts.version))
      .limit(1)
      .get()
    return row === undefined ? undefined : toFinalCut(row)
  }

  /** 所有版本，新的在前。 */
  list(): FinalCut[] {
    return this.db
      .select()
      .from(finalCuts)
      .where(eq(finalCuts.projectId, this.projectId))
      .orderBy(desc(finalCuts.version))
      .all()
      .map(toFinalCut)
  }
}

function toFinalCut(row: typeof finalCuts.$inferSelect): FinalCut {
  return {
    id: row.id,
    version: row.version,
    assetHash: row.assetHash,
    ...(row.durationSec === null ? {} : { durationSec: row.durationSec }),
    takeIds: row.takeIds,
    ...(row.baseAssetHash === null ? {} : { baseAssetHash: row.baseAssetHash }),
    ...(row.soundKey === null ? {} : { soundKey: row.soundKey }),
    ...(row.trimKey === null ? {} : { trimKey: row.trimKey }),
    createdAt: row.createdAt,
  }
}
