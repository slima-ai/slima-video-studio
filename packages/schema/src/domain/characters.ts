import { z } from 'zod'

import { ContentHashSchema, IdSchema, IsoDateTimeSchema } from './common'

/** 固定外觀描述（錨點）的狀態：還沒寫、草稿（可以改）、已鎖定（生成時原封不動帶入）。 */
export const AnchorStatusSchema = z.enum(['none', 'draft', 'locked'])
export type AnchorStatus = z.infer<typeof AnchorStatusSchema>

/** 角色卡在畫面上看到的樣子（服裝先只做一套，所以直接是一個欄位）。 */
export const CharacterViewSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  age: z.string().optional(),
  appearance: z.string(),
  personality: z.string(),
  /** 服裝（先只有一套）。 */
  outfit: z.string(),
  /** 固定外觀描述：之後每個帶到這個角色的 Prompt 都會原封不動帶入（鎖定之後才會帶入）。 */
  anchorText: z.string(),
  anchorStatus: AnchorStatusSchema,
  /** 角色卡的版本號（還沒寫過固定外觀描述就是 0）。改了已鎖定的內容會變成下一版的草稿。 */
  version: z.number().int().nonnegative(),
  /** 主圖（從概念圖挑出來的）；還沒挑就沒有。 */
  heroAssetHash: ContentHashSchema.optional(),
  /** 採用的三視圖；還沒採用就沒有。 */
  turnaround: z
    .object({ front: ContentHashSchema, side: ContentHashSchema, back: ContentHashSchema })
    .optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})
export type CharacterView = z.infer<typeof CharacterViewSchema>

/** 使用者可以改的角色欄位。年齡傳 null 代表清掉。 */
export const CharacterEditSchema = z.object({
  name: z.string().trim().min(1, '角色需要一個名字').max(40, '名字不要超過 40 個字').optional(),
  age: z.string().trim().max(40).nullable().optional(),
  appearance: z.string().max(2000).optional(),
  personality: z.string().max(2000).optional(),
  outfit: z.string().max(1000).optional(),
})
export type CharacterEdit = z.infer<typeof CharacterEditSchema>

/** 角色卡的一個歷史版本（鎖定之前是草稿，鎖定之後就不會再被改動）。 */
export const CharacterVersionSchema = z.object({
  id: IdSchema,
  version: z.number().int().positive(),
  status: AnchorStatusSchema.exclude(['none']),
  anchorText: z.string(),
  heroAssetHash: ContentHashSchema.optional(),
  turnaround: z
    .object({ front: ContentHashSchema, side: ContentHashSchema, back: ContentHashSchema })
    .optional(),
  /** 是不是現在正在用的這一版。 */
  current: z.boolean(),
  createdAt: IsoDateTimeSchema,
})
export type CharacterVersion = z.infer<typeof CharacterVersionSchema>

export const CharacterNameSchema = z.string().trim().min(1, '角色需要一個名字').max(40)

/** 每一輪生成幾張概念圖。 */
export const CONCEPTS_PER_ROUND = 4

/** 一張概念圖候選。 */
export const ConceptViewSchema = z.object({
  id: IdSchema,
  /** 第幾輪（從 1 開始，每按一次「生成」加一）。 */
  round: z.number().int().positive(),
  assetHash: ContentHashSchema,
  modelId: z.string(),
  createdAt: IsoDateTimeSchema,
})
export type ConceptView = z.infer<typeof ConceptViewSchema>

/** 某個角色的概念圖與目前的生成進度（完整快照）。 */
export const ConceptsStateSchema = z.object({
  characterId: IdSchema,
  /** 新的在前。 */
  concepts: z.array(ConceptViewSchema),
  /** 正在生成這一輪：已完成幾張、一共幾張。 */
  generating: z
    .object({ done: z.number().int().nonnegative(), total: z.number().int().positive() })
    .optional(),
  /** 最近一次生成沒有完全成功的原因（白話）。 */
  error: z.string().optional(),
})
export type ConceptsState = z.infer<typeof ConceptsStateSchema>

/** 按「生成」之前的檢查：能不能做、預估花費。 */
export const ConceptCheckSchema = z.object({
  ok: z.boolean(),
  /** 不能做的原因（白話）。 */
  issue: z.string().optional(),
  estimatedUsd: z.number().nonnegative(),
  count: z.number().int().positive(),
  demoMode: z.boolean(),
  modelName: z.string().optional(),
})
export type ConceptCheck = z.infer<typeof ConceptCheckSchema>

/** 設定稿上兩條切線的位置（佔寬度的比例，0～1，A 在左、B 在右）。 */
export const TurnaroundCutsSchema = z
  .object({ a: z.number().min(0.1).max(0.9), b: z.number().min(0.1).max(0.9) })
  .refine((cuts) => cuts.b - cuts.a >= 0.1, '兩條切線至少要隔開一些')
export type TurnaroundCuts = z.infer<typeof TurnaroundCutsSchema>

/** 預設把設定稿平均切成三份。 */
export const DEFAULT_TURNAROUND_CUTS: TurnaroundCuts = { a: 1 / 3, b: 2 / 3 }

/** 每一輪生成幾組三視圖候選。 */
export const TURNAROUNDS_PER_ROUND = 4

/** 一組三視圖候選：整張設定稿，與切出來的正面／側面／背面。 */
export const TurnaroundViewSchema = z.object({
  id: IdSchema,
  round: z.number().int().positive(),
  sheetHash: ContentHashSchema,
  frontHash: ContentHashSchema,
  sideHash: ContentHashSchema,
  backHash: ContentHashSchema,
  cuts: TurnaroundCutsSchema,
  modelId: z.string(),
  createdAt: IsoDateTimeSchema,
})
export type TurnaroundView = z.infer<typeof TurnaroundViewSchema>

export const TurnaroundsStateSchema = z.object({
  characterId: IdSchema,
  /** 新的在前。 */
  turnarounds: z.array(TurnaroundViewSchema),
  generating: z
    .object({ done: z.number().int().nonnegative(), total: z.number().int().positive() })
    .optional(),
  error: z.string().optional(),
})
export type TurnaroundsState = z.infer<typeof TurnaroundsStateSchema>
