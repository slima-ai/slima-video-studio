import { and, eq, isNull, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import {
  AppError,
  DEFAULT_SOUND_SETTINGS,
  SoundSettingsSchema,
  type SoundClip,
  type SoundClipKind,
  type SoundSettings,
  type SoundSettingsPatch,
} from '@svs/schema'

import type { AppDb } from '../database'
import { soundClips, soundSettings } from '../tables/sound'

export interface NewSoundClip {
  kind: SoundClipKind
  /** 旁白、音效要有；配樂不能有。 */
  shotId?: string | undefined
  assetHash: string
  durationSec?: number | undefined
  offsetSec?: number | undefined
  gainDb?: number | undefined
  fadeInSec?: number | undefined
  fadeOutSec?: number | undefined
  text?: string | undefined
  voiceId?: string | undefined
  modelId: string
  costUsd?: number | undefined
  costEstimated?: boolean | undefined
}

/** 可以事後調整的欄位；給 null 表示改回預設。 */
export interface SoundClipPatch {
  offsetSec?: number
  gainDb?: number | null
  fadeInSec?: number | null
  fadeOutSec?: number | null
}

type Row = typeof soundClips.$inferSelect

const toClip = (row: Row): SoundClip => ({
  id: row.id,
  kind: row.kind as SoundClipKind,
  ...(row.shotId === null ? {} : { shotId: row.shotId }),
  assetHash: row.assetHash,
  ...(row.durationSec === null ? {} : { durationSec: row.durationSec }),
  offsetSec: row.offsetSec,
  ...(row.gainDb === null ? {} : { gainDb: row.gainDb }),
  ...(row.fadeInSec === null ? {} : { fadeInSec: row.fadeInSec }),
  ...(row.fadeOutSec === null ? {} : { fadeOutSec: row.fadeOutSec }),
  text: row.text,
  ...(row.voiceId === null ? {} : { voiceId: row.voiceId }),
  modelId: row.modelId,
  ...(row.costUsd === null ? {} : { costUsd: row.costUsd }),
  costEstimated: row.costEstimated,
  version: row.version,
  adopted: row.adopted,
  createdAt: row.createdAt,
})

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/**
 * 聲音：每鏡的旁白、整支的配樂（版本與採用），以及專案的聲音設定。
 * 同一鏡的同一種類（配樂則是整個專案）每次生成多一個版本，新的版本自動變成採用中的。
 */
export class SoundRepository {
  constructor(
    private readonly db: AppDb,
    private readonly projectId: string,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  private group(kind: SoundClipKind, shotId: string | null) {
    return and(
      eq(soundClips.projectId, this.projectId),
      eq(soundClips.kind, kind),
      shotId === null ? isNull(soundClips.shotId) : eq(soundClips.shotId, shotId),
    )
  }

  /** 新增一個版本，並設為採用中（同組其他版本取消採用）。 */
  addClip(input: NewSoundClip): SoundClip {
    const shotId = input.shotId ?? null
    if (input.kind === 'music' && shotId !== null) throw invalid('配樂是整支的，不屬於某一鏡。')
    if (input.kind !== 'music' && shotId === null) throw invalid('旁白與音效要屬於某一鏡。')
    return this.db.transaction((tx) => {
      const where = and(
        eq(soundClips.projectId, this.projectId),
        eq(soundClips.kind, input.kind),
        shotId === null ? isNull(soundClips.shotId) : eq(soundClips.shotId, shotId),
      )
      const max = tx
        .select({ max: sql<number>`coalesce(max(${soundClips.version}), 0)` })
        .from(soundClips)
        .where(where)
        .get()
      tx.update(soundClips).set({ adopted: false }).where(where).run()
      const row: Row = {
        id: this.newId(),
        projectId: this.projectId,
        kind: input.kind,
        shotId,
        assetHash: input.assetHash,
        durationSec: input.durationSec ?? null,
        offsetSec: input.offsetSec ?? 0,
        gainDb: input.gainDb ?? null,
        fadeInSec: input.fadeInSec ?? null,
        fadeOutSec: input.fadeOutSec ?? null,
        text: input.text ?? '',
        voiceId: input.voiceId ?? null,
        modelId: input.modelId,
        costUsd: input.costUsd ?? null,
        costEstimated: input.costEstimated ?? false,
        version: (max?.max ?? 0) + 1,
        adopted: true,
        createdAt: this.now().toISOString(),
      }
      tx.insert(soundClips).values(row).run()
      return toClip(row)
    })
  }

  getClip(id: string): SoundClip | undefined {
    const row = this.db
      .select()
      .from(soundClips)
      .where(and(eq(soundClips.id, id), eq(soundClips.projectId, this.projectId)))
      .get()
    return row ? toClip(row) : undefined
  }

  /** 全部版本（種類、鏡頭、版本由小到大）；adoptedOnly 只列採用中的。 */
  listClips(options: { adoptedOnly?: boolean } = {}): SoundClip[] {
    const rows = this.db
      .select()
      .from(soundClips)
      .where(
        options.adoptedOnly
          ? and(eq(soundClips.projectId, this.projectId), eq(soundClips.adopted, true))
          : eq(soundClips.projectId, this.projectId),
      )
      .all()
    return rows
      .map(toClip)
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) ||
          (a.shotId ?? '').localeCompare(b.shotId ?? '') ||
          a.version - b.version,
      )
  }

  updateClip(id: string, patch: SoundClipPatch): SoundClip {
    const current = this.getClip(id)
    if (!current) throw invalid('找不到這個聲音片段。')
    if (patch.offsetSec !== undefined && !(patch.offsetSec >= 0)) {
      throw invalid('起點偏移不能是負的。')
    }
    this.db
      .update(soundClips)
      .set({
        ...(patch.offsetSec === undefined ? {} : { offsetSec: patch.offsetSec }),
        ...(patch.gainDb === undefined ? {} : { gainDb: patch.gainDb }),
        ...(patch.fadeInSec === undefined ? {} : { fadeInSec: patch.fadeInSec }),
        ...(patch.fadeOutSec === undefined ? {} : { fadeOutSec: patch.fadeOutSec }),
      })
      .where(eq(soundClips.id, id))
      .run()
    const next = this.getClip(id)
    if (!next) throw invalid('找不到這個聲音片段。')
    return next
  }

  /** 把某個版本設為採用中（同組其他版本取消採用）。 */
  adoptClip(id: string): SoundClip {
    const clip = this.getClip(id)
    if (!clip) throw invalid('找不到這個聲音片段。')
    this.db.transaction((tx) => {
      const where = and(
        eq(soundClips.projectId, this.projectId),
        eq(soundClips.kind, clip.kind),
        clip.shotId === undefined ? isNull(soundClips.shotId) : eq(soundClips.shotId, clip.shotId),
      )
      tx.update(soundClips).set({ adopted: false }).where(where).run()
      tx.update(soundClips).set({ adopted: true }).where(eq(soundClips.id, id)).run()
    })
    return { ...clip, adopted: true }
  }

  /** 刪除一個版本；刪的是採用中的，就改採用同組最新的剩餘版本。 */
  removeClip(id: string): void {
    const clip = this.getClip(id)
    if (!clip) return
    this.db.transaction((tx) => {
      tx.delete(soundClips).where(eq(soundClips.id, id)).run()
      if (!clip.adopted) return
      const rest = tx
        .select()
        .from(soundClips)
        .where(this.group(clip.kind, clip.shotId ?? null))
        .all()
        .sort((a, b) => b.version - a.version)[0]
      if (rest) tx.update(soundClips).set({ adopted: true }).where(eq(soundClips.id, rest.id)).run()
    })
  }

  getSettings(): SoundSettings {
    const row = this.db
      .select()
      .from(soundSettings)
      .where(eq(soundSettings.projectId, this.projectId))
      .get()
    if (!row) return DEFAULT_SOUND_SETTINGS
    const parsed = SoundSettingsSchema.safeParse(row.settings)
    return parsed.success ? parsed.data : DEFAULT_SOUND_SETTINGS
  }

  /** 逐項合併，驗證後存回；回傳合併後的設定。 */
  updateSettings(patch: SoundSettingsPatch): SoundSettings {
    // 沒提到的欄位（undefined）不能蓋掉原值
    const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    const next = SoundSettingsSchema.safeParse({ ...this.getSettings(), ...given })
    if (!next.success) throw invalid('聲音設定的內容不對。')
    this.db
      .insert(soundSettings)
      .values({ projectId: this.projectId, settings: next.data })
      .onConflictDoUpdate({ target: soundSettings.projectId, set: { settings: next.data } })
      .run()
    return next.data
  }
}
