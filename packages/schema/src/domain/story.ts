import { z } from 'zod'

import {
  AspectRatioSchema,
  ContentHashSchema,
  IdSchema,
  IsoDateTimeSchema,
  UsdSchema,
} from './common'
import { PickableCapabilitySchema } from './settings'
import { t } from '../i18n'

export const BudgetSchema = z.object({
  /** 單次執行的花費上限（預設 US$5）。 */
  perRunLimitUsd: UsdSchema.default(5),
  /** 整個專案的花費上限；沒設就不限制。 */
  projectLimitUsd: UsdSchema.optional(),
})
export type Budget = z.infer<typeof BudgetSchema>

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** 專案資料格式版本，用來決定要跑哪些 migration。 */
  schemaVersion: z.number().int().positive(),
  aspectRatio: AspectRatioSchema.default('16:9'),
  defaultStyleId: IdSchema.optional(),
  budget: BudgetSchema.default({ perRunLimitUsd: 5 }),
  /**
   * 這個專案預設用的模型（每種用途一個 ModelCard id），蓋過 App 設定；沒設的用途跟著 App 設定。
   * 舊專案沒有這個欄位，讀進來是空的。
   */
  models: z.partialRecord(PickableCapabilitySchema, z.string().min(1)).default({}),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})
export type Project = z.infer<typeof ProjectSchema>

export const ActSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string(),
  summary: z.string().default(''),
  order: z.number().int().nonnegative(),
})
export type Act = z.infer<typeof ActSchema>

export const SceneSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  actId: IdSchema.optional(),
  title: z.string(),
  summary: z.string().default(''),
  locationId: IdSchema.optional(),
  timeOfDay: z.string().optional(),
  mood: z.string().optional(),
  estimatedSeconds: z.number().positive().optional(),
  order: z.number().int().nonnegative(),
})
export type Scene = z.infer<typeof SceneSchema>

/** 景別。 */
export const ShotSizeSchema = z.enum([
  'extreme_wide',
  'wide',
  'full',
  'medium',
  'close_up',
  'extreme_close_up',
])
export type ShotSize = z.infer<typeof ShotSizeSchema>

/** 景別的白話名稱（順序就是下拉選單的順序）。 */
export const SHOT_SIZE_LABELS: Readonly<Record<ShotSize, string>> = {
  extreme_wide: '大遠景',
  wide: '遠景',
  full: '全景',
  medium: '中景',
  close_up: '近景',
  extreme_close_up: '特寫',
}

/** 拍攝角度。 */
export const ShotAngleSchema = z.enum([
  'eye_level',
  'high',
  'low',
  'overhead',
  'over_shoulder',
  'side',
  'back',
  'dutch',
])
export type ShotAngle = z.infer<typeof ShotAngleSchema>

/** 拍攝角度的白話名稱。 */
export const SHOT_ANGLE_LABELS: Readonly<Record<ShotAngle, string>> = {
  eye_level: '平視',
  high: '俯拍',
  low: '仰拍',
  overhead: '正上方',
  over_shoulder: '過肩',
  side: '側面',
  back: '背面',
  dutch: '傾斜',
}

export const ShotStatusSchema = z.enum(['draft', 'queued', 'generating', 'done', 'failed'])
export type ShotStatus = z.infer<typeof ShotStatusSchema>

/**
 * 鏡頭裡的出場角色，可指定這一鏡穿哪一套服裝。
 * 角色卡（M4）還沒建立前，AI 拆鏡只給得出名字，所以 characterId 與 name 至少有一個。
 */
export const CharacterAppearanceSchema = z
  .object({
    characterId: IdSchema.optional(),
    name: z.string().min(1).optional(),
    costumeId: IdSchema.optional(),
  })
  .refine((c) => c.characterId !== undefined || c.name !== undefined, {
    error: () => t('errors.aCastMemberNeedsA'),
  })
export type CharacterAppearance = z.infer<typeof CharacterAppearanceSchema>

export const ShotSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  sceneId: IdSchema.optional(),
  /** 鏡號（專案內的顯示編號）。 */
  number: z.number().int().positive(),
  order: z.number().int().nonnegative(),
  size: ShotSizeSchema.default('medium'),
  angle: ShotAngleSchema.default('eye_level'),
  /** 運鏡預設的 ID（資料驅動，見 M3-6）；null 代表固定鏡頭。 */
  cameraMove: z.string().nullable().default(null),
  durationSec: z.number().positive().default(3),
  description: z.string().default(''),
  /** 這幾秒裡發生什麼動作（給影片模型）；空字串代表沒有，影片 Prompt 照舊用畫面描述。 */
  action: z.string().default(''),
  /** 尾幀長什麼樣子（給「用首幀改圖生尾幀」）；空字串代表沒有寫。 */
  endDescription: z.string().default(''),
  /** 組裝後送給模型的 Prompt；使用者手動改過會存在這裡。 */
  prompt: z.string().optional(),
  dialogue: z.string().default(''),
  characters: z.array(CharacterAppearanceSchema).default([]),
  locationId: IdSchema.optional(),
  lighting: z.string().optional(),
  /** 時段（例如：黃昏、深夜）。 */
  timeOfDay: z.string().optional(),
  mood: z.string().optional(),
  status: ShotStatusSchema.default('draft'),
  /** 目前採用的影片版本；接片時只用採用中的版本。 */
  activeTakeId: IdSchema.optional(),
  /** 這個鏡頭要不要放進成品（畫布上影片節點的「放進成品」開關）。 */
  inCut: z.boolean().default(true),
})
export type Shot = z.infer<typeof ShotSchema>

export const TakeKindSchema = z.enum(['first_frame', 'last_frame', 'video'])
export type TakeKind = z.infer<typeof TakeKindSchema>

/** 一次生成的結果版本。同一鏡頭、同一種類可以有多個版本，標記其中一個為採用。 */
export const TakeSchema = z.object({
  id: IdSchema,
  shotId: IdSchema,
  kind: TakeKindSchema,
  /** 同一鏡頭同一種類內從 1 開始遞增。 */
  version: z.number().int().positive(),
  assetHash: ContentHashSchema,
  adopted: z.boolean().default(false),
  modelId: z.string(),
  seed: z.number().int().optional(),
  runId: IdSchema.optional(),
  nodeRunId: IdSchema.optional(),
  /** 生成當下的內容雜湊（描述、Prompt、參考、模型）；和現在的不同就標「需要重跑」。舊資料沒有，視為未知。 */
  inputHash: z.string().optional(),
  /** 成品裡只用這支影片的哪一段（秒）；沒有就是那一端不裁。不是生成輸入，改了不用重跑。 */
  trimInSec: z.number().nonnegative().optional(),
  trimOutSec: z.number().positive().optional(),
  createdAt: IsoDateTimeSchema,
})
export type Take = z.infer<typeof TakeSchema>
