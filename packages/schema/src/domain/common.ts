import { z } from 'zod'

/** 實體 ID（由 db 層以 UUID 產生）。 */
export const IdSchema = z.string().min(1)
export type Id = z.infer<typeof IdSchema>

/** ISO 8601 時間字串（UTC），例如 2026-10-12T07:36:49.000Z。 */
export const IsoDateTimeSchema = z.iso.datetime()
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>

/** 內容雜湊（sha256，十六進位小寫）。素材庫以它當檔名。 */
export const ContentHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, '必須是 64 碼的 sha256 十六進位字串')
export type ContentHash = z.infer<typeof ContentHashSchema>

export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1', '4:3', '21:9'])
export type AspectRatio = z.infer<typeof AspectRatioSchema>

/** 美金金額（供應商大多以 USD 計價）。 */
export const UsdSchema = z.number().nonnegative()

/** 資料的鎖定狀態：草稿可改；鎖定後修改會退回草稿並需要重新鎖定。 */
export const LockStatusSchema = z.enum(['draft', 'locked'])
export type LockStatus = z.infer<typeof LockStatusSchema>
