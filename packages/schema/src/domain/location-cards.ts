import { z } from 'zod'

import { ContentHashSchema, IdSchema, LockStatusSchema } from './common'
import { ConceptViewSchema } from './characters'

/** 每一輪生成幾張場景概念圖。 */
export const LOCATION_CONCEPTS_PER_ROUND = 4

/** 場景卡主圖之外的兩個角度：從另一側看、拉遠的全景。 */
export const LOCATION_ANGLES = ['reverse', 'wide'] as const
export const LocationAngleSchema = z.enum(LOCATION_ANGLES)
export type LocationAngle = z.infer<typeof LocationAngleSchema>

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
