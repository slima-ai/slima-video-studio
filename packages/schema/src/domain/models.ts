import { z } from 'zod'

import { AppError } from '../errors'
import { UsdSchema } from './common'
import { getLocale, t } from '../i18n'

/** 模型能提供的能力。一個模型可以有多個（例如 Kling 同時有文生影片與圖生影片）。 */
export const CapabilitySchema = z.enum([
  'llm',
  't2i', // 文生圖
  'edit', // 圖片編輯（可帶多張參考圖）
  't2v', // 文生影片
  'i2v', // 圖生影片
  'r2v', // 參考生影片（多圖／影片／音訊參考）
  'tts',
  'lipsync',
  'music',
])
export type Capability = z.infer<typeof CapabilitySchema>

/** 模型選單的分組：高品質 / 平衡（預設推薦）/ 經濟實惠。 */
export const ModelTierSchema = z.enum(['premium', 'balanced', 'budget'])
export type ModelTier = z.infer<typeof ModelTierSchema>

/** active 才會出現在選單；deprecated 仍可用但不再推薦；sunset 已下架。 */
export const ModelStatusSchema = z.enum(['active', 'deprecated', 'sunset'])
export type ModelStatus = z.infer<typeof ModelStatusSchema>

/** 計價方式。影片依秒、圖片依張、LLM 依百萬 token。 */
export const PricingSchema = z.discriminatedUnion('unit', [
  z.object({
    unit: z.literal('second'),
    usd: UsdSchema,
    /** 有聲版的每秒價格（沒有就表示聲音含在 usd 裡或不支援）。 */
    usdWithAudio: UsdSchema.optional(),
  }),
  z.object({ unit: z.literal('image'), usd: UsdSchema }),
  /** 配樂依首計價（不管長短）。 */
  z.object({ unit: z.literal('track'), usd: UsdSchema }),
  z.object({ unit: z.literal('minute'), usd: UsdSchema }),
  z.object({ unit: z.literal('million_chars'), usd: UsdSchema }),
  z.object({
    unit: z.literal('million_tokens'),
    inputUsd: UsdSchema,
    outputUsd: UsdSchema,
  }),
])
export type Pricing = z.infer<typeof PricingSchema>

/**
 * 供應商文件對照狀態。**endpoint 與價格沒有對照過官方文件前一律是 false**，
 * UI 會把這類價格標為「估算」，正式發佈前要全部核對完。
 */
/** 實測過的某個功能（用真的金鑰跑過）：結果與日期、證據放哪裡。 */
export const ModelTestedFeatureSchema = z.object({
  /** 功能名稱，例如 input_references（參考生影片）。 */
  feature: z.string().min(1),
  /** ok＝實測可用；not_recommended＝能送出去但結果不好，App 不走這條路。 */
  result: z.enum(['ok', 'not_recommended']),
  checkedAt: z.iso.date(),
  /** 做了什麼、看到什麼（白話一兩句；細節在 docs/models.md 與 HQ 紀錄）。 */
  evidence: z.string().min(1),
})
export type ModelTestedFeature = z.infer<typeof ModelTestedFeatureSchema>

export const ModelVerificationSchema = z.object({
  endpoint: z.boolean(),
  pricing: z.boolean(),
  /** 實測過的功能；沒測過的不要列（沒列就是「只有廠商說明」）。 */
  tested: z.array(ModelTestedFeatureSchema).optional(),
  /** 最後一次對照的日期（YYYY-MM-DD）；沒有核對過就不填。 */
  checkedAt: z.iso.date().optional(),
  /** 價格或 endpoint 的出處（網址或文件名稱）。 */
  source: z.string().optional(),
})
export type ModelVerification = z.infer<typeof ModelVerificationSchema>

const DurationRangeSchema = z
  .object({
    min: z.number().positive(),
    max: z.number().positive(),
    /** 只接受固定幾個秒數時才列（例如 OpenRouter 的 Veo 3.1 Lite 只收 4、6、8）；沒寫就是 min～max 之間任意秒數。 */
    steps: z.array(z.number().positive()).min(1).optional(),
  })
  .superRefine((range, ctx) => {
    const steps = range.steps
    if (steps === undefined) return
    if (steps.some((s) => s < range.min || s > range.max)) {
      ctx.addIssue({ code: 'custom', path: ['steps'], message: '允許的秒數必須落在 min～max 之間' })
    }
    if (steps.some((s, i) => i > 0 && s <= (steps[i - 1] ?? 0))) {
      ctx.addIssue({ code: 'custom', path: ['steps'], message: '允許的秒數要由小到大、不能重複' })
    }
  })
/** 影片的負面提示（不想要出現的東西）。`default` 是內建的清單，使用者可以在設定頁改。 */
export const NEGATIVE_PROMPT_MAX_CHARS = 1000
const NegativePromptSchema = z.object({
  default: z.string().min(1).max(NEGATIVE_PROMPT_MAX_CHARS),
  /**
   * 走 OpenRouter 時，負面提示放在 `provider.options[<這個 slug>].parameters.negative_prompt`
   * （OpenRouter 只把選項轉給「實際接手的供應商」，所以要填出這個模型實際由誰供應）。fal 管道不需要。
   */
  routeProvider: z.string().min(1).optional(),
})
export type NegativePromptSpec = z.infer<typeof NegativePromptSchema>
const ReferenceLimitsSchema = z.object({
  images: z.number().int().nonnegative().default(0),
  videos: z.number().int().nonnegative().default(0),
  audios: z.number().int().nonnegative().default(0),
})
/**
 * 圖片走 OpenRouter 的 `POST /images`（而不是 chat/completions）時的設定。
 * 像 `openai/gpt-image-2` 這類只能走 /images 的模型，管道要填這一項；`quality` 決定品質檔位（也決定價格），
 * 所以同一個模型的標準檔與高畫質檔要各開一個模型檔，價格各自寫。
 */
export const ImageApiSchema = z.object({
  quality: z.enum(['low', 'medium', 'high', 'auto']),
})
export type ImageApi = z.infer<typeof ImageApiSchema>
/**
 * 旁白模型可選的聲音。OpenRouter 不提供聲音清單，所以每個 voice 都要實測過才寫進模型卡。
 * `language` 是這個聲音適合的語言（any＝不限）。
 */
export const VoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** 英文介面顯示的名稱；沒填就用 `label`。 */
  labelEn: z.string().min(1).optional(),
  language: z.enum(['zh', 'en', 'any']).default('any'),
})
export type Voice = z.infer<typeof VoiceSchema>
const CharacterMechanismSchema = z.enum(['elements', 'reference', 'lora', 'none'])
const StyleFitSchema = z.enum(['realistic', 'animation', 'both'])
const PromptHintSchema = z.object({
  language: z.enum(['en', 'zh', 'any']).default('any'),
  hint: z.string().optional(),
})

/**
 * 給英文介面看的版本（顯示名稱、一句白話說明、選單小標籤）。檔案裡的主要欄位是繁體中文，
 * 切到英文時用這一份；沒填的欄位就用原本的。
 */
export const ModelTextEnSchema = z.object({
  displayName: z.string().min(1).optional(),
  userNote: z.string().optional(),
  badges: z.array(z.string().min(1)).optional(),
})
export type ModelTextEn = z.infer<typeof ModelTextEnSchema>

/**
 * 執行用的 ModelCard：一個模型在**一家供應商**上的樣子（一個管道）。
 * 檔案裡寫的是 `ModelSpec`（一個模型、多個管道），載入時用 `expandModelSpec` 攤平成這個。
 */
export const ModelCardSchema = z
  .object({
    /** 全域唯一，格式 `<供應商>/<模型>`，例如 `fal/kling-3.0-pro`。 */
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/, '格式必須是 供應商/模型'),
    displayName: z.string().min(1),
    /** 呼叫哪一家的 API（也是要填哪一把 Key）。`mock` 是示範模式的假供應商。 */
    provider: z.string().min(1),
    /** 哪一個模型（同一個模型在不同供應商上的管道共用）；沒填就是 id 的後半段。 */
    model: z.string().min(1).optional(),
    /** 選單上的小標籤，例如「角色一致」「有聲」。 */
    badges: z.array(z.string().min(1)).default([]),
    /** 給使用者看的一句白話說明（設定頁顯示）；工程備註（實測日期、查無的條款）寫在 notes，不給使用者看。 */
    userNote: z.string().optional(),
    /** 英文介面用的顯示名稱、說明與小標籤（見 `ModelTextEnSchema`）。 */
    en: ModelTextEnSchema.optional(),
    /** 匯出時片尾字卡上的標註（英文一行），例如「Video generated with Kling AI」；示範模型沒有。 */
    attribution: z.string().optional(),
    /** 授權說明，例如「可商用」。 */
    licenseNote: z.string().optional(),
    /** 這個模型是否需要使用者的 Key。示範模式的假模型不需要。 */
    needsKey: z.boolean().default(true),
    capabilities: z.array(CapabilitySchema).min(1),
    /** 每個能力對應的供應商端點（fal 的 endpoint id、OpenRouter 的 model slug…）。 */
    endpoints: z.partialRecord(CapabilitySchema, z.string().min(1)),
    status: ModelStatusSchema.default('active'),
    /** 預定下架日（YYYY-MM-DD）。到了這一天就不會出現在選單。 */
    sunsetDate: z.iso.date().optional(),
    tier: ModelTierSchema,
    /** 同一個 tier 裡的首選，選單預設選它。 */
    recommended: z.boolean().default(false),
    pricing: PricingSchema,
    verification: ModelVerificationSchema,
    /** 影片的最長秒數／最短秒數。 */
    durationSec: DurationRangeSchema.optional(),
    /** 依秒計價的模型有最低計費秒數時才填（例如 OpenRouter 的 Kling 3.0 Std 3 秒也收 5 秒）；預估花費按它算。 */
    minBillableSec: z.number().positive().optional(),
    resolutions: z.array(z.string().min(1)).default([]),
    /** 影片可以另外指定「尾幀」（圖生影片時，影片最後一格要長成這張圖）。供應商文件核對過的才填。 */
    endFrame: z.boolean().default(false),
    nativeAudio: z.boolean().default(false),
    /** 脈絡長度（LLM，單位 token）。 */
    contextTokens: z.number().int().positive().optional(),
    /** 參考輸入上限（圖／影片／音訊數量），給「自動挑參考」截斷用。 */
    referenceLimits: ReferenceLimitsSchema.optional(),
    /** 角色一致性的機制：elements（Kling）、reference（多圖參考）、lora、none。 */
    characterMechanism: CharacterMechanismSchema.default('none'),
    /** 有填就表示這個管道的圖片走 OpenRouter 的 /images（只有 openrouter 的 t2i／edit 用得到）。 */
    imageApi: ImageApiSchema.optional(),
    /** 旁白（tts）可選的聲音；第一個是預設。 */
    voices: z.array(VoiceSchema).default([]),
    /** 依字元計價時，每個漢字／全形字算幾個字元（MiniMax 是 2）；沒填就是 1。 */
    cjkCharWeight: z.number().positive().optional(),
    styleFit: StyleFitSchema.default('both'),
    /** 給 Prompt 生成節點參考：這個模型偏好的寫法與語言。 */
    prompt: PromptHintSchema.optional(),
    /**
     * 模型原生的運鏡參數：運鏡預設 ID → 要合併進請求的欄位。有對應的就用參數、不再加進 Prompt；
     * 沒有對應的運鏡一律加進 Prompt。供應商文件還沒核對過的模型不要填。
     */
    cameraParams: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    /** 這個模型接受負面提示時才填（供應商文件核對過的模型才填）。 */
    negativePrompt: NegativePromptSchema.optional(),
    notes: z.string().optional(),
  })
  .superRefine((card, ctx) => {
    for (const capability of card.capabilities) {
      if (!card.endpoints[capability]) {
        ctx.addIssue({
          code: 'custom',
          path: ['endpoints', capability],
          message: `能力 ${capability} 沒有對應的 endpoint`,
        })
      }
    }
    for (const key of Object.keys(card.endpoints)) {
      if (!(card.capabilities as string[]).includes(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['endpoints', key],
          message: `endpoint ${key} 不在 capabilities 裡`,
        })
      }
    }
    if (card.imageApi) {
      if (card.provider !== 'openrouter') {
        ctx.addIssue({
          code: 'custom',
          path: ['imageApi'],
          message: 'imageApi 只有 OpenRouter 的管道用得到',
        })
      }
      if (!card.capabilities.includes('t2i') && !card.capabilities.includes('edit')) {
        ctx.addIssue({
          code: 'custom',
          path: ['imageApi'],
          message: 'imageApi 只能用在有 t2i 或 edit 能力的模型',
        })
      }
    }
    if (card.voices.length > 0 && !card.capabilities.includes('tts')) {
      ctx.addIssue({
        code: 'custom',
        path: ['voices'],
        message: 'voices 只能用在有 tts 能力的模型',
      })
    }
    if (new Set(card.voices.map((v) => v.id)).size !== card.voices.length) {
      ctx.addIssue({ code: 'custom', path: ['voices'], message: '同一張卡的 voice id 不能重複' })
    }
    if (card.durationSec && card.durationSec.min > card.durationSec.max) {
      ctx.addIssue({ code: 'custom', path: ['durationSec'], message: '最短秒數不能大於最長秒數' })
    }
    const v = card.verification
    if ((v.endpoint || v.pricing) && (!v.source || !v.checkedAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['verification'],
        message: '已核對的 endpoint 或價格要填 checkedAt 與 source',
      })
    }
  })
export type ModelCard = z.infer<typeof ModelCardSchema>

/** 這張卡屬於哪一個模型（同一個模型的各個管道相同）。 */
export function modelKeyOf(card: Pick<ModelCard, 'id' | 'model'>): string {
  return card.model ?? card.id.slice(card.id.indexOf('/') + 1)
}

/**
 * 一個管道：同一個模型在某一家供應商上的呼叫方式與價格（M2-10）。
 * 沒填的欄位沿用模型的；有填的（秒數、解析度、角色一致性的機制…）以管道為準。
 */
export const ModelChannelSchema = z.object({
  provider: z.string().min(1),
  /** 預設是 `<provider>/<模型 key>`；只有要沿用舊 id 時才填（示範模型）。 */
  id: z.string().optional(),
  needsKey: z.boolean().default(true),
  /** 這個管道自己的使用者說明；沒填就用模型的 userNote。 */
  userNote: z.string().optional(),
  endpoints: z.partialRecord(CapabilitySchema, z.string().min(1)),
  pricing: PricingSchema,
  verification: ModelVerificationSchema,
  status: ModelStatusSchema.optional(),
  sunsetDate: z.iso.date().optional(),
  durationSec: DurationRangeSchema.optional(),
  minBillableSec: z.number().positive().optional(),
  resolutions: z.array(z.string().min(1)).optional(),
  endFrame: z.boolean().optional(),
  referenceLimits: ReferenceLimitsSchema.optional(),
  characterMechanism: CharacterMechanismSchema.optional(),
  imageApi: ImageApiSchema.optional(),
  voices: z.array(VoiceSchema).optional(),
  cjkCharWeight: z.number().positive().optional(),
  prompt: PromptHintSchema.optional(),
  cameraParams: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  negativePrompt: NegativePromptSchema.optional(),
  notes: z.string().optional(),
})
export type ModelChannel = z.infer<typeof ModelChannelSchema>

/** 模型檔（`packages/providers/models/*.json`）：一個模型、多個管道。 */
export const ModelSpecSchema = z
  .object({
    /** 模型的 key，例如 `kling-3.0-pro`；管道的 id 是 `<供應商>/<key>`。 */
    key: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, '只能用小寫英數、點、底線、連字號'),
    displayName: z.string().min(1),
    /** 這個模型做得到的事；每個管道的 endpoints 只能是其中幾項。 */
    tasks: z.array(CapabilitySchema).min(1),
    tier: ModelTierSchema,
    recommended: z.boolean().default(false),
    styleFit: StyleFitSchema.default('both'),
    features: z
      .object({
        nativeAudio: z.boolean().default(false),
        characterMechanism: CharacterMechanismSchema.default('none'),
        contextTokens: z.number().int().positive().optional(),
      })
      .default({ nativeAudio: false, characterMechanism: 'none' }),
    badges: z.array(z.string().min(1)).default([]),
    /** 給使用者看的一句白話說明（設定頁顯示）；工程備註寫在 notes。 */
    userNote: z.string().optional(),
    /** 英文介面用的顯示名稱、說明與小標籤（見 `ModelTextEnSchema`）。 */
    en: ModelTextEnSchema.optional(),
    /** 匯出時片尾字卡上的標註（英文一行）；沒有就不列。 */
    attribution: z.string().optional(),
    status: ModelStatusSchema.default('active'),
    sunsetDate: z.iso.date().optional(),
    licenseNote: z.string().optional(),
    prompt: PromptHintSchema.optional(),
    notes: z.string().optional(),
    channels: z.array(ModelChannelSchema).min(1),
  })
  .superRefine((spec, ctx) => {
    const providers = new Set<string>()
    spec.channels.forEach((channel, index) => {
      if (providers.has(channel.provider)) {
        ctx.addIssue({
          code: 'custom',
          path: ['channels', index, 'provider'],
          message: `同一個供應商（${channel.provider}）只能有一個管道`,
        })
      }
      providers.add(channel.provider)
      for (const task of Object.keys(channel.endpoints)) {
        if (!(spec.tasks as string[]).includes(task)) {
          ctx.addIssue({
            code: 'custom',
            path: ['channels', index, 'endpoints', task],
            message: `管道的 ${task} 不在模型的 tasks 裡`,
          })
        }
      }
    })
    for (const task of spec.tasks) {
      if (!spec.channels.some((channel) => channel.endpoints[task])) {
        ctx.addIssue({
          code: 'custom',
          path: ['tasks'],
          message: `沒有任何管道做得到 ${task}`,
        })
      }
    }
  })
export type ModelSpec = z.infer<typeof ModelSpecSchema>

/** 模型檔 → 每個管道一張執行用的 ModelCard（模型的欄位當預設、管道的覆蓋）。 */
export function expandModelSpec(spec: ModelSpec): ModelCard[] {
  return spec.channels.map((channel) => {
    const notes = [spec.notes, channel.notes].filter((n) => n !== undefined).join(' ')
    const sunsetDate = channel.sunsetDate ?? spec.sunsetDate
    const prompt = channel.prompt ?? spec.prompt
    const durationSec = channel.durationSec
    const referenceLimits = channel.referenceLimits
    return ModelCardSchema.parse({
      id: channel.id ?? `${channel.provider}/${spec.key}`,
      displayName: spec.displayName,
      provider: channel.provider,
      model: spec.key,
      badges: spec.badges,
      ...(spec.en === undefined ? {} : { en: spec.en }),
      ...(spec.attribution === undefined ? {} : { attribution: spec.attribution }),
      ...((channel.userNote ?? spec.userNote) === undefined
        ? {}
        : { userNote: channel.userNote ?? spec.userNote }),
      ...(spec.licenseNote === undefined ? {} : { licenseNote: spec.licenseNote }),
      needsKey: channel.needsKey,
      capabilities: Object.keys(channel.endpoints),
      endpoints: channel.endpoints,
      status: channel.status ?? spec.status,
      ...(sunsetDate === undefined ? {} : { sunsetDate }),
      tier: spec.tier,
      recommended: spec.recommended,
      pricing: channel.pricing,
      verification: channel.verification,
      ...(durationSec === undefined ? {} : { durationSec }),
      ...(channel.minBillableSec === undefined ? {} : { minBillableSec: channel.minBillableSec }),
      resolutions: channel.resolutions ?? [],
      endFrame: channel.endFrame ?? false,
      nativeAudio: spec.features.nativeAudio,
      ...(spec.features.contextTokens === undefined
        ? {}
        : { contextTokens: spec.features.contextTokens }),
      ...(referenceLimits === undefined ? {} : { referenceLimits }),
      characterMechanism: channel.characterMechanism ?? spec.features.characterMechanism,
      ...(channel.imageApi === undefined ? {} : { imageApi: channel.imageApi }),
      ...(channel.voices === undefined ? {} : { voices: channel.voices }),
      ...(channel.cjkCharWeight === undefined ? {} : { cjkCharWeight: channel.cjkCharWeight }),
      styleFit: spec.styleFit,
      ...(prompt === undefined ? {} : { prompt }),
      ...(channel.cameraParams === undefined ? {} : { cameraParams: channel.cameraParams }),
      ...(channel.negativePrompt === undefined ? {} : { negativePrompt: channel.negativePrompt }),
      ...(notes === '' ? {} : { notes }),
    })
  })
}

/**
 * 比價用的單價：同一個計價單位才能比（影片每秒、圖每張…）；token 計價用輸入加輸出。
 * 不同單位比不了，回傳 undefined。
 */
export function comparablePrice(a: Pricing, b: Pricing): [number, number] | undefined {
  if (a.unit !== b.unit) return undefined
  const unit = (p: Pricing): number =>
    p.unit === 'million_tokens' ? p.inputUsd + p.outputUsd : p.usd
  return [unit(a), unit(b)]
}

/** 估算花費需要的用量。依模型計價單位填對應欄位。 */
export interface UsageEstimate {
  seconds?: number
  images?: number
  tracks?: number
  minutes?: number
  chars?: number
  inputTokens?: number
  outputTokens?: number
  /** 影片是否要有聲（有 usdWithAudio 時才有差別）。 */
  audio?: boolean
}

const MISSING = (field: string, card: ModelCard): AppError =>
  new AppError({
    code: 'invalid_request',
    userMessage: t('settings.canTEstimateTheCost', { displayName: card.displayName, field }),
  })

/** 全形字（漢字、假名、韓文、全形標點）；有些旁白模型把它們算成兩個字元。 */
const WIDE_CHAR = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u

/**
 * 旁白文字的計費字元數：每個字算 1，卡上有 `cjkCharWeight` 時全形字（含全形標點）改算那個數字。
 * （MiniMax 實測：23 個漢字加 3 個標點收 49 個單位＝23×2＋3，標點「，」「。」算 1 還是 2 尚未分開量，
 * 這裡把全形標點也算進權重，會略多估一點，寧可多估。）
 */
export function billableChars(card: Pick<ModelCard, 'cjkCharWeight'>, text: string): number {
  const weight = card.cjkCharWeight ?? 1
  let total = 0
  for (const char of text) total += WIDE_CHAR.test(char) ? weight : 1
  return total
}

/** 依 ModelCard 的價格與用量估算花費（美金）。缺少需要的用量欄位時丟錯，不會悄悄少算。 */
export function estimateCostUsd(card: ModelCard, usage: UsageEstimate): number {
  const p = card.pricing
  switch (p.unit) {
    case 'second': {
      if (usage.seconds === undefined) throw MISSING(t('settings.theNumberOfSeconds'), card)
      const rate = usage.audio === true ? (p.usdWithAudio ?? p.usd) : p.usd
      return Math.max(usage.seconds, card.minBillableSec ?? 0) * rate
    }
    case 'image': {
      if (usage.images === undefined) throw MISSING(t('settings.theNumberOfImages'), card)
      return usage.images * p.usd
    }
    case 'track': {
      if (usage.tracks === undefined) throw MISSING(t('settings.theNumberOfTracks'), card)
      return usage.tracks * p.usd
    }
    case 'minute': {
      if (usage.minutes === undefined) throw MISSING(t('settings.theNumberOfMinutes'), card)
      return usage.minutes * p.usd
    }
    case 'million_chars': {
      if (usage.chars === undefined) throw MISSING(t('settings.theNumberOfCharacters'), card)
      return (usage.chars / 1_000_000) * p.usd
    }
    case 'million_tokens': {
      if (usage.inputTokens === undefined || usage.outputTokens === undefined) {
        throw MISSING(t('settings.theInputAndOutputToken'), card)
      }
      return (usage.inputTokens * p.inputUsd + usage.outputTokens * p.outputUsd) / 1_000_000
    }
  }
}

/** 設定頁會列出、可以填 Key 的供應商。ModelCard 的 provider 對應這裡的 id（mock 不需要 Key）。 */
export const KEY_PROVIDERS = [
  { id: 'fal', name: 'fal.ai', keyUrl: 'https://fal.ai/dashboard/keys' },
  { id: 'openrouter', name: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys' },
] as const

/** 目前介面語言要顯示的名稱、說明、小標籤與聲音名稱（英文介面優先用 `en`，沒填的欄位退回主要欄位）。 */
export function cardText(card: ModelCard): {
  displayName: string
  userNote: string | undefined
  badges: string[]
  voices: Voice[]
} {
  if (getLocale() === 'zh-TW') {
    return {
      displayName: card.displayName,
      userNote: card.userNote,
      badges: card.badges,
      voices: card.voices,
    }
  }
  return {
    displayName: card.en?.displayName ?? card.displayName,
    userNote: card.en?.userNote ?? card.userNote,
    badges: card.en?.badges ?? card.badges,
    voices: card.voices.map((v) => (v.labelEn === undefined ? v : { ...v, label: v.labelEn })),
  }
}

/** 目前介面語言要顯示的模型名稱；查不到這張卡（例如已經下架的模型）就用模型 id。 */
export function displayNameOf(card: ModelCard | undefined, fallback: string): string {
  return card ? cardText(card).displayName : fallback
}

/** 同上，查不到就回 `undefined`（讓呼叫的地方自己決定要不要列）。 */
export function cardNameOf(card: ModelCard | undefined): string | undefined {
  return card ? cardText(card).displayName : undefined
}
