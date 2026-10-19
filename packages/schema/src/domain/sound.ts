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
  /** 配樂的增益（dB）。 */
  musicGainDb: z.number().min(-60).max(24).default(-18),
})
export type SoundSettings = z.infer<typeof SoundSettingsSchema>

export const DEFAULT_SOUND_SETTINGS: SoundSettings = SoundSettingsSchema.parse({})

/** 旁白預設比鏡頭開頭晚多久開口（秒）。 */
export const DEFAULT_NARRATION_OFFSET_SEC = 0.4
