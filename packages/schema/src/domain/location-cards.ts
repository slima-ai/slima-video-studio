import { z } from 'zod'

import { ContentHashSchema, IdSchema, IsoDateTimeSchema, LockStatusSchema } from './common'
import { ConceptViewSchema } from './characters'

/** 每一輪生成幾張場景概念圖。 */
export const LOCATION_CONCEPTS_PER_ROUND = 4

/** 場景卡主圖之外的兩個角度：從另一側看、拉遠的全景。 */
export const LOCATION_ANGLES = ['reverse', 'wide'] as const
export const LocationAngleSchema = z.enum(LOCATION_ANGLES)
export type LocationAngle = z.infer<typeof LocationAngleSchema>

/**
 * 場景參考圖的用途。參考圖是一份「有用途標記的清單」（跟角色的參考圖同一個形狀）：同一個地點可以有主景、
 * 反方向、拉遠全景、俯視、縱深感……好幾張。資料庫裡用途存成文字，之後多一種用途不需要遷移；
 * 讀到不認得的用途（較新版本存的）一律當成 general。
 * main／reverse／wide 就是場景卡本來的三張圖；top_down、depth 是之後多的：俯視圖（看得到格局）、
 * 有縱深感的環境圖（前景到遠景層次分明）。
 */
export const LOCATION_REFERENCE_PURPOSES = [
  'main',
  'reverse',
  'wide',
  'top_down',
  'depth',
  'general',
] as const
export const LocationReferencePurposeSchema = z.enum(LOCATION_REFERENCE_PURPOSES)
export type LocationReferencePurpose = z.infer<typeof LocationReferencePurposeSchema>

/** 用途的白話名稱（畫面與給圖片模型的說明都用這份）。 */
export const LOCATION_REFERENCE_PURPOSE_LABELS: Readonly<Record<LocationReferencePurpose, string>> =
  {
    main: '主景',
    reverse: '反方向',
    wide: '拉遠全景',
    top_down: '俯視',
    depth: '縱深感',
    general: '一般',
  }

/** 一張參考圖的備註上限（一句白話，例如「從上面看的格局」）。 */
export const LOCATION_REFERENCE_LABEL_MAX = 60

export const LocationReferenceViewSchema = z.object({
  /** 場景卡本來的三張圖（source 是 card）沒有自己的 id，用 `card:<用途>`。 */
  id: z.string().min(1),
  assetHash: ContentHashSchema,
  purpose: LocationReferencePurposeSchema,
  label: z.string(),
  createdAt: IsoDateTimeSchema.optional(),
  /**
   * added：用「加參考圖」存的（可以移除）；
   * card：場景卡本來的主圖與兩個角度（要在場景卡上換圖、不能在這裡移除）。
   */
  source: z.enum(['added', 'card']),
})
export type LocationReferenceView = z.infer<typeof LocationReferenceViewSchema>

/** 某個場景卡的參考圖清單。 */
export const LocationReferencesStateSchema = z.object({
  locationId: IdSchema,
  references: z.array(LocationReferenceViewSchema),
})
export type LocationReferencesState = z.infer<typeof LocationReferencesStateSchema>

/** 場景卡：一個地點固定的樣子（鎖定後，用到這個地點的鏡頭會自動帶入描述與參考圖）。 */
export const LocationCardViewSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** 故事裡對這個地點的說明（在大綱裡填的）。 */
  description: z.string(),
  /** 固定的場景描述：鎖定之後，每個用到這個地點的鏡頭都會原封不動帶入。 */
  anchorText: z.string(),
  status: LockStatusSchema,
  /** 主場景圖（從概念圖挑出來的）。 */
  mainAssetHash: ContentHashSchema.optional(),
  /** 另外兩個角度；還沒生成就沒有。 */
  angles: z.object({
    reverse: ContentHashSchema.optional(),
    wide: ContentHashSchema.optional(),
  }),
})
export type LocationCardView = z.infer<typeof LocationCardViewSchema>

/** 某個場景卡的概念圖與目前的生成進度（完整快照）。 */
export const LocationImagesStateSchema = z.object({
  locationId: IdSchema,
  /** 新的在前。 */
  concepts: z.array(ConceptViewSchema),
  /** 正在生成：概念圖或另外兩個角度。 */
  generating: z
    .object({
      kind: z.enum(['concepts', 'angles']),
      done: z.number().int().nonnegative(),
      total: z.number().int().positive(),
    })
    .optional(),
  /** 最近一次生成沒有完全成功的原因（白話）。 */
  error: z.string().optional(),
})
export type LocationImagesState = z.infer<typeof LocationImagesStateSchema>

export const LocationGenerateKindSchema = z.enum(['concepts', 'angles'])
export type LocationGenerateKind = z.infer<typeof LocationGenerateKindSchema>

/** 固定場景描述的長度上限。 */
export const LOCATION_ANCHOR_MAX = 1000
