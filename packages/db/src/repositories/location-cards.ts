import {
  AppError,
  LOCATION_REFERENCE_PURPOSES,
  LocationCardViewSchema,
  LocationSchema,
  type ConceptView,
  type Location,
  type LocationAngle,
  type LocationCardView,
  type LocationReferencePurpose,
  type LocationReferenceView,
} from '@svs/schema'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { AppDb } from '../database'
import { dropNulls } from '../rows'
import { locationConcepts, locationReferences, locations } from '../tables/core'

const notFound = (): AppError =>
  new AppError({ code: 'project_invalid', userMessage: '找不到這個場景卡。' })

const locked = (): AppError =>
  new AppError({
    code: 'invalid_request',
    userMessage: '這張場景卡已經鎖定，要先解除鎖定才能修改。',
  })

/** 角度在 angleAssetHashes 裡的位置。 */
const ANGLE_INDEX: Record<LocationAngle, number> = { reverse: 0, wide: 1 }

/**
 * 場景卡：地點（locations）的視覺設定——固定場景描述、主場景圖、兩個角度，以及鎖定狀態。
 * 地點本身的新增、改名、刪除在 OutlineRepository；這裡只管場景卡的內容。
 * 跟角色卡不同，場景卡沒有版本歷史：要改已鎖定的場景卡，先解除鎖定、改完再鎖定。
 */
export class LocationCardsRepository {
  constructor(
    private readonly db: AppDb,
    private readonly projectId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): LocationCardView[] {
    return this.db
      .select()
      .from(locations)
      .where(eq(locations.projectId, this.projectId))
      .orderBy(asc(sql`rowid`))
      .all()
      .map((row) => toCard(toLocation(row)))
  }

  get(id: string): LocationCardView | undefined {
    return this.list().find((card) => card.id === id)
  }

  /** 已鎖定、而且有固定描述的場景卡（生成鏡頭時會帶入）。 */
  listLocked(): LocationCardView[] {
    return this.list().filter((card) => card.status === 'locked' && card.anchorText.trim() !== '')
  }

  private need(id: string): LocationCardView {
    const card = this.get(id)
    if (!card) throw notFound()
    return card
  }

  /** 還沒鎖定才能改。 */
  private needDraft(id: string): LocationCardView {
    const card = this.need(id)
    if (card.status === 'locked') throw locked()
    return card
  }

  setAnchor(id: string, text: string): LocationCardView {
    this.needDraft(id)
    this.db.update(locations).set({ anchorText: text.trim() }).where(eq(locations.id, id)).run()
    return this.need(id)
  }

  // ── 參考圖（有用途標記的清單） ──

  /**
   * 這張場景卡的參考圖清單：場景卡本來的主圖與兩個角度（source: card）在前，另外加的（source: added）在後。
   * 讀到不認得的用途（較新版本存的）一律當 general。
   */
  listReferences(locationId: string): LocationReferenceView[] {
    const card = this.need(locationId)
    const own: LocationReferenceView[] = [
      ...(card.mainAssetHash ? [{ purpose: 'main', hash: card.mainAssetHash } as const] : []),
      ...(card.angles.reverse ? [{ purpose: 'reverse', hash: card.angles.reverse } as const] : []),
      ...(card.angles.wide ? [{ purpose: 'wide', hash: card.angles.wide } as const] : []),
    ].map(({ purpose, hash }) => ({
      id: `card:${purpose}`,
      assetHash: hash,
      purpose,
      label: '',
      source: 'card' as const,
    }))
    const added = this.db
      .select()
      .from(locationReferences)
      .where(eq(locationReferences.locationId, locationId))
      .orderBy(asc(sql`rowid`))
      .all()
      .map((row): LocationReferenceView => ({
        id: row.id,
        assetHash: row.assetHash,
        purpose: toPurpose(row.purpose),
        label: row.label,
        createdAt: row.createdAt,
        source: 'added',
      }))
    return [...own, ...added]
  }

  /**
   * 加一張參考圖，並標上用途。同一張圖同一個用途只存一筆（重複加回傳原來那筆）。
   * 跟場景卡的其他內容一樣，已鎖定的場景卡要先解除鎖定才能改。圖檔存不存在由呼叫的地方檢查。
   */
  addReference(input: {
    locationId: string
    assetHash: string
    purpose: LocationReferencePurpose
    label: string
  }): LocationReferenceView {
    this.needDraft(input.locationId)
    const existing = this.db
      .select()
      .from(locationReferences)
      .where(
        and(
          eq(locationReferences.locationId, input.locationId),
          eq(locationReferences.assetHash, input.assetHash),
          eq(locationReferences.purpose, input.purpose),
        ),
      )
      .get()
    if (existing) {
      return {
        id: existing.id,
        assetHash: existing.assetHash,
        purpose: toPurpose(existing.purpose),
        label: existing.label,
        createdAt: existing.createdAt,
        source: 'added',
      }
    }
    const row = {
      id: randomUUID(),
      locationId: input.locationId,
      assetHash: input.assetHash,
      purpose: input.purpose,
      label: input.label.trim(),
      createdAt: this.now().toISOString(),
    }
    this.db.insert(locationReferences).values(row).run()
    return {
      id: row.id,
      assetHash: row.assetHash,
      purpose: input.purpose,
      label: row.label,
      createdAt: row.createdAt,
      source: 'added',
    }
  }

  /** 移除一張「另外加的」參考圖（圖檔本身留在專案裡）；找不到就當作已經沒有了。 */
  removeReference(locationId: string, referenceId: string): void {
    this.needDraft(locationId)
    this.db
      .delete(locationReferences)
      .where(
        and(eq(locationReferences.locationId, locationId), eq(locationReferences.id, referenceId)),
      )
      .run()
  }

  // ── 概念圖 ──

  /** 所有概念圖，新的一輪在前。 */
  listConcepts(locationId: string): ConceptView[] {
    return this.db
      .select()
      .from(locationConcepts)
      .where(eq(locationConcepts.locationId, locationId))
      .orderBy(desc(locationConcepts.round), asc(locationConcepts.slot))
      .all()
      .map((row) => ({
        id: row.id,
        round: row.round,
        assetHash: row.assetHash,
        modelId: row.modelId,
        createdAt: row.createdAt,
      }))
  }

  /** 下一輪的編號（還沒有任何概念圖就是 1）。 */
  nextConceptRound(locationId: string): number {
    const row = this.db
      .select({ round: sql<number>`coalesce(max(${locationConcepts.round}), 0)` })
      .from(locationConcepts)
      .where(eq(locationConcepts.locationId, locationId))
      .get()
    return (row?.round ?? 0) + 1
  }

  addConcept(input: {
    locationId: string
    round: number
    slot: number
    assetHash: string
    modelId: string
  }): ConceptView {
    this.need(input.locationId)
    const concept: ConceptView = {
      id: randomUUID(),
      round: input.round,
      assetHash: input.assetHash,
      modelId: input.modelId,
      createdAt: this.now().toISOString(),
    }
    this.db
      .insert(locationConcepts)
      .values({ ...concept, locationId: input.locationId, slot: input.slot })
      .run()
    return concept
  }

  /** 拿掉某個模型（例如「upload」接上來的圖）產生的、檔案相同的概念圖。 */
  removeConcepts(locationId: string, assetHash: string, modelId: string): void {
    this.db
      .delete(locationConcepts)
      .where(
        and(
          eq(locationConcepts.locationId, locationId),
          eq(locationConcepts.assetHash, assetHash),
          eq(locationConcepts.modelId, modelId),
        ),
      )
      .run()
  }

  /**
   * 把一張概念圖挑成主圖。換了主圖，原本的兩個角度就不是照它生成的了，所以一併清掉。
   */
  pickMain(locationId: string, conceptId: string): LocationCardView {
    this.needDraft(locationId)
    const concept = this.db
      .select()
      .from(locationConcepts)
      .where(eq(locationConcepts.id, conceptId))
      .get()
    if (concept?.locationId !== locationId) {
      throw new AppError({ code: 'invalid_request', userMessage: '找不到這張概念圖。' })
    }
    this.db
      .update(locations)
      .set({ mainAssetHash: concept.assetHash, angleAssetHashes: [] })
      .where(eq(locations.id, locationId))
      .run()
    return this.need(locationId)
  }

  /** 記下生成好的角度圖（只更新有給的那幾個）。 */
  setAngles(locationId: string, angles: Partial<Record<LocationAngle, string>>): LocationCardView {
    const card = this.needDraft(locationId)
    const next: string[] = ['', '']
    next[ANGLE_INDEX.reverse] = angles.reverse ?? card.angles.reverse ?? ''
    next[ANGLE_INDEX.wide] = angles.wide ?? card.angles.wide ?? ''
    this.db
      .update(locations)
      .set({ angleAssetHashes: next })
      .where(eq(locations.id, locationId))
      .run()
    return this.need(locationId)
  }

  // ── 鎖定 ──

  /** 鎖定：要有固定描述和主圖。鎖定後鏡頭才會帶入。 */
  lock(locationId: string): LocationCardView {
    const card = this.need(locationId)
    if (card.anchorText.trim() === '') {
      throw new AppError({ code: 'invalid_request', userMessage: '請先寫下這個場景固定的樣子。' })
    }
    if (!card.mainAssetHash) {
      throw new AppError({ code: 'invalid_request', userMessage: '請先挑一張主場景圖。' })
    }
    this.db.update(locations).set({ status: 'locked' }).where(eq(locations.id, locationId)).run()
    return this.need(locationId)
  }

  unlock(locationId: string): LocationCardView {
    this.need(locationId)
    this.db.update(locations).set({ status: 'draft' }).where(eq(locations.id, locationId)).run()
    return this.need(locationId)
  }
}

type LocationRow = typeof locations.$inferSelect

function toLocation(row: LocationRow): Location {
  return LocationSchema.parse(dropNulls(row))
}

function toCard(location: Location): LocationCardView {
  const [reverse, wide] = location.angleAssetHashes
  return LocationCardViewSchema.parse({
    id: location.id,
    name: location.name,
    description: location.description,
    anchorText: location.anchorText,
    status: location.status,
    ...(location.mainAssetHash ? { mainAssetHash: location.mainAssetHash } : {}),
    angles: {
      ...(reverse ? { reverse } : {}),
      ...(wide ? { wide } : {}),
    },
  })
}

/** 資料庫裡存的用途是文字：不認得的（較新版本存的）一律當 general。 */
const toPurpose = (value: string): LocationReferencePurpose =>
  (LOCATION_REFERENCE_PURPOSES as readonly string[]).includes(value)
    ? (value as LocationReferencePurpose)
    : 'general'
