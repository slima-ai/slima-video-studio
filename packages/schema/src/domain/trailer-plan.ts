import { z } from 'zod'

import { CAMERA_MOVE_IDS } from './camera'
import { ShotAngleSchema, ShotSizeSchema } from './story'
import { BeatKindSchema, TrailerSettingsPatchSchema, TrailerSettingsSchema } from './trailer'

// 預告片腳本（T5）：寫腳本的 AI 輸出的格式，以及預告片服務的請求與回應。

/** 腳本裡的一格（AI 輸出）。描述、動作、景別這些給影片與靜態格用；字卡只用 cardText；片名卡什麼都不用寫。 */
export const TrailerScriptBeatSchema = z.object({
  /** 屬於模板的哪一段（hook、world、turn、escalate、suspense、title…）。 */
  segment: z.string().default(''),
  beatKind: BeatKindSchema,
  /** 這一格在成品裡幾秒。 */
  durationSec: z.number().positive(),
  description: z.string().default(''),
  action: z.string().default(''),
  size: ShotSizeSchema.default('medium'),
  angle: ShotAngleSchema.default('eye_level'),
  cameraMove: z.enum(CAMERA_MOVE_IDS).nullable().default(null),
  /** 出場角色（用同一個名字）。 */
  characters: z.array(z.string()).default([]),
  /** 這一格發生的地點（名字，同一個地點用同一個名字；字卡與片名卡留空）。 */
  location: z.string().default(''),
  /** 旁白念的那一句（沒有就空字串）。 */
  dialogue: z.string().default(''),
  /** 字卡上的字（只有 card 才用）；副文字可以空。 */
  cardText: z.string().default(''),
  cardSubtext: z.string().default(''),
})
export type TrailerScriptBeat = z.infer<typeof TrailerScriptBeatSchema>

/** 腳本裡一個地點的外觀：只寫地方本身（材質、光、氣氛），不寫人、不寫動作。 */
export const TrailerPlaceSchema = z.object({
  name: z.string(),
  look: z.string().default(''),
})
export type TrailerPlace = z.infer<typeof TrailerPlaceSchema>

export const TrailerScriptSchema = z.object({
  /** 書名（使用者沒給時由 AI 從文本取）。 */
  title: z.string().default(''),
  /** 配樂說明：照腳本的時間寫成有時間碼的描述，純音樂、不要人聲。 */
  music: z.string().default(''),
  /** 每個用到的地點的外觀描述（場景卡的說明用）；沒寫的地點，場景卡的說明留空。 */
  places: z.array(TrailerPlaceSchema).default([]),
  beats: z.array(TrailerScriptBeatSchema).min(1).max(40),
})
export type TrailerScript = z.infer<typeof TrailerScriptSchema>

/** 一項檢查結果（給畫面與 Claude 看）。 */
export const TrailerIssueViewSchema = z.object({
  code: z.string(),
  index: z.number().int().nonnegative().optional(),
  message: z.string(),
})
export type TrailerIssueView = z.infer<typeof TrailerIssueViewSchema>

/** 寫腳本：文本加上預告片設定（沒給的欄位用預設：劇情型、30 秒、有旁白、有配樂）。 */
export const TrailerPlanRequestSchema = TrailerSettingsPatchSchema.omit({
  sceneId: true,
  musicBrief: true,
  sourceText: true,
  soundAutoAddedAt: true,
  coverAssetHash: true,
}).extend({
  /** 書的文本或故事（最多 60,000 字）。 */
  text: z.string().trim().min(1).max(60_000),
})
export type TrailerPlanRequest = z.input<typeof TrailerPlanRequestSchema>

/** 寫腳本之前的檢查與預估花費（文字模型一次）。 */
export const TrailerPlanCheckSchema = z.object({
  ok: z.boolean(),
  issue: z.string().optional(),
  estimatedUsd: z.number().nonnegative(),
  modelName: z.string().optional(),
  demoMode: z.boolean(),
  /** 專案裡已經有的預告片腳本有幾格（重新寫會整份取代）。 */
  existingBeats: z.number().int().nonnegative(),
  /** 其中已經生成過畫面或影片的有幾格（取代就沒了）。 */
  generatedBeats: z.number().int().nonnegative(),
})
export type TrailerPlanCheck = z.infer<typeof TrailerPlanCheckSchema>

/** 預告片現在的樣子：設定、腳本加總與目標、檢查結果。 */
export const TrailerStatusSchema = z.object({
  /** 這個專案有沒有預告片設定。 */
  exists: z.boolean(),
  settings: TrailerSettingsSchema,
  targetSec: z.number(),
  /** 腳本各格秒數加總（每格先對齊整數格，是成品實際會有的長度）。 */
  scriptSec: z.number(),
  beatCount: z.number().int().nonnegative(),
  /** 腳本加總等於目標（誤差 0.05 秒內）。 */
  matches: z.boolean(),
  errors: z.array(TrailerIssueViewSchema),
  warnings: z.array(TrailerIssueViewSchema),
  /** 成品（接好的影片）實際長度；還沒接過就沒有。 */
  filmSec: z.number().optional(),
})
export type TrailerStatus = z.infer<typeof TrailerStatusSchema>

export const TrailerPlanResultSchema = TrailerStatusSchema.extend({
  /** 第一次寫的沒過檢查，退回重寫了一次。 */
  retried: z.boolean(),
  /** 重寫後還是有問題，用程式修正了什麼（白話）。 */
  fixes: z.array(z.string()),
  /** 這次文字費（美元）。 */
  costUsd: z.number().nonnegative().optional(),
})
export type TrailerPlanResult = z.infer<typeof TrailerPlanResultSchema>

export const TrailerUpdateRequestSchema = z.object({
  patch: TrailerSettingsPatchSchema.omit({
    sceneId: true,
    musicBrief: true,
    sourceText: true,
    soundAutoAddedAt: true,
  }),
  /** 改了目標秒數時：照新長度重排各格秒數（字卡與片名卡不低於最短停留）。 */
  refit: z.boolean().optional(),
})
export type TrailerUpdateRequest = z.input<typeof TrailerUpdateRequestSchema>

/** 在腳本的某一格後面加一張字卡（停留秒數沒給就用這段字的最短停留）。 */
export const TrailerAddCardRequestSchema = z.object({
  afterShotId: z.string().min(1),
  text: z.string().trim().min(1).max(100),
  subtext: z.string().trim().max(100).default(''),
  durationSec: z.number().min(0.25).max(15).optional(),
})
export type TrailerAddCardRequest = z.input<typeof TrailerAddCardRequestSchema>
