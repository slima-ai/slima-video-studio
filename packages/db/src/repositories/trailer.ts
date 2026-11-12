import {
  AppError,
  TrailerSettingsPatchSchema,
  TrailerSettingsSchema,
  t,
  type TrailerSettings,
  type TrailerSettingsPatch,
} from '@svs/schema'
import { eq } from 'drizzle-orm'

import type { AppDb } from '../database'
import { trailerSettings } from '../tables/trailer'

/** 預告片設定：每個專案最多一份。沒有就是一般專案。 */
export class TrailerRepository {
  constructor(
    private readonly db: AppDb,
    private readonly projectId: string,
  ) {}

  /** 這個專案的預告片設定；不是預告片專案就是 undefined。存的資料壞了也當成沒有。 */
  get(): TrailerSettings | undefined {
    const row = this.db
      .select()
      .from(trailerSettings)
      .where(eq(trailerSettings.projectId, this.projectId))
      .get()
    if (!row) return undefined
    const parsed = TrailerSettingsSchema.safeParse(row.settings)
    return parsed.success ? parsed.data : undefined
  }

  /**
   * 逐項合併，驗證後存回；回傳合併後的設定。第一次呼叫會建立這份設定（沒給的欄位用預設值：30 秒、劇情型）。
   * 沒提到的欄位（包括明確傳 undefined）不動；封面傳 null 代表拿掉。
   */
  update(patch: TrailerSettingsPatch): TrailerSettings {
    const parsedPatch = TrailerSettingsPatchSchema.safeParse(patch)
    if (!parsedPatch.success) throw invalid()
    const { coverAssetHash, sceneId, soundAutoAddedAt, ...rest } = parsedPatch.data
    const given = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
    const {
      coverAssetHash: currentCover,
      sceneId: currentScene,
      soundAutoAddedAt: currentSound,
      ...current
    } = this.get() ?? TrailerSettingsSchema.parse({})
    const cover = coverAssetHash === undefined ? currentCover : (coverAssetHash ?? undefined)
    const scene = sceneId === undefined ? currentScene : (sceneId ?? undefined)
    const sound = soundAutoAddedAt === undefined ? currentSound : (soundAutoAddedAt ?? undefined)
    const next = TrailerSettingsSchema.safeParse({
      ...current,
      ...given,
      ...(cover === undefined ? {} : { coverAssetHash: cover }),
      ...(scene === undefined ? {} : { sceneId: scene }),
      ...(sound === undefined ? {} : { soundAutoAddedAt: sound }),
    })
    if (!next.success) throw invalid()
    this.db
      .insert(trailerSettings)
      .values({ id: this.projectId, projectId: this.projectId, settings: next.data })
      .onConflictDoUpdate({ target: trailerSettings.projectId, set: { settings: next.data } })
      .run()
    return next.data
  }

  /** 拿掉預告片設定，專案變回一般專案（鏡頭不動）。 */
  remove(): void {
    this.db.delete(trailerSettings).where(eq(trailerSettings.projectId, this.projectId)).run()
  }
}

const invalid = (): AppError =>
  new AppError({ code: 'invalid_request', userMessage: t('trailer.invalidSettings') })
