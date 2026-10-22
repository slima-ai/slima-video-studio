import { z } from 'zod'

import { ContentHashSchema, IdSchema } from './common'

/** 一個鏡頭最多釘選幾張參考圖（再多，圖片模型也收不下；實際上限看目前的圖片模型）。 */
export const SHOT_PIN_MAX = 12

/**
 * 鏡頭可以用的一張參考圖：來自這一鏡出場角色的圖（主圖、三視圖、另外加的參考圖）或這一鏡地點的圖
 * （主景、角度、另外加的參考圖）。同一張圖在清單裡只出現一次（以檔案雜湊認）。
 */
export const ShotReferenceItemSchema = z.object({
  assetHash: ContentHashSchema,
  /** 圖屬於角色還是地點。 */
  ownerKind: z.enum(['character', 'location']),
  ownerName: z.string(),
  /** 用途（白話，例如「臉」「主景」「正面」）。 */
  purpose: z.string(),
  /** 備註（另外加參考圖時寫的一句話）；沒有就是空字串。 */
  label: z.string(),
})
export type ShotReferenceItem = z.infer<typeof ShotReferenceItemSchema>

/**
 * 某一鏡的參考圖現況：實際會帶進去的（picked）、可以挑的（candidates）、最多幾張（limit）。
 * auto＝沒有手動指定（系統依景別與角度自動挑）；false＝使用者（或 AI 助理）釘選了，就只帶釘選的。
 * picked 與生成時送出的是同一份，所以畫面上看到的就是實際會送的。
 */
export const ShotReferencesStateSchema = z.object({
  shotId: IdSchema,
  /** 目前的圖片模型最多收幾張；0＝這一鏡不會帶參考圖（reason 說明原因）。 */
  limit: z.number().int().nonnegative(),
  reason: z.string().optional(),
  auto: z.boolean(),
  picked: z.array(ShotReferenceItemSchema),
  candidates: z.array(ShotReferenceItemSchema),
})
export type ShotReferencesState = z.infer<typeof ShotReferencesStateSchema>
