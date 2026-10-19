import { z } from 'zod'

import { UsdSchema } from './common'
import { CapabilitySchema, ModelTierSchema } from './models'
import { STORYBOARD_GUIDE_MAX_CHARS } from './storyboard-guide'

/** 設定頁可以挑模型的三種用途（用白話分成：文字、圖片、影片）。 */
export const PICKABLE_CAPABILITIES = ['llm', 't2i', 'i2v'] as const
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
  mcp: McpSettingsSchema.default({ enabled: false, port: DEFAULT_MCP_PORT, allowanceUsd: 0 }),
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
  /** AI 工具連線：逐項合併（只給要改的欄位）。不能直接用 McpSettingsSchema.partial()——欄位帶預設值，會把沒提到的欄位蓋回預設。 */
  mcp: z
    .object({
      enabled: z.boolean().optional(),
      port: z.number().int().min(1024).max(65535).optional(),
      allowanceUsd: UsdSchema.optional(),
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
  /** 這個模型也能走的其他供應商（顯示名稱）；目前走的是 providerName（比較便宜的那家）。 */
  otherChannels: z.array(z.string()).default([]),
  /** 還沒解鎖：要填哪家的金鑰才能用（例如「fal.ai」「OpenRouter 或 fal.ai」）。能用的模型沒有這個欄位。 */
  needsKey: z.string().optional(),
  notes: z.string().optional(),
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
