import { z } from 'zod'

import { UsdSchema } from './common'
import { CHARACTER_PROMPT_KINDS, CHARACTER_PROMPT_MAX_CHARS } from './character-prompts'
import { CapabilitySchema, ModelTierSchema, NEGATIVE_PROMPT_MAX_CHARS, VoiceSchema } from './models'
import { PRODUCTION_GUIDE_MAX_CHARS } from './production-guide'
import { STORYBOARD_GUIDE_MAX_CHARS } from './storyboard-guide'

/** 設定頁可以挑模型的用途（用白話分成：文字、圖片、影片、旁白、配樂）。 */
export const PICKABLE_CAPABILITIES = ['llm', 't2i', 'i2v', 'tts', 'music'] as const
export const PickableCapabilitySchema = z.enum(PICKABLE_CAPABILITIES)
export type PickableCapability = z.infer<typeof PickableCapabilitySchema>

/** 單次執行的預設花費上限（美金）。 */
export const DEFAULT_PER_RUN_LIMIT_USD = 5

/** 外觀：跟隨系統、淺色、深色。 */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
export const ThemePreferenceSchema = z.enum(THEME_PREFERENCES)
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>

/** 給 AI 工具（Claude Code 等）連線的本機 MCP 伺服器預設埠。 */
export const DEFAULT_MCP_PORT = 47821

/**
 * AI 工具連線（MCP）：預設關閉。額度（`allowanceUsd`）是「AI 工具可以花多少美金」，預設 0，
 * 只有人在 App 的設定頁能改；MCP 的任何工具都改不了它。
 */
export const McpSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(1024).max(65535).default(DEFAULT_MCP_PORT),
  allowanceUsd: UsdSchema.default(0),
})
export type McpSettings = z.infer<typeof McpSettingsSchema>

/**
 * 實驗功能（App 層級）。`claudeChat`＝畫布右下角的 Claude 對話：沒設就依版本——開發版開、打包版關
 * （條款還沒決定，公開發佈前的保險）；使用者在設定頁一動，就用他選的。
 */
export const CHAT_BUDGET_MIN_USD = 0.1
export const CHAT_BUDGET_MAX_USD = 20
/** 沒設定時的預設：US$0.5 太低（讀指南、呼叫幾個工具的一輪就超過），一段就被切斷。 */
export const CHAT_BUDGET_DEFAULT_USD = 5
export const ExperimentsSettingsSchema = z.object({
  claudeChat: z.boolean().optional(),
  /** Claude 對話每一段（一個行程）的用量上限，美金；沒設就用預設。到上限時畫面給「繼續」。 */
  claudeBudgetUsd: z.number().min(CHAT_BUDGET_MIN_USD).max(CHAT_BUDGET_MAX_USD).optional(),
})
export type ExperimentsSettings = z.infer<typeof ExperimentsSettingsSchema>

/**
 * 聲音設定（App 層級）。`voices` 是每個旁白模型（ModelCard id）選的聲音（模型卡 voices 裡的 id）；
 * 沒選的模型用卡上的第一個聲音。聲音的模型本身跟其他用途一樣，放在 `models`（tts、music）。
 */
export const AudioSettingsSchema = z.object({
  voices: z.record(z.string(), z.string().min(1)).default({}),
})
export type AudioSettings = z.infer<typeof AudioSettingsSchema>

const BudgetSettingsSchema = z.object({
  perRunLimitUsd: UsdSchema.default(DEFAULT_PER_RUN_LIMIT_USD),
  projectLimitUsd: UsdSchema.optional(),
})

/** App 層級的設定（存在使用者資料夾，不屬於任何專案）。API Key 不在這裡。 */
export const AppSettingsSchema = z.object({
  /** 第一次使用的引導是否已完成（或略過）。 */
  onboardingDone: z.boolean().default(false),
  /** 示範模式：用假資料跑完整流程，不需要 Key、不花錢。 */
  demoMode: z.boolean().default(false),
  /** 進階模式：顯示節點圖等給進階使用者的工具。 */
  advancedMode: z.boolean().default(false),
  /** 外觀：預設跟隨系統。 */
  theme: ThemePreferenceSchema.default('system'),
  /** 每種用途選用的模型（ModelCard id）；沒選就用推薦的。 */
  models: z.partialRecord(PickableCapabilitySchema, z.string().min(1)).default({}),
  budget: BudgetSettingsSchema.default({ perRunLimitUsd: DEFAULT_PER_RUN_LIMIT_USD }),
  /**
   * 還沒告訴使用者的模型通知（例如選的模型下架、自動換成別的）。存在設定檔裡，
   * 關掉 App 再開也只會說一次；renderer 用 `models.notices` 取走。
   */
  modelNotices: z.array(z.string().min(1)).default([]),
  /** 自訂的分鏡準則；空字串表示用內建預設（DEFAULT_STORYBOARD_GUIDE）。 */
  storyboardGuide: z.string().max(STORYBOARD_GUIDE_MAX_CHARS).default(''),
  /** 自訂的影片負面提示（不想要出現的東西）；空字串表示用各模型內建的清單，模型不接受負面提示就不會送。 */
  videoNegativePrompt: z.string().max(NEGATIVE_PROMPT_MAX_CHARS).default(''),
  /** 自訂的角色提示詞範本（概念圖、有參考圖的概念圖、三視圖）；沒有的項目用內建預設（DEFAULT_CHARACTER_PROMPTS）。 */
  characterPrompts: z
    .partialRecord(z.enum(CHARACTER_PROMPT_KINDS), z.string().max(CHARACTER_PROMPT_MAX_CHARS))
    .default({}),
  /** 自訂的製片與一致性指南（AI 助理用 load_guide 讀）；空字串表示用內建預設（DEFAULT_PRODUCTION_GUIDE）。 */
  productionGuide: z.string().max(PRODUCTION_GUIDE_MAX_CHARS).default(''),
  mcp: McpSettingsSchema.default({ enabled: false, port: DEFAULT_MCP_PORT, allowanceUsd: 0 }),
  audio: AudioSettingsSchema.default({ voices: {} }),
  experiments: ExperimentsSettingsSchema.default({}),
})
export type AppSettings = z.infer<typeof AppSettingsSchema>

/** 設定的局部更新。`budget` 整塊替換；`models` 逐項合併，值為 null 表示改回推薦。 */
export const AppSettingsPatchSchema = z.object({
  onboardingDone: z.boolean().optional(),
  demoMode: z.boolean().optional(),
  advancedMode: z.boolean().optional(),
  theme: ThemePreferenceSchema.optional(),
  models: z.partialRecord(PickableCapabilitySchema, z.string().min(1).nullable()).optional(),
  // 不能直接用 AppSettingsSchema.shape.budget：它帶預設值，只改別的欄位的更新也會被補上預設上限，把使用者設的上限蓋掉
  budget: BudgetSettingsSchema.optional(),
  /** 自訂的分鏡準則；傳空字串表示恢復預設。 */
  storyboardGuide: z.string().max(STORYBOARD_GUIDE_MAX_CHARS).optional(),
  /** 影片的負面提示；傳空字串表示恢復各模型內建的清單。 */
  videoNegativePrompt: z.string().max(NEGATIVE_PROMPT_MAX_CHARS).optional(),
  /** 角色提示詞範本：逐項合併，值為空字串表示那一項恢復預設。 */
  characterPrompts: z
    .partialRecord(z.enum(CHARACTER_PROMPT_KINDS), z.string().max(CHARACTER_PROMPT_MAX_CHARS))
    .optional(),
  /** 自訂的製片與一致性指南；傳空字串表示恢復預設。 */
  productionGuide: z.string().max(PRODUCTION_GUIDE_MAX_CHARS).optional(),
  /** 旁白的聲音：逐模型合併，值為 null 表示改回該模型的預設聲音。 */
  audio: z
    .object({ voices: z.record(z.string(), z.string().min(1).nullable()).optional() })
    .optional(),
  /** AI 工具連線：逐項合併（只給要改的欄位）。不能直接用 McpSettingsSchema.partial()——欄位帶預設值，會把沒提到的欄位蓋回預設。 */
  mcp: z
    .object({
      enabled: z.boolean().optional(),
      port: z.number().int().min(1024).max(65535).optional(),
      allowanceUsd: UsdSchema.optional(),
    })
    .optional(),
  /** 實驗功能開關：逐項合併。 */
  experiments: z
    .object({
      claudeChat: z.boolean().optional(),
      /** null＝改回預設。 */
      claudeBudgetUsd: z
        .number()
        .min(CHAT_BUDGET_MIN_USD)
        .max(CHAT_BUDGET_MAX_USD)
        .nullable()
        .optional(),
    })
    .optional(),
})
export type AppSettingsPatch = z.infer<typeof AppSettingsPatchSchema>

/** 模型選單的一個選項（給 renderer 顯示，不含端點等內部資訊）。 */
export const ModelOptionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  provider: z.string(),
  /** 供應商的顯示名稱，例如「fal.ai」；示範模式的假模型是「示範」。 */
  providerName: z.string(),
  capabilities: z.array(CapabilitySchema),
  tier: ModelTierSchema,
  recommended: z.boolean(),
  /** 白話價格，例如「約 US$0.08／張」。 */
  priceLabel: z.string(),
  /** 一眼看懂的簡短價格，例如「每 5 秒約 US$0.42」，選單上用。 */
  priceShort: z.string(),
  /** false 表示價格還沒對照過官方，介面要標「估算」。 */
  priceVerified: z.boolean(),
  /** 選單上的小標籤，例如「有聲」「角色一致」。 */
  badges: z.array(z.string()).default([]),
  /** 旁白模型可選的聲音（第一個是預設）。 */
  voices: z.array(VoiceSchema).default([]),
  /** 這個模型也能走的其他供應商（顯示名稱）；目前走的是 providerName（比較便宜的那家）。 */
  otherChannels: z.array(z.string()).default([]),
  /** 還沒解鎖：要填哪家的金鑰才能用（例如「fal.ai」「OpenRouter 或 fal.ai」）。能用的模型沒有這個欄位。 */
  needsKey: z.string().optional(),
  /** 工程備註（實測日期、查無的條款等）：給 AI 工具（MCP）讀，設定頁不顯示。 */
  notes: z.string().optional(),
  /** 給使用者看的一句白話說明（設定頁顯示）。 */
  userNote: z.string().optional(),
  /** 這個模型接受負面提示時，內建的清單（設定頁顯示；沒有這個欄位就是不接受）。 */
  negativePromptDefault: z.string().optional(),
})
export type ModelOption = z.infer<typeof ModelOptionSchema>

export const KeyTestResultSchema = z.object({
  provider: z.string(),
  /** Key 有效。 */
  valid: z.boolean(),
  /** 帳戶餘額（美金），只有供應商查得到時才有（OpenRouter）。 */
  balanceUsd: UsdSchema.optional(),
})
export type KeyTestResult = z.infer<typeof KeyTestResultSchema>
