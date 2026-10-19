import { z } from 'zod'

import { ContentHashSchema, IdSchema, IsoDateTimeSchema } from './common'
import { JobKindSchema, JobStatusSchema } from './execution'

/** 這次生成的東西後來放在哪裡：哪個鏡頭、哪個角色、哪個場景卡。 */
export const RecordTargetSchema = z.object({
  type: z.enum(['shot', 'character', 'location']),
  id: IdSchema,
  /** 白話名稱：「第 3 鏡」「阿鐵」「老舊的車站」。 */
  label: z.string(),
})
export type RecordTarget = z.infer<typeof RecordTargetSchema>

export const RecordResultSchema = z.object({
  kind: z.enum(['image', 'video']),
  hash: ContentHashSchema,
})
export type RecordResult = z.infer<typeof RecordResultSchema>

/** 生成紀錄的一筆：每送出一次給模型的請求就是一筆（成功、失敗、取消都有）。 */
export const GenerationRecordSchema = z.object({
  id: IdSchema,
  createdAt: IsoDateTimeSchema,
  kind: JobKindSchema,
  status: JobStatusSchema,
  modelId: z.string(),
  /** 白話模型名；找不到就是原始 id。 */
  modelName: z.string(),
  /** 實際送給模型的 prompt（文字模型是最後一則使用者訊息）。 */
  prompt: z.string().optional(),
  /** 其他設定的白話說明：比例、秒數、有聲、參考圖張數、變化編號…… */
  params: z.array(z.string()),
  durationMs: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  /** 花費是估算的（供應商沒有回報實際金額）。 */
  costEstimated: z.boolean().optional(),
  error: z.string().optional(),
  result: RecordResultSchema.optional(),
  target: RecordTargetSchema.optional(),
  /** 可以直接「用這段 prompt 再生成一次」：目前只有鏡頭的圖片與影片。 */
  canRedo: z.boolean(),
})
export type GenerationRecord = z.infer<typeof GenerationRecordSchema>

export const RecordsFilterSchema = z.object({
  kind: JobKindSchema.optional(),
  /** failed：只看失敗的；succeeded：只看成功的。 */
  outcome: z.enum(['succeeded', 'failed']).optional(),
  shotId: IdSchema.optional(),
})
export type RecordsFilter = z.infer<typeof RecordsFilterSchema>

export const RecordsSnapshotSchema = z.object({
  /** 新的在前。 */
  records: z.array(GenerationRecordSchema),
  /** 符合篩選的總筆數（畫面一次只給最近的一部分）。 */
  total: z.number().int().nonnegative(),
  /** 符合篩選的這些紀錄花了多少錢。 */
  totalCostUsd: z.number().nonnegative(),
})
export type RecordsSnapshot = z.infer<typeof RecordsSnapshotSchema>

export const RecordRedoRequestSchema = z.object({
  jobId: IdSchema,
  /** 改過的 prompt；沒給就用這一筆原本的。 */
  prompt: z.string().trim().min(1).optional(),
})
export type RecordRedoRequest = z.infer<typeof RecordRedoRequestSchema>
