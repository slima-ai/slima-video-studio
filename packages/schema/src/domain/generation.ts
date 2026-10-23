import { z } from 'zod'

import { AssetKindSchema } from './execution'
import { ContentHashSchema, AspectRatioSchema } from './common'

/**
 * 節點送給供應商的生成請求（存在 Job.input），以及供應商回傳的結果（Job.output）。
 * 請求只放 JSON 可序列化的資料；圖片、音訊等素材一律用素材庫的內容雜湊引用，
 * 由供應商 adapter 透過 ProviderServices 讀取與上傳。
 */

const common = {
  /** 要使用的 ModelCard id（供應商端點由 ModelCard.endpoints 決定）。 */
  modelId: z.string().min(1),
  seed: z.number().int().nonnegative().optional(),
}

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const LlmRequestSchema = z.object({
  ...common,
  capability: z.literal('llm'),
  system: z.string().optional(),
  messages: z.array(ChatMessageSchema).min(1),
  /** 要求結構化輸出時附上的 JSON Schema（由 Zod 轉出）。回傳的 text 是符合它的 JSON。 */
  jsonSchema: z.record(z.string(), z.unknown()).optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
})
export type LlmRequest = z.infer<typeof LlmRequestSchema>

export const ImageRequestSchema = z.object({
  ...common,
  capability: z.enum(['t2i', 'edit']),
  prompt: z.string().min(1),
  aspectRatio: AspectRatioSchema.default('16:9'),
  /** 圖片編輯的參考圖（素材雜湊），依模型的 referenceLimits 截斷。 */
  referenceAssets: z.array(ContentHashSchema).default([]),
  count: z.number().int().min(1).max(8).default(1),
  /** 首幀圖：模型自己畫的黑邊（上下或左右兩條）在存進素材庫之前自動裁掉（見 apps/desktop 的 letterbox-driver）。 */
  trimLetterbox: z.boolean().optional(),
})
export type ImageRequest = z.infer<typeof ImageRequestSchema>

export const VideoRequestSchema = z.object({
  ...common,
  capability: z.enum(['t2v', 'i2v', 'r2v']),
  prompt: z.string().min(1),
  durationSec: z.number().positive(),
  aspectRatio: AspectRatioSchema.default('16:9'),
  audio: z.boolean().default(false),
  /** 圖生影片的首幀與（選填）尾幀。 */
  startFrameAsset: ContentHashSchema.optional(),
  endFrameAsset: ContentHashSchema.optional(),
  /** 參考生影片的圖片參考。 */
  referenceAssets: z.array(ContentHashSchema).default([]),
  /** 運鏡預設的 ID（或自己打的字）。送出前會依模型換成原生參數（cameraParams）或加進 Prompt。 */
  cameraMove: z.string().min(1).optional(),
  /** 模型原生的運鏡參數（由 ModelCard.cameraParams 對應而來），adapter 直接併進供應商請求。 */
  cameraParams: z.record(z.string(), z.unknown()).optional(),
  /** 負面提示（不想要出現的東西）。模型不接受就不會有；adapter 依供應商放進對應的欄位。 */
  negativePrompt: z.string().min(1).optional(),
  /** 走 OpenRouter 時，實際接手這個模型的供應商 slug（負面提示要放在那個供應商的選項下）。 */
  negativePromptRoute: z.string().min(1).optional(),
  /** 出場角色不要出現的特徵（英文逗號分隔）；送出前併進負面提示（見 withNegativePrompt），模型不接受負面提示就丟掉。 */
  negativeExtra: z.string().min(1).optional(),
})
export type VideoRequest = z.infer<typeof VideoRequestSchema>

export const TtsRequestSchema = z.object({
  ...common,
  capability: z.literal('tts'),
  text: z.string().min(1),
  voiceId: z.string().optional(),
  language: z.string().optional(),
})
export type TtsRequest = z.infer<typeof TtsRequestSchema>

/** 配樂：文字描述 → 一首音樂。長度只是提示（Lyria 只能靠文字提示，實測不可靠：要 20 秒拿到約 62 秒），以回來的檔案為準。 */
export const MusicRequestSchema = z.object({
  ...common,
  capability: z.literal('music'),
  prompt: z.string().min(1),
  durationSec: z.number().positive().optional(),
})
export type MusicRequest = z.infer<typeof MusicRequestSchema>

export const GenerationRequestSchema = z.discriminatedUnion('capability', [
  LlmRequestSchema,
  ImageRequestSchema.extend({ capability: z.literal('t2i') }),
  ImageRequestSchema.extend({ capability: z.literal('edit') }),
  VideoRequestSchema.extend({ capability: z.literal('t2v') }),
  VideoRequestSchema.extend({ capability: z.literal('i2v') }),
  VideoRequestSchema.extend({ capability: z.literal('r2v') }),
  TtsRequestSchema,
  MusicRequestSchema,
])
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>

/** adapter 已經把結果存進素材庫後回傳的引用。 */
export const AssetRefSchema = z.object({
  hash: ContentHashSchema,
  kind: AssetKindSchema,
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().nonnegative().optional(),
  /** 這張圖被自動裁掉黑邊（畫質可能比較差）。 */
  letterboxTrimmed: z.boolean().optional(),
})
export type AssetRef = z.infer<typeof AssetRefSchema>

export const GenerationOutputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      })
      .optional(),
  }),
  z.object({ kind: z.literal('assets'), assets: z.array(AssetRefSchema).min(1) }),
])
export type GenerationOutput = z.infer<typeof GenerationOutputSchema>

/** adapter 讀寫素材庫的介面（正式版由 apps/desktop 接上 AssetStore）。 */
export interface ProviderAssetStore {
  read: (hash: string) => Promise<Uint8Array>
  put: (
    bytes: Uint8Array,
    mime: string,
    meta?: { width?: number; height?: number; durationSec?: number },
  ) => Promise<AssetRef>
}

export interface ProviderServices {
  assets: ProviderAssetStore
}
