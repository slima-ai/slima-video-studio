import { z } from 'zod'

import { IsoDateTimeSchema, UsdSchema } from './common'
import { JobKindSchema, JobStatusSchema } from './execution'

/**
 * 給畫面顯示的任務摘要：只有進度、花費與整理過的失敗原因，
 * 不含完整請求與供應商回傳內容（那些留在主行程）。
 */
export const JobSummarySchema = z.object({
  id: z.string(),
  provider: z.string(),
  modelId: z.string(),
  kind: JobKindSchema,
  status: JobStatusSchema,
  /** 這個任務的描述（Prompt 開頭一小段），方便辨認是哪一個鏡頭。 */
  promptPreview: z.string().optional(),
  /** 這個任務屬於哪一步，例如「第 2 鏡」；對不到鏡頭就沒有。 */
  stepLabel: z.string().optional(),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  /** 失敗後排定重試的時間。 */
  nextRunAt: IsoDateTimeSchema.optional(),
  costUsd: UsdSchema.optional(),
  error: z.object({ userMessage: z.string(), retryable: z.boolean() }).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})
export type JobSummary = z.infer<typeof JobSummarySchema>
