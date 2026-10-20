import { z } from 'zod'

import { AppErrorShapeSchema } from '../errors'
import { ContentHashSchema, IdSchema, IsoDateTimeSchema, UsdSchema } from './common'

export const AssetKindSchema = z.enum(['image', 'video', 'audio', 'other'])
export type AssetKind = z.infer<typeof AssetKindSchema>

/** 素材庫中的一個檔案，以內容雜湊為主鍵。 */
export const AssetSchema = z.object({
  hash: ContentHashSchema,
  kind: AssetKindSchema,
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().nonnegative().optional(),
  createdAt: IsoDateTimeSchema,
})
export type Asset = z.infer<typeof AssetSchema>

export const RunStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled'])
export type RunStatus = z.infer<typeof RunStatusSchema>

/** 一次工作流執行。 */
export const RunSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  workflowId: IdSchema,
  status: RunStatusSchema,
  estimatedCostUsd: UsdSchema.default(0),
  actualCostUsd: UsdSchema.default(0),
  startedAt: IsoDateTimeSchema.optional(),
  finishedAt: IsoDateTimeSchema.optional(),
  createdAt: IsoDateTimeSchema,
})
export type Run = z.infer<typeof RunSchema>

export const NodeRunStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'cached',
  'failed',
  /** 上游失敗，所以沒有執行。 */
  'blocked',
  'cancelled',
])
export type NodeRunStatus = z.infer<typeof NodeRunStatusSchema>

export const NodeRunSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  nodeId: IdSchema,
  /** 「對每個鏡頭執行」展開時，子 Run 指向父節點的 NodeRun。 */
  parentNodeRunId: IdSchema.optional(),
  status: NodeRunStatusSchema,
  /** sha256(節點類型 + 版本 + 正規化參數 + 上游輸出雜湊 + 模型 ID + seed)。 */
  cacheKey: ContentHashSchema,
  /** 輸出內容的雜湊，下游節點的快取鍵會用到。 */
  outputHash: ContentHashSchema.optional(),
  output: z.unknown().optional(),
  error: AppErrorShapeSchema.optional(),
  startedAt: IsoDateTimeSchema.optional(),
  finishedAt: IsoDateTimeSchema.optional(),
})
export type NodeRun = z.infer<typeof NodeRunSchema>

export const JobStatusSchema = z.enum([
  'queued',
  'running',
  'submitted',
  'polling',
  'succeeded',
  'failed',
  'cancelled',
])
export type JobStatus = z.infer<typeof JobStatusSchema>

export const JobKindSchema = z.enum(['llm', 'image', 'video', 'tts', 'music', 'other'])
export type JobKind = z.infer<typeof JobKindSchema>

/** 送給供應商的一個任務。長任務送出後只存 providerJobId，用輪詢回收。 */
export const JobSchema = z.object({
  id: IdSchema,
  nodeRunId: IdSchema.optional(),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  kind: JobKindSchema,
  status: JobStatusSchema,
  providerJobId: z.string().optional(),
  /** 送給供應商的請求內容。App 重開後，還在排隊的任務要靠它重新送出。 */
  input: z.unknown().optional(),
  /** 供應商回傳的結果（通常是檔案網址或文字，由呼叫端解讀）。 */
  output: z.unknown().optional(),
  /** 供應商回報的實際花費（沒有就不填，之後由預算模組估算）。 */
  costUsd: UsdSchema.optional(),
  attempt: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(3),
  /** 下次可以執行（退避重試）的時間。 */
  nextRunAt: IsoDateTimeSchema.optional(),
  error: AppErrorShapeSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})
export type Job = z.infer<typeof JobSchema>

/** 花費帳本。優先用供應商回傳的金額，沒有時用估算值並標記 estimated。 */
export const CostEntrySchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  runId: IdSchema.optional(),
  jobId: IdSchema.optional(),
  /** 這筆花費屬於哪個節點執行（節點圖用來算每個節點花了多少）。 */
  nodeRunId: IdSchema.optional(),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  amountUsd: UsdSchema,
  estimated: z.boolean(),
  createdAt: IsoDateTimeSchema,
})
export type CostEntry = z.infer<typeof CostEntrySchema>
