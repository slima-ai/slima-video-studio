import { AppError, ShotSchema, TakeSchema, type Shot, type Take, type TakeKind } from '@svs/schema'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { z } from 'zod'

import type { AppDb } from '../database'
import { dropNulls } from '../rows'
import { shotPins, shots, takes } from '../tables/core'

export type NewShot = Omit<z.input<typeof ShotSchema>, 'id' | 'projectId' | 'number' | 'order'>
type Patchable = Omit<Shot, 'id' | 'projectId' | 'number' | 'order'>
/** 要清掉的選填欄位（例如手動修改過的 prompt）可以明確傳入 undefined。 */
export type ShotPatch = { [K in keyof Patchable]?: Patchable[K] | undefined }
export interface NewTake {
  shotId: string
  kind: TakeKind
  assetHash: string
  modelId: string
  seed?: number
  runId?: string
  nodeRunId?: string
  inputHash?: string
}

const notFound = (what: string, id: string): AppError =>
  new AppError({ code: 'project_invalid', userMessage: `找不到${what}（${id}）。` })

export class ShotsRepository {
  constructor(
    private readonly db: AppDb,
    private readonly projectId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): Shot[] {
    return this.db
      .select()
      .from(shots)
      .where(eq(shots.projectId, this.projectId))
      .orderBy(asc(shots.position))
      .all()
      .map(toShot)
  }

  get(id: string): Shot | undefined {
    const row = this.db.select().from(shots).where(eq(shots.id, id)).get()
    return row ? toShot(row) : undefined
  }

  /** 新增在最後面；鏡號與排序都接在現有最大值後面。 */
  create(input: NewShot = {}): Shot {
    const max = this.db
      .select({
        number: sql<number>`coalesce(max(${shots.number}), 0)`,
        position: sql<number>`coalesce(max(${shots.position}), -1)`,
      })
      .from(shots)
      .where(eq(shots.projectId, this.projectId))
      .get()
    const shot = ShotSchema.parse({
      ...input,
      id: randomUUID(),
      projectId: this.projectId,
      number: (max?.number ?? 0) + 1,
      order: (max?.position ?? -1) + 1,
    })
    this.db.insert(shots).values(toShotRow(shot)).run()
    return shot
  }

  update(id: string, patch: ShotPatch): Shot {
    const current = this.get(id)
    if (!current) throw notFound('鏡頭', id)
    const next = ShotSchema.parse({ ...current, ...patch })
    this.db.update(shots).set(toShotRow(next)).where(eq(shots.id, id)).run()
    return next
  }

  delete(id: string): void {
    this.db.delete(shots).where(eq(shots.id, id)).run()
  }

  /** 依傳入順序重新排列；必須剛好包含所有鏡頭。鏡號依新順序重新編號。 */
  reorder(orderedIds: readonly string[]): void {
    const existing = this.list()
    const sameSet =
      orderedIds.length === existing.length &&
      new Set(orderedIds).size === orderedIds.length &&
      existing.every((s) => orderedIds.includes(s.id))
    if (!sameSet) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: '排序必須包含所有鏡頭，且不能重複。',
      })
    }
    this.db.transaction((tx) => {
      orderedIds.forEach((id, index) => {
        tx.update(shots)
          .set({ position: index, number: index + 1 })
          .where(eq(shots.id, id))
          .run()
      })
    })
  }

  // ── Take（生成結果版本） ──────────────────────────────

  listTakes(shotId: string, kind?: TakeKind): Take[] {
    const where = kind
      ? and(eq(takes.shotId, shotId), eq(takes.kind, kind))
      : eq(takes.shotId, shotId)
    return this.db
      .select()
      .from(takes)
      .where(where)
      .orderBy(asc(takes.kind), asc(takes.version))
      .all()
      .map(toTake)
  }

  /** 所有鏡頭目前採用中的版本（畫布投影用，一次讀完，不用每個鏡頭各查一次）。 */
  adoptedTakes(): Take[] {
    return this.db
      .select()
      .from(takes)
      .where(and(eq(takes.ownerType, 'shot'), eq(takes.adopted, true)))
      .all()
      .map(toTake)
  }

  /** 新增版本：版本號是同一鏡頭同一種類內的下一號；第一個版本自動採用。 */
  addTake(input: NewTake): Take {
    return this.db.transaction((tx) => {
      const last = tx
        .select({ version: takes.version })
        .from(takes)
        .where(and(eq(takes.shotId, input.shotId), eq(takes.kind, input.kind)))
        .orderBy(desc(takes.version))
        .limit(1)
        .get()
      const take = TakeSchema.parse({
        ...input,
        id: randomUUID(),
        version: (last?.version ?? 0) + 1,
        adopted: last === undefined,
        createdAt: this.now().toISOString(),
      })
      tx.insert(takes)
        .values({ ...take, ownerType: 'shot', ownerId: take.shotId })
        .run()
      if (take.adopted && take.kind === 'video') {
        tx.update(shots).set({ activeTakeId: take.id }).where(eq(shots.id, take.shotId)).run()
      }
      return take
    })
  }

  /** 記下這個版本是用哪一份輸入生成的（輸入指紋，判斷上游改過沒有用）。 */
  setTakeInputHash(takeId: string, inputHash: string): void {
    this.db.update(takes).set({ inputHash }).where(eq(takes.id, takeId)).run()
  }

  /** 這一鏡手動指定的參考圖（圖檔雜湊，依序）；沒有指定就是空陣列＝自動挑。 */
  listPins(shotId: string): string[] {
    return this.db
      .select({ assetHash: shotPins.assetHash })
      .from(shotPins)
      .where(eq(shotPins.shotId, shotId))
      .orderBy(asc(shotPins.position))
      .all()
      .map((row) => row.assetHash)
  }

  /** 全部鏡頭的手動指定（一次查好；算「需要重新生成」時一鏡一鏡查要好幾百次）。 */
  allPins(): Map<string, string[]> {
    const result = new Map<string, string[]>()
    const rows = this.db
      .select({ shotId: shotPins.shotId, assetHash: shotPins.assetHash })
      .from(shotPins)
      .innerJoin(shots, eq(shotPins.shotId, shots.id))
      .where(eq(shots.projectId, this.projectId))
      .orderBy(asc(shotPins.position))
      .all()
    for (const row of rows)
      result.set(row.shotId, [...(result.get(row.shotId) ?? []), row.assetHash])
    return result
  }

  /**
   * 換掉這一鏡手動指定的參考圖（整份換）；空陣列＝清掉、回到自動挑。重複的圖只留第一次出現的。
   * 原本就有的圖沿用同一列（只改順序），不是整份刪掉重寫：復原才不會撞到「同一張圖只能一列」。
   */
  setPins(shotId: string, assetHashes: readonly string[]): void {
    if (!this.get(shotId)) throw notFound('鏡頭', shotId)
    const wanted = [...new Set(assetHashes)]
    this.db.transaction((tx) => {
      const current = tx.select().from(shotPins).where(eq(shotPins.shotId, shotId)).all()
      const byHash = new Map(current.map((row) => [row.assetHash, row]))
      for (const row of current) {
        if (!wanted.includes(row.assetHash))
          tx.delete(shotPins).where(eq(shotPins.id, row.id)).run()
      }
      wanted.forEach((assetHash, position) => {
        const existing = byHash.get(assetHash)
        if (!existing) {
          tx.insert(shotPins).values({ id: randomUUID(), shotId, assetHash, position }).run()
        } else if (existing.position !== position) {
          tx.update(shotPins).set({ position }).where(eq(shotPins.id, existing.id)).run()
        }
      })
    })
  }

  /** 標記採用：同一鏡頭同一種類只會有一個採用；影片版本同時更新鏡頭的 activeTakeId。 */
  adoptTake(takeId: string): Take {
    return this.db.transaction((tx) => {
      const row = tx.select().from(takes).where(eq(takes.id, takeId)).get()
      if (!row) throw notFound('版本', takeId)
      tx.update(takes)
        .set({ adopted: false })
        .where(
          and(
            eq(takes.ownerType, row.ownerType),
            eq(takes.ownerId, row.ownerId),
            eq(takes.kind, row.kind),
          ),
        )
        .run()
      tx.update(takes).set({ adopted: true }).where(eq(takes.id, takeId)).run()
      if (row.kind === 'video' && row.shotId !== null) {
        tx.update(shots).set({ activeTakeId: takeId }).where(eq(shots.id, row.shotId)).run()
      }
      return toTake({ ...row, adopted: true })
    })
  }

  /**
   * 不採用這一鏡這種的任何版本（畫布上刪掉圖或影片）：版本都還在，之後可以再採用；
   * 影片的話鏡頭的 activeTakeId 也清掉。
   */
  unadopt(shotId: string, kind: TakeKind): void {
    this.db.transaction((tx) => {
      tx.update(takes)
        .set({ adopted: false })
        .where(and(eq(takes.ownerType, 'shot'), eq(takes.shotId, shotId), eq(takes.kind, kind)))
        .run()
      if (kind === 'video') {
        tx.update(shots).set({ activeTakeId: null }).where(eq(shots.id, shotId)).run()
      }
    })
  }

  /**
   * 拿掉一個版本（例如剪掉接上來的圖）。它是採用中的，就改採用同一鏡頭同一種類最新的那一個；
   * 沒有別的版本就沒有採用中的。素材檔案不刪。
   */
  deleteTake(takeId: string): void {
    this.db.transaction((tx) => {
      const row = tx.select().from(takes).where(eq(takes.id, takeId)).get()
      if (!row) return
      tx.delete(takes).where(eq(takes.id, takeId)).run()
      if (!row.adopted) return
      const next = tx
        .select()
        .from(takes)
        .where(
          and(
            eq(takes.ownerType, row.ownerType),
            eq(takes.ownerId, row.ownerId),
            eq(takes.kind, row.kind),
          ),
        )
        .orderBy(desc(takes.version))
        .limit(1)
        .get()
      if (next) tx.update(takes).set({ adopted: true }).where(eq(takes.id, next.id)).run()
      if (row.kind === 'video' && row.shotId !== null) {
        tx.update(shots)
          .set({ activeTakeId: next?.id ?? null })
          .where(eq(shots.id, row.shotId))
          .run()
      }
    })
  }
}

type ShotRow = typeof shots.$inferSelect
type TakeRow = typeof takes.$inferSelect

function toShot(row: ShotRow): Shot {
  const { position, ...rest } = dropNulls(row)
  return ShotSchema.parse({ ...rest, order: position, cameraMove: row.cameraMove })
}

function toShotRow(shot: Shot): ShotRow {
  return {
    id: shot.id,
    projectId: shot.projectId,
    sceneId: shot.sceneId ?? null,
    number: shot.number,
    position: shot.order,
    size: shot.size,
    angle: shot.angle,
    cameraMove: shot.cameraMove,
    durationSec: shot.durationSec,
    description: shot.description,
    action: shot.action,
    endDescription: shot.endDescription,
    prompt: shot.prompt ?? null,
    dialogue: shot.dialogue,
    characters: shot.characters,
    locationId: shot.locationId ?? null,
    lighting: shot.lighting ?? null,
    timeOfDay: shot.timeOfDay ?? null,
    mood: shot.mood ?? null,
    status: shot.status,
    activeTakeId: shot.activeTakeId ?? null,
    inCut: shot.inCut,
  }
}

function toTake(row: TakeRow): Take {
  return TakeSchema.parse(dropNulls(row))
}
