import { z } from 'zod'

import { ContentHashSchema, IdSchema, IsoDateTimeSchema } from './common'
import { ShotAngleSchema, ShotSizeSchema, ShotStatusSchema, TakeKindSchema } from './story'

/** 一個鏡頭的生成結果版本（首幀圖或影片）。 */
export const TakeViewSchema = z.object({
  id: IdSchema,
  kind: TakeKindSchema,
  /** 同一鏡頭同一種類內從 1 開始。 */
  version: z.number().int().positive(),
  assetHash: ContentHashSchema,
  /** 目前採用的版本（接片時只用採用中的影片）。 */
  adopted: z.boolean(),
  /** 用哪個模型生成的（白話名稱由畫面查；找不到就顯示原始 id）。 */
  modelId: z.string(),
  /** 這個版本的「變化編號」，重新生成時會加一。 */
  seed: z.number().int().optional(),
  createdAt: IsoDateTimeSchema,
  /** 生成這個版本花了多久（毫秒）；沿用舊檔案或匯入的版本沒有。 */
  durationMs: z.number().int().nonnegative().optional(),
  /** 這個版本的花費（美元）；沒有回報也沒有估算就沒有。 */
  costUsd: z.number().nonnegative().optional(),
  /** 花費是估算的（供應商沒有回報實際金額）。 */
  costEstimated: z.boolean().optional(),
})
export type TakeView = z.infer<typeof TakeViewSchema>

/** 鏡頭目前正在做的事；沒有在做事就沒有這個欄位。 */
export const ShotActivitySchema = z.object({
  step: z.enum(['prompt', 'image', 'video']),
})
export type ShotActivity = z.infer<typeof ShotActivitySchema>

export const ShotViewSchema = z.object({
  id: IdSchema,
  /** 鏡號（從 1 開始）。 */
  number: z.number().int().positive(),
  description: z.string(),
  /** 運鏡的白話描述；固定鏡頭是 null。 */
  cameraMove: z.string().nullable(),
  durationSec: z.number().positive(),
  /** 出場角色的名字。 */
  characters: z.array(z.string()),
  /** 景別與拍攝角度。 */
  size: ShotSizeSchema,
  angle: ShotAngleSchema,
  dialogue: z.string(),
  /** 屬於大綱裡的哪一個場；不屬於任何場就沒有。 */
  sceneId: IdSchema.optional(),
  locationId: IdSchema.optional(),
  lighting: z.string().optional(),
  timeOfDay: z.string().optional(),
  mood: z.string().optional(),
  /** 出場角色裡已經鎖定的，連同目前鎖定的版本號（生成時會帶入它們的固定外觀與參考圖）。 */
  lockedCharacters: z
    .array(z.object({ name: z.string(), version: z.number().int().positive() }))
    .optional(),
  /** 要不要放進成品（沒有這個欄位就是要）。 */
  inCut: z.boolean().optional(),
  /** 使用者手動改過的 Prompt；沒改過就沒有這個欄位。 */
  prompt: z.string().optional(),
  /** 由鏡頭內容自動組出的 Prompt（沒有手動改過時實際送出的內容）。 */
  autoPrompt: z.string(),
  status: ShotStatusSchema,
  activity: ShotActivitySchema.optional(),
  /** 最近一次失敗的原因（白話）。 */
  error: z.string().optional(),
  firstFrames: z.array(TakeViewSchema),
  videos: z.array(TakeViewSchema),
})
export type ShotView = z.infer<typeof ShotViewSchema>

export const ShotsSnapshotSchema = z.object({
  shots: z.array(ShotViewSchema),
  /** 目前接好的完整影片（還沒接過就沒有）。 */
  finalVideoHash: ContentHashSchema.optional(),
})
export type ShotsSnapshot = z.infer<typeof ShotsSnapshotSchema>

/** 使用者可以改的鏡頭欄位。prompt 傳 null 代表清掉手動修改、回到自動組出的內容。 */
export const ShotEditSchema = z.object({
  description: z.string().min(1).max(1000).optional(),
  cameraMove: z.string().max(100).nullable().optional(),
  durationSec: z.number().min(1).max(15).optional(),
  prompt: z.string().max(4000).nullable().optional(),
  size: ShotSizeSchema.optional(),
  angle: ShotAngleSchema.optional(),
  dialogue: z.string().max(2000).optional(),
  /** 出場角色的名字（整份換掉）。 */
  characters: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  /** null 代表清掉。 */
  sceneId: IdSchema.nullable().optional(),
  locationId: IdSchema.nullable().optional(),
  lighting: z.string().max(200).nullable().optional(),
  timeOfDay: z.string().max(100).nullable().optional(),
  mood: z.string().max(100).nullable().optional(),
  /** 要不要放進成品。 */
  inCut: z.boolean().optional(),
})
export type ShotEdit = z.infer<typeof ShotEditSchema>

/**
 * 重新生成的方式：
 * - apply：套用修改（改了描述或 Prompt 才會真的重做，沒改就沿用）
 * - video：只換一支新影片（首幀圖不動）
 * - all：整個鏡頭從頭換一組新的（首幀圖和影片都重新生成）
 * - frame：只換一張新的首幀圖（影片不生成、也不動；之後影片會變成「需要重跑」）
 */
export const RegenerateModeSchema = z.enum(['apply', 'video', 'all', 'frame'])
export type RegenerateMode = z.infer<typeof RegenerateModeSchema>

/** AI 依場次拆出來的一個鏡頭。 */
export const StoryboardShotSchema = z.object({
  description: z.string().min(1),
  size: ShotSizeSchema.default('medium'),
  angle: ShotAngleSchema.default('eye_level'),
  /** 運鏡預設的 ID；固定鏡頭是 null。 */
  cameraMove: z.string().nullable().default(null),
  durationSec: z.number().min(1).max(15).default(3),
  characters: z.array(z.string()).default([]),
  dialogue: z.string().default(''),
  lighting: z.string().nullable().default(null),
  mood: z.string().nullable().default(null),
})
export type StoryboardShot = z.infer<typeof StoryboardShotSchema>

/** 讓 AI 替某個場拆鏡頭之前的檢查與預估花費。 */
export const StoryboardSplitCheckSchema = z.object({
  ok: z.boolean(),
  issue: z.string().optional(),
  estimatedUsd: z.number().nonnegative(),
  modelName: z.string().optional(),
  demoMode: z.boolean(),
  /** 這個場已經有幾個鏡頭（拆完會換掉）。 */
  existingShots: z.number().int().nonnegative(),
  /** 其中已經生成過畫面或影片的有幾個（換掉就沒了）。 */
  generatedShots: z.number().int().nonnegative(),
})
export type StoryboardSplitCheck = z.infer<typeof StoryboardSplitCheckSchema>

/**
 * 批次生成做到哪一步：
 * - full：首幀圖＋影片（預設，跟以前一樣）
 * - frame：只生成首幀圖（先看過首幀滿意了，再花影片的錢）
 * - video：只用現有的首幀圖生成影片（沒有首幀的鏡頭略過）
 */
export const ShotBatchStageSchema = z.enum(['full', 'frame', 'video'])
export type ShotBatchStage = z.infer<typeof ShotBatchStageSchema>

/** 批次生成的請求：選了哪些鏡頭，要不要略過已經有結果的。 */
export const ShotBatchRequestSchema = z.object({
  shotIds: z.array(IdSchema).min(1),
  /** true：這一步已經有結果的鏡頭不再重做（full／video：已經有影片；frame：已經有首幀圖）（省錢，補生成沒做完的）。 */
  skipGenerated: z.boolean(),
  /** 做到哪一步；沒給就是 full。 */
  stage: ShotBatchStageSchema.default('full'),
  /** 先出草稿：整批用經濟組的模型（便宜、快），滿意的鏡頭再用高品質重做（M2-8）。 */
  draft: z.boolean().optional(),
})
/** 呼叫端可以不給 stage（預設 full），所以用輸入型別。 */
export type ShotBatchRequest = z.input<typeof ShotBatchRequestSchema>

/** 批次生成之前的檢查與預估花費（整批加總）。 */
export const ShotBatchCheckSchema = z.object({
  ok: z.boolean(),
  issue: z.string().optional(),
  /** 這次真的會生成幾個鏡頭。 */
  willGenerate: z.number().int().nonnegative(),
  /** 因為已經生成過而略過的有幾個。 */
  skippedGenerated: z.number().int().nonnegative(),
  /** 因為正在生成中而略過的有幾個。 */
  skippedBusy: z.number().int().nonnegative(),
  /** 只生成影片時：因為還沒有首幀圖而略過的有幾個。 */
  skippedNoFrame: z.number().int().nonnegative().default(0),
  estimatedUsd: z.number().nonnegative(),
  /** true 表示有些步驟估不出來，實際花費可能比 estimatedUsd 多。 */
  estimateIsLowerBound: z.boolean(),
  demoMode: z.boolean(),
  /** 這次會用的圖片、影片模型名稱。 */
  models: z.object({ image: z.string().optional(), video: z.string().optional() }),
})
export type ShotBatchCheck = z.infer<typeof ShotBatchCheckSchema>

/** 批次生成開始之後的結果：某個鏡頭沒辦法開始不影響其他鏡頭。 */
export const ShotBatchResultSchema = z.object({
  started: z.number().int().nonnegative(),
  skippedGenerated: z.number().int().nonnegative(),
  skippedBusy: z.number().int().nonnegative(),
  failed: z.array(
    z.object({ shotId: IdSchema, number: z.number().int().positive(), error: z.string() }),
  ),
})
export type ShotBatchResult = z.infer<typeof ShotBatchResultSchema>
