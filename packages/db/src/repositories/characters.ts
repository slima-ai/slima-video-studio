import {
  AppError,
  CharacterPackSchema,
  CharacterSchema,
  type Character,
  type ConceptView,
  type TurnaroundCuts,
  type TurnaroundView,
  type CharacterEdit,
  type CharacterPack,
  type Costume,
} from '@svs/schema'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { AppDb } from '../database'
import { dropNulls } from '../rows'
import { characterConcepts, characterPacks, characterTurnarounds, characters } from '../tables/core'

/** 服裝先只做一套：它存成 costumes 的第一筆。 */
const DEFAULT_COSTUME_NAME = '預設服裝'

export const outfitOf = (character: Character): string => character.costumes[0]?.description ?? ''

const notFound = (id: string): AppError =>
  new AppError({ code: 'project_invalid', userMessage: `找不到這個角色（${id}）。` })

export class CharactersRepository {
  constructor(
    private readonly db: AppDb,
    private readonly projectId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): Character[] {
    return this.db
      .select()
      .from(characters)
      .where(eq(characters.projectId, this.projectId))
      .orderBy(sql`rowid`)
      .all()
      .map(toCharacter)
  }

  get(id: string): Character | undefined {
    const row = this.db.select().from(characters).where(eq(characters.id, id)).get()
    return row?.projectId === this.projectId ? toCharacter(row) : undefined
  }

  create(name: string): Character {
    const at = this.now().toISOString()
    const character = CharacterSchema.parse({
      id: randomUUID(),
      projectId: this.projectId,
      name: name.trim(),
      createdAt: at,
      updatedAt: at,
    })
    this.db.insert(characters).values(toRow(character)).run()
    return character
  }

  update(id: string, patch: CharacterEdit): Character {
    const current = this.get(id)
    if (!current) throw notFound(id)
    const { outfit, age, ...rest } = patch
    const costumes = outfit === undefined ? current.costumes : withOutfit(current.costumes, outfit)
    const next = CharacterSchema.parse({
      ...current,
      ...stripUndefined(rest),
      ...(age === undefined ? {} : { age: age ?? undefined }),
      costumes,
      updatedAt: this.now().toISOString(),
    })
    const lookChanged =
      next.appearance !== current.appearance || outfitOf(next) !== outfitOf(current)
    this.db.transaction((tx) => {
      tx.update(characters).set(toRow(next)).where(eq(characters.id, id)).run()
      // 外觀改了，已鎖定的固定描述就不一定還對：退回成下一版的草稿，要重新鎖定
      if (lookChanged && this.pack(id)?.status === 'locked') this.draftPack(tx, id)
    })
    return this.get(id) ?? next
  }

  // ── 角色包（固定外觀描述與它的版本） ──────────────────

  /** 目前這一版；還沒寫過固定外觀描述就是 undefined。 */
  pack(characterId: string): CharacterPack | undefined {
    const character = this.get(characterId)
    if (!character?.currentPackId) return undefined
    const row = this.db
      .select()
      .from(characterPacks)
      .where(eq(characterPacks.id, character.currentPackId))
      .get()
    return row ? toPack(row) : undefined
  }

  /** 所有版本，舊的在前。 */
  packs(characterId: string): CharacterPack[] {
    return this.db
      .select()
      .from(characterPacks)
      .where(eq(characterPacks.characterId, characterId))
      .orderBy(asc(characterPacks.version))
      .all()
      .map(toPack)
  }

  /** 存固定外觀描述（草稿）。目前這一版已鎖定的話，會另外開下一版草稿，舊版保留。 */
  setAnchor(characterId: string, text: string): CharacterPack {
    if (!this.get(characterId)) throw notFound(characterId)
    return this.db.transaction((tx) => {
      const draft = this.draftPack(tx, characterId)
      tx.update(characterPacks)
        .set({ anchorText: text.trim() })
        .where(eq(characterPacks.id, draft.id))
        .run()
      return { ...draft, anchorText: text.trim() }
    })
  }

  /** 鎖定目前這一版。固定外觀描述是空的不能鎖；已經鎖定就直接回傳。 */
  lock(characterId: string): CharacterPack {
    const current = this.pack(characterId)
    if (!current || current.anchorText.trim() === '') {
      throw new AppError({
        code: 'invalid_request',
        userMessage: '還沒有固定外觀描述，請先寫一段（或請 AI 幫你整理）再鎖定。',
      })
    }
    if (current.status === 'locked') return current
    this.db
      .update(characterPacks)
      .set({ status: 'locked' })
      .where(eq(characterPacks.id, current.id))
      .run()
    return { ...current, status: 'locked' }
  }

  /**
   * 以舊版本的內容當作目前的草稿：目前已鎖定就開下一版草稿，目前已經是草稿就直接換成那一版的內容。
   * 舊版本本身不會被改動。
   */
  restorePack(characterId: string, packId: string): CharacterPack {
    const source = this.packs(characterId).find((p) => p.id === packId)
    if (!source) {
      throw new AppError({ code: 'invalid_request', userMessage: '找不到這個版本。' })
    }
    // 已經是目前這一版就不用做事
    if (this.pack(characterId)?.id === source.id) return source
    return this.db.transaction((tx) => {
      const draft = this.draftPack(tx, characterId)
      const restored = CharacterPackSchema.parse({
        ...draft,
        anchorText: source.anchorText,
        ...(source.heroAssetHash ? { heroAssetHash: source.heroAssetHash } : {}),
        ...(source.turnaround ? { turnaround: source.turnaround } : {}),
      })
      tx.update(characterPacks)
        .set({
          anchorText: restored.anchorText,
          heroAssetHash: restored.heroAssetHash ?? null,
          turnaround: restored.turnaround ?? null,
        })
        .where(eq(characterPacks.id, draft.id))
        .run()
      return restored
    })
  }

  // ── 概念圖與主圖 ──────────────────────────────────

  /** 所有概念圖，新的一輪在前。 */
  listConcepts(characterId: string): ConceptView[] {
    return this.db
      .select()
      .from(characterConcepts)
      .where(eq(characterConcepts.characterId, characterId))
      .orderBy(desc(characterConcepts.round), asc(characterConcepts.slot))
      .all()
      .map(toConcept)
  }

  /** 下一輪的編號（還沒有任何概念圖就是 1）。 */
  nextConceptRound(characterId: string): number {
    const row = this.db
      .select({ round: sql<number>`coalesce(max(${characterConcepts.round}), 0)` })
      .from(characterConcepts)
      .where(eq(characterConcepts.characterId, characterId))
      .get()
    return (row?.round ?? 0) + 1
  }

  addConcept(input: {
    characterId: string
    round: number
    slot: number
    assetHash: string
    modelId: string
  }): ConceptView {
    if (!this.get(input.characterId)) throw notFound(input.characterId)
    const concept: ConceptView = {
      id: randomUUID(),
      round: input.round,
      assetHash: input.assetHash,
      modelId: input.modelId,
      createdAt: this.now().toISOString(),
    }
    this.db
      .insert(characterConcepts)
      .values({ ...concept, characterId: input.characterId, slot: input.slot })
      .run()
    return concept
  }

  /** 拿掉某個模型（例如「upload」接上來的圖）產生的、檔案相同的概念圖。 */
  removeConcepts(characterId: string, assetHash: string, modelId: string): void {
    this.db
      .delete(characterConcepts)
      .where(
        and(
          eq(characterConcepts.characterId, characterId),
          eq(characterConcepts.assetHash, assetHash),
          eq(characterConcepts.modelId, modelId),
        ),
      )
      .run()
  }

  /** 把一張概念圖挑成主圖。已鎖定的話會另外開下一版草稿，舊版保留。 */
  pickHero(characterId: string, conceptId: string): CharacterPack {
    const concept = this.db
      .select()
      .from(characterConcepts)
      .where(eq(characterConcepts.id, conceptId))
      .get()
    if (concept?.characterId !== characterId) {
      throw new AppError({ code: 'invalid_request', userMessage: '找不到這張概念圖。' })
    }
    const current = this.pack(characterId)
    // 本來就是這張：什麼都不用改（鎖定的版本也不會被退回草稿）
    if (current?.heroAssetHash === concept.assetHash) return current
    return this.db.transaction((tx) => {
      const draft = this.draftPack(tx, characterId)
      if (draft.heroAssetHash !== concept.assetHash) {
        tx.update(characterPacks)
          .set({ heroAssetHash: concept.assetHash })
          .where(eq(characterPacks.id, draft.id))
          .run()
      }
      return { ...draft, heroAssetHash: concept.assetHash }
    })
  }

  // ── 三視圖 ────────────────────────────────────────

  /** 所有三視圖候選，新的一輪在前。 */
  listTurnarounds(characterId: string): TurnaroundView[] {
    return this.db
      .select()
      .from(characterTurnarounds)
      .where(eq(characterTurnarounds.characterId, characterId))
      .orderBy(desc(characterTurnarounds.round), asc(characterTurnarounds.slot))
      .all()
      .map(toTurnaround)
  }

  nextTurnaroundRound(characterId: string): number {
    const row = this.db
      .select({ round: sql<number>`coalesce(max(${characterTurnarounds.round}), 0)` })
      .from(characterTurnarounds)
      .where(eq(characterTurnarounds.characterId, characterId))
      .get()
    return (row?.round ?? 0) + 1
  }

  addTurnaround(input: {
    characterId: string
    round: number
    slot: number
    sheetHash: string
    frontHash: string
    sideHash: string
    backHash: string
    cuts: TurnaroundCuts
    heroHash: string
    modelId: string
  }): TurnaroundView {
    if (!this.get(input.characterId)) throw notFound(input.characterId)
    const row = {
      id: randomUUID(),
      characterId: input.characterId,
      round: input.round,
      slot: input.slot,
      sheetHash: input.sheetHash,
      frontHash: input.frontHash,
      sideHash: input.sideHash,
      backHash: input.backHash,
      cutA: input.cuts.a,
      cutB: input.cuts.b,
      heroHash: input.heroHash,
      modelId: input.modelId,
      createdAt: this.now().toISOString(),
    }
    this.db.insert(characterTurnarounds).values(row).run()
    return toTurnaround(row)
  }

  getTurnaround(characterId: string, turnaroundId: string): TurnaroundView | undefined {
    const row = this.db
      .select()
      .from(characterTurnarounds)
      .where(eq(characterTurnarounds.id, turnaroundId))
      .get()
    return row?.characterId === characterId ? toTurnaround(row) : undefined
  }

  /** 用新的切線位置與切出來的三張圖更新這組候選。 */
  updateTurnaroundSlices(
    characterId: string,
    turnaroundId: string,
    slices: { frontHash: string; sideHash: string; backHash: string; cuts: TurnaroundCuts },
  ): TurnaroundView {
    const current = this.getTurnaround(characterId, turnaroundId)
    if (!current) throw new AppError({ code: 'invalid_request', userMessage: '找不到這組三視圖。' })
    this.db
      .update(characterTurnarounds)
      .set({
        frontHash: slices.frontHash,
        sideHash: slices.sideHash,
        backHash: slices.backHash,
        cutA: slices.cuts.a,
        cutB: slices.cuts.b,
      })
      .where(eq(characterTurnarounds.id, turnaroundId))
      .run()
    return { ...current, ...slices }
  }

  /** 採用一組三視圖。已鎖定的角色會變成下一版草稿；本來就是這組就不動。 */
  adoptTurnaround(characterId: string, turnaroundId: string): CharacterPack {
    const chosen = this.getTurnaround(characterId, turnaroundId)
    if (!chosen) throw new AppError({ code: 'invalid_request', userMessage: '找不到這組三視圖。' })
    const picked = { front: chosen.frontHash, side: chosen.sideHash, back: chosen.backHash }
    const current = this.pack(characterId)
    const same =
      current?.turnaround?.front === picked.front &&
      current.turnaround.side === picked.side &&
      current.turnaround.back === picked.back
    if (current && same) return current
    return this.db.transaction((tx) => {
      const draft = this.draftPack(tx, characterId)
      tx.update(characterPacks)
        .set({ turnaround: picked })
        .where(eq(characterPacks.id, draft.id))
        .run()
      return { ...draft, turnaround: picked }
    })
  }

  /** 目前是草稿就沿用；沒有或已鎖定就建立下一版草稿（內容沿用上一版）並設成目前版本。 */
  private draftPack(db: Pick<AppDb, 'select' | 'insert' | 'update'>, characterId: string) {
    const character = db.select().from(characters).where(eq(characters.id, characterId)).get()
    const row = character?.currentPackId
      ? db.select().from(characterPacks).where(eq(characterPacks.id, character.currentPackId)).get()
      : undefined
    if (row?.status === 'draft') return toPack(row)
    if (!character || (character.currentPackId && !row)) throw notFound(characterId)
    const previous = row ? toPack(row) : undefined
    const next = CharacterPackSchema.parse({
      id: randomUUID(),
      characterId,
      version: (previous?.version ?? 0) + 1,
      status: 'draft',
      anchorText: previous?.anchorText ?? '',
      ...(previous?.heroAssetHash ? { heroAssetHash: previous.heroAssetHash } : {}),
      ...(previous?.turnaround ? { turnaround: previous.turnaround } : {}),
      createdAt: this.now().toISOString(),
    })
    db.insert(characterPacks).values(toPackRow(next)).run()
    db.update(characters)
      .set({ currentPackId: next.id })
      .where(eq(characters.id, characterId))
      .run()
    return next
  }

  delete(id: string): void {
    if (!this.get(id)) return
    this.db.delete(characters).where(eq(characters.id, id)).run()
  }
}

function withOutfit(costumes: readonly Costume[], description: string): Costume[] {
  const [first, ...others] = costumes
  if (!first) {
    return description === '' ? [] : [{ id: randomUUID(), name: DEFAULT_COSTUME_NAME, description }]
  }
  return [{ ...first, description }, ...others]
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

type CharacterRow = typeof characters.$inferSelect
type PackRow = typeof characterPacks.$inferSelect

function toTurnaround(row: typeof characterTurnarounds.$inferSelect): TurnaroundView {
  return {
    id: row.id,
    round: row.round,
    sheetHash: row.sheetHash,
    frontHash: row.frontHash,
    sideHash: row.sideHash,
    backHash: row.backHash,
    cuts: { a: row.cutA, b: row.cutB },
    modelId: row.modelId,
    createdAt: row.createdAt,
  }
}

function toConcept(row: typeof characterConcepts.$inferSelect): ConceptView {
  return {
    id: row.id,
    round: row.round,
    assetHash: row.assetHash,
    modelId: row.modelId,
    createdAt: row.createdAt,
  }
}

function toPack(row: PackRow): CharacterPack {
  return CharacterPackSchema.parse(dropNulls(row))
}

function toPackRow(pack: CharacterPack): PackRow {
  return {
    id: pack.id,
    characterId: pack.characterId,
    version: pack.version,
    status: pack.status,
    anchorText: pack.anchorText,
    heroAssetHash: pack.heroAssetHash ?? null,
    turnaround: pack.turnaround ?? null,
    createdAt: pack.createdAt,
  }
}

function toCharacter(row: CharacterRow): Character {
  return CharacterSchema.parse(dropNulls(row))
}

function toRow(character: Character): CharacterRow {
  return {
    id: character.id,
    projectId: character.projectId,
    name: character.name,
    age: character.age ?? null,
    personality: character.personality,
    appearance: character.appearance,
    costumes: character.costumes,
    styleId: character.styleId ?? null,
    voices: character.voices,
    currentPackId: character.currentPackId ?? null,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
  }
}
