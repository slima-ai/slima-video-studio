import { z } from 'zod'

import { UsdSchema } from './common'

/** 快速開始可以選的畫風（給畫面與工作流共用）。 */
export const QUICK_STYLE_IDS = ['realistic', 'anime', '3d', 'watercolor'] as const
export const QuickStyleIdSchema = z.enum(QUICK_STYLE_IDS)
export type QuickStyleId = z.infer<typeof QuickStyleIdSchema>

/** 給使用者看的白話名稱。 */
export const QUICK_STYLE_LABELS: Readonly<Record<QuickStyleId, string>> = {
  realistic: '寫實',
  anime: '日系動畫',
  '3d': '3D 動畫',
  watercolor: '水彩',
}

export const QUICK_START_LIMITS = {
  maxStoryChars: 4000,
  maxShots: 12,
  minDurationSec: 3,
  maxDurationSec: 15,
} as const

/**
 * 快速開始要不要帶聲音（對話框的三個勾選，預設全開）：
 * native＝生成影片時帶原聲（影片費約 +50%）；narration＝完成後念每個鏡頭的台詞；music＝完成後配一首背景音樂。
 * 沒給就不自動加聲音（舊的呼叫方式不變）。
 */
export const QuickStartSoundSchema = z.object({
  native: z.boolean(),
  narration: z.boolean(),
  music: z.boolean(),
})
export type QuickStartSound = z.infer<typeof QuickStartSoundSchema>

export const DEFAULT_QUICK_START_SOUND: QuickStartSound = {
  native: true,
  narration: true,
  music: true,
}

export const QuickStartRequestSchema = z.object({
  /** 使用者寫的故事或一句話。 */
  story: z.string().max(QUICK_START_LIMITS.maxStoryChars),
  style: QuickStyleIdSchema,
  /** 拆成幾個鏡頭。 */
  shotCount: z.number().int().min(1).max(QUICK_START_LIMITS.maxShots),
  /** 每個鏡頭幾秒。 */
  durationSec: z
    .number()
    .int()
    .min(QUICK_START_LIMITS.minDurationSec)
    .max(QUICK_START_LIMITS.maxDurationSec),
  /** 橫式或直式。 */
  aspectRatio: z.enum(['16:9', '9:16']).default('16:9'),
  /** 想換一批結果時加一（拆鏡、首幀、影片都會重新生成；沒改的部分不會重跑）。 */
  variation: z.number().int().nonnegative().default(0),
  /**
   * 生成的鏡頭怎麼放進專案（沒給＝replace）：replace＝整批換掉現有的鏡頭（舊的快速開始頁用）；
   * append＝新增一個場放在最後面，不動現有的內容（畫布的一句話節點用）。
   */
  mode: z.enum(['replace', 'append']).optional(),
  /** 從哪個一句話節點生成的（節點鍵）：長出來的場會連一條線到它。 */
  sourceKey: z.string().min(1).optional(),
  /** 要不要帶聲音；沒給就不自動加。 */
  sound: QuickStartSoundSchema.optional(),
  /**
   * 做到哪一步（沒給＝full，一次做完整支）：storyboard＝只用文字模型寫分鏡（長出場和鏡頭），
   * 不生成圖片和影片、不接片、不加聲音；看過、改好之後再用「全部生成」做後面的。
   */
  stage: z.enum(['storyboard', 'full']).optional(),
})
export type QuickStartRequest = z.infer<typeof QuickStartRequestSchema>

/** 按下「生成」之前的檢查結果。 */
export const QuickStartCheckSchema = z.object({
  /** false 表示有問題要先處理，不能開始。 */
  ok: z.boolean(),
  issues: z.array(
    z.object({
      message: z.string(),
      /** settings：可以到設定頁處理。 */
      action: z.literal('settings').optional(),
    }),
  ),
  estimatedUsd: UsdSchema,
  /** true 表示有些步驟估不出來，實際花費可能比 estimatedUsd 多。 */
  estimateIsLowerBound: z.boolean(),
  /** 單次生成的花費上限（設定頁可以調）。 */
  limitUsd: UsdSchema,
  /** 這次會用的模型名稱（白話顯示）。 */
  models: z.object({
    llm: z.string().optional(),
    image: z.string().optional(),
    video: z.string().optional(),
  }),
  demoMode: z.boolean(),
})
export type QuickStartCheck = z.infer<typeof QuickStartCheckSchema>

export const ShotStepSchema = z.enum(['waiting', 'prompt', 'image', 'video', 'done', 'failed'])
export type ShotStep = z.infer<typeof ShotStepSchema>

export const ShotProgressSchema = z.object({
  index: z.number().int().nonnegative(),
  description: z.string().optional(),
  /** 目前進行到哪一步（失敗時是 failed）。 */
  step: ShotStepSchema,
  /** 首幀圖（素材雜湊）。 */
  imageHash: z.string().optional(),
  videoHash: z.string().optional(),
  error: z.string().optional(),
})
export type ShotProgress = z.infer<typeof ShotProgressSchema>

export const QuickStartProgressSchema = z.object({
  runId: z.string(),
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
  /** 目前在做哪一大步：拆鏡頭 → 逐鏡生成 → 接成一支 → （勾了才有）加旁白與配樂。 */
  phase: z.enum(['breakdown', 'shots', 'join', 'sound', 'done']),
  title: z.string().optional(),
  shots: z.array(ShotProgressSchema),
  /** 接好的完整影片。 */
  finalVideoHash: z.string().optional(),
  /** 這次已經花的錢（含估算）。 */
  costUsd: UsdSchema,
  /** 已經匯出的檔案位置。 */
  exportedPath: z.string().optional(),
  /** 勾了旁白或配樂、但沒有加成功（影片本身沒問題，成品面板可以再試）。 */
  soundFailed: z.boolean().optional(),
  error: z.object({ userMessage: z.string(), retryable: z.boolean() }).optional(),
})
export type QuickStartProgress = z.infer<typeof QuickStartProgressSchema>

/** 把快速開始的結果升級成專案之前的檢查：會建立什麼。 */
export const UpgradeCheckSchema = z.object({
  /** false 表示現在不能升級（原因在 issue）。 */
  ok: z.boolean(),
  issue: z.string().optional(),
  /** 會放進大綱的鏡頭數。 */
  shotCount: z.number().int().nonnegative(),
  /** 會建立的草稿角色卡（鏡頭裡出現、但還沒有角色卡的名字）。 */
  newCharacters: z.array(z.string()),
  /** 大綱第一幕的標題。 */
  actTitle: z.string(),
})
export type UpgradeCheck = z.infer<typeof UpgradeCheckSchema>

/** 升級完成後建立了什麼。 */
export const UpgradeResultSchema = z.object({
  actTitle: z.string(),
  shotCount: z.number().int().nonnegative(),
  /** 新建的角色卡，以及有沒有從畫面挑到主圖。 */
  characters: z.array(z.object({ name: z.string(), heroPicked: z.boolean() })),
})
export type UpgradeResult = z.infer<typeof UpgradeResultSchema>
