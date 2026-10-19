import { z } from 'zod'

import { ContentHashSchema, IdSchema, IsoDateTimeSchema, UsdSchema } from './common'

/** 聲音片段的種類：旁白（每鏡一句）、音效（每鏡，第一版不做）、配樂（整支一首）。 */
export const SoundClipKindSchema = z.enum(['narration', 'sfx', 'music'])
export type SoundClipKind = z.infer<typeof SoundClipKindSchema>

/**
 * 一次生成的聲音結果（一個版本）。旁白、音效屬於某一鏡（`shotId`）；配樂是整支的，沒有 `shotId`。
 * 同一鏡的同一種類可以有多個版本，標記其中一個為採用（`adopted`），混音只用採用中的版本。
 */
export const SoundClipSchema = z
  .object({
    id: IdSchema,
    kind: SoundClipKindSchema,
    shotId: IdSchema.optional(),
    assetHash: ContentHashSchema,
    durationSec: z.number().nonnegative().optional(),
    /** 在鏡頭內的起點偏移（秒）；配樂不用。旁白預設晚 0.4 秒開口，由服務層填。 */
    offsetSec: z.number().min(0).default(0),
    /** 增益（dB）；沒填就用混音的預設（旁白 0、配樂 −18）。 */
    gainDb: z.number().min(-60).max(24).optional(),
    fadeInSec: z.number().min(0).optional(),
    fadeOutSec: z.number().min(0).optional(),
    /** 旁白念的文字，或配樂的描述。 */
    text: z.string().default(''),
    /** 旁白用的聲音（模型卡 voices 裡的 id）。 */
    voiceId: z.string().min(1).optional(),
    modelId: z.string().min(1),
    costUsd: UsdSchema.optional(),
    /** costUsd 是依牌價估的，不是供應商實收。 */
    costEstimated: z.boolean().default(false),
    /** 同一鏡同一種類內從 1 開始遞增。 */
    version: z.number().int().positive(),
    adopted: z.boolean().default(false),
    createdAt: IsoDateTimeSchema,
  })
  .superRefine((clip, ctx) => {
    if (clip.kind === 'music' && clip.shotId !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['shotId'], message: '配樂是整支的，不屬於某一鏡' })
    }
    if (clip.kind !== 'music' && clip.shotId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['shotId'], message: '旁白與音效要屬於某一鏡' })
    }
  })
export type SoundClip = z.infer<typeof SoundClipSchema>

/** 專案的聲音設定。預設全開：影片原聲開、旁白出現時壓低、配樂 −18 dB。 */
export const SoundSettingsSchema = z.object({
  /** 生影片時要不要帶原聲（Kling／Veo 的 generate_audio；影片費約 +50%）。 */
  nativeAudio: z.boolean().default(true),
  /** 影片原聲的增益（dB）。 */
  nativeGainDb: z.number().min(-60).max(24).default(0),
  /** 不要用原聲的鏡頭。 */
  muteNativeShotIds: z.array(IdSchema).default([]),
  /** 旁白出現時自動壓低原聲與配樂。 */
  duck: z.boolean().default(true),
  /** 旁白的預設增益（dB）；片段自己有增益就用片段的。 */
  narrationGainDb: z.number().min(-60).max(24).default(0),
  /** 配樂的增益（dB）。 */
  musicGainDb: z.number().min(-60).max(24).default(-18),
})
export type SoundSettings = z.infer<typeof SoundSettingsSchema>

export const SoundSettingsPatchSchema = SoundSettingsSchema.partial()
export type SoundSettingsPatch = z.infer<typeof SoundSettingsPatchSchema>

export const DEFAULT_SOUND_SETTINGS: SoundSettings = SoundSettingsSchema.parse({})

/** 旁白預設比鏡頭開頭晚多久開口（秒）。 */
export const DEFAULT_NARRATION_OFFSET_SEC = 0.4

// ---- 聲音服務（sound.* IPC）的資料型別 ----

/** 旁白文字長度上限（Eleven v3 單次 5,000 字元；其他模型更寬，統一用最嚴的）。 */
export const NARRATION_MAX_CHARS = 5000

/** 一個鏡頭在整支片子裡的時間位置與它的聲音。 */
export const SoundShotViewSchema = z.object({
  shotId: IdSchema,
  number: z.number().int().positive(),
  /** 這一鏡在整支片子裡幾秒開始（前面各鏡實際長度的累加）。 */
  startSec: z.number().min(0),
  /** 這一鏡的長度：採用中的影片實際長度，還沒有影片就用鏡頭設定的秒數。 */
  durationSec: z.number().min(0),
  hasVideo: z.boolean(),
  /** 這一鏡的台詞（旁白念的就是它）。 */
  dialogue: z.string(),
  /** 影片原聲被靜音（設定裡的 muteNativeShotIds）。 */
  nativeMuted: z.boolean(),
  /** 採用中的旁白。 */
  narration: SoundClipSchema.optional(),
  /** 音效（第一版不做，永遠是空的）。 */
  sfx: z.array(SoundClipSchema).default([]),
})
export type SoundShotView = z.infer<typeof SoundShotViewSchema>

export const SoundWarningSchema = z.object({
  kind: z.enum(['narration_too_long', 'music_shorter_than_film']),
  shotId: IdSchema.optional(),
  /** 白話說明，可以直接顯示。 */
  message: z.string(),
})
export type SoundWarning = z.infer<typeof SoundWarningSchema>

export const SoundStateSchema = z.object({
  settings: SoundSettingsSchema,
  shots: z.array(SoundShotViewSchema),
  /** 整支片子的長度（各鏡實際長度加總）。 */
  totalSec: z.number().min(0),
  /** 採用中的配樂。 */
  music: SoundClipSchema.optional(),
  /** 最新一版成品；還沒接過片就沒有。soundStale＝聲音變了、成品還沒重混；hasSound＝成品裡已經混了聲音。 */
  final: z
    .object({
      version: z.number().int().positive(),
      hasSound: z.boolean(),
      soundStale: z.boolean(),
    })
    .optional(),
  warnings: z.array(SoundWarningSchema),
  /** 現在會用的模型（沒有可用的就沒有）；voice 是旁白模型目前用的聲音。 */
  models: z.object({
    tts: z.string().optional(),
    music: z.string().optional(),
    voice: z.string().optional(),
  }),
})
export type SoundState = z.infer<typeof SoundStateSchema>

export const SoundPlanRequestSchema = z.object({
  /** 要念旁白的鏡頭；沒給就是所有「有台詞、還沒有旁白」的鏡頭。 */
  narration: z.object({ shotIds: z.array(IdSchema).optional() }).optional(),
  /** 要不要生配樂（長度只是提示）。 */
  music: z.object({ durationSec: z.number().positive().optional() }).optional(),
})
export type SoundPlanRequest = z.infer<typeof SoundPlanRequestSchema>

export const SoundPlanItemSchema = z.object({
  kind: SoundClipKindSchema,
  shotId: IdSchema.optional(),
  modelId: z.string(),
  estimatedUsd: UsdSchema,
})

export const SoundPlanSchema = z.object({
  items: z.array(SoundPlanItemSchema),
  totalUsd: UsdSchema,
  /** false 表示現在做不了（沒有可用的模型、或超過預算上限），原因寫在 issue。 */
  ok: z.boolean(),
  issue: z.string().optional(),
})
export type SoundPlan = z.infer<typeof SoundPlanSchema>

export const SoundClipPatchSchema = z.object({
  offsetSec: z.number().min(0).optional(),
  gainDb: z.number().min(-60).max(24).nullable().optional(),
  fadeInSec: z.number().min(0).nullable().optional(),
  fadeOutSec: z.number().min(0).nullable().optional(),
})
export type SoundClipPatchInput = z.infer<typeof SoundClipPatchSchema>

/**
 * 成品的聲音量測（給 AI 工具檢查用——Claude 聽不到，只能看數字）。
 * 響度與峰值整支片子都是靜音時沒有；某一鏡完全靜音時 rmsDb 是 null。
 */
export const SoundAnalysisSchema = z.object({
  /** 量的是哪一版成品。 */
  version: z.number().int().positive(),
  durationSec: z.number().min(0),
  loudness: z.object({
    /** 整體響度（LUFS）；目標是 −16。 */
    integratedLufs: z.number().optional(),
    /** 真峰值（dBTP）；不該超過 −1。 */
    truePeakDb: z.number().optional(),
    loudnessRange: z.number().optional(),
  }),
  /** 每一鏡的平均音量（dB，越接近 0 越大聲；null＝完全靜音）。 */
  shots: z.array(
    z.object({
      shotId: IdSchema,
      number: z.number().int().positive(),
      startSec: z.number().min(0),
      rmsDb: z.number().nullable(),
    }),
  ),
  /** 安靜的段落（低於 −50 dB 持續 0.5 秒以上）。 */
  silences: z.array(z.object({ startSec: z.number().min(0), endSec: z.number().min(0) })),
  /** 白話的檢查結果：整支太小聲、爆音、某一鏡完全沒聲音、旁白那段是安靜的…… */
  warnings: z.array(z.string()),
})
export type SoundAnalysis = z.infer<typeof SoundAnalysisSchema>
