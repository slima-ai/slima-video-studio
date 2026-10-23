import { AppError, type Capability, type ImageApi, type LlmRequest, t } from '@svs/schema'
import { z } from 'zod'

import { httpError, type ProviderLabel } from '../http/errors'
import { readJson, request, type FetchLike } from '../http/fetch'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const PROVIDER: ProviderLabel = { name: 'OpenRouter' }

export interface OpenRouterOptions {
  /** 每次呼叫時才取 Key（Key 只存在主行程的金庫裡）。 */
  getKey: () => string | undefined
  /** ModelCard id + 能力 → OpenRouter 的模型 slug；找不到回傳 undefined。 */
  endpointFor: (modelId: string, capability: Capability) => string | undefined
  /** 這個 ModelCard 的圖片是否走 `POST /images`（例如 gpt-image-2）；沒有回傳就走 chat/completions。 */
  imageApiFor?: (modelId: string) => ImageApi | undefined
  /** 查實收花費（`GET /generation`）時，第一次查之前先等多久；測試傳 0。 */
  costLookupDelayMs?: number
  fetch?: FetchLike
  baseUrl?: string
  timeoutMs?: number
  /** OpenRouter 建議帶的來源資訊（排行榜用），不含任何個人資料。 */
  appName?: string
}

const ChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .optional(),
})

/** OpenRouter 有時會在 HTTP 200 的 body 裡回錯誤。 */
const InlineErrorSchema = z.object({
  error: z.object({
    code: z.union([z.number(), z.string()]).optional(),
    message: z.string().optional(),
  }),
})

/** 圖片回應的 JSON 只取用得到的欄位；位置依文件是 `message.images[].image_url.url`，也容忍其他常見寫法。 */
const ImageResponseSchema = z.object({
  choices: z.array(z.object({ message: z.record(z.string(), z.unknown()) })).min(1),
  usage: z.object({ cost: z.number().optional() }).optional(),
})

/** 取物件的欄位（Reflect.get 回傳 any，這裡固定成 unknown）。 */
const field = (object: object, key: string): unknown => Reflect.get(object, key) as unknown

const DATA_URL = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i

/** 從一則回應訊息裡找出圖片網址；找不到回傳 undefined。 */
function findImageUrl(message: Record<string, unknown>): string | undefined {
  const urlOf = (item: unknown): string | undefined => {
    if (typeof item === 'string') return item
    if (typeof item !== 'object' || item === null) return undefined
    const direct = field(item, 'url')
    if (typeof direct === 'string') return direct
    return urlOf(field(item, 'image_url'))
  }
  for (const key of ['images', 'content']) {
    const value = message[key]
    if (!Array.isArray(value)) continue
    for (const item of value as unknown[]) {
      const url = urlOf(item)
      if (url !== undefined && url !== '') return url
    }
  }
  // 最後一招：內容是文字、裡面夾著 data URL
  const text = message.content
  return typeof text === 'string' ? DATA_URL.exec(text)?.[0] : undefined
}

/** `POST /images` 的回應：每張圖在 `data[]`，內容是 base64（也容忍給網址）；`usage.cost` 是這次實收。 */
const ImagesApiResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().optional(), url: z.string().optional() })),
  usage: z.object({ cost: z.number().optional() }).optional(),
})

/** `GET /generation` 只取實收花費。 */
const GenerationSchema = z.object({ data: z.object({ total_cost: z.number().optional() }) })
/** 配樂串流裡的一個事件：只取音訊片段與最後那筆 usage。 */
const MusicEventSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z.object({ audio: z.object({ data: z.string().optional() }).optional() }).optional(),
      }),
    )
    .optional(),
  usage: z.object({ cost: z.number().optional() }).optional(),
})

const VideoSubmitSchema = z.object({ id: z.string().min(1) })

/** 狀態字串只認得「完成」與「失敗類」，其他一律當成還在進行（文件列的 pending／in_progress 也在其中）。 */
const VideoStatusSchema = z.object({
  status: z.string(),
  error: z.unknown().optional(),
  usage: z.object({ cost: z.number().optional() }).optional(),
})

export type VideoStatus =
  | { state: 'pending' }
  | { state: 'completed'; costUsd?: number }
  | { state: 'failed'; reason: string }

/** 單一檔案上限。 */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
/** 單一旁白檔上限（5,000 字的旁白也只有幾 MB）。 */
const MAX_AUDIO_BYTES = 50 * 1024 * 1024
/** 單一配樂檔上限（實測 60 秒的 mp3 約 1.5 MB）。 */
const MAX_MUSIC_BYTES = 50 * 1024 * 1024

const tooLarge = (): AppError =>
  new AppError({ code: 'provider_rejected', userMessage: t('errors.theFileOpenrouterReturnedIs') })

/** 失敗原因可能是字串、`{message}` 或其他物件：能取到訊息就取，不然把整個物件轉成字串（只寫進 log）。 */
const describeError = (error: unknown): string => {
  if (typeof error === 'string') return error.slice(0, 500)
  if (error === undefined || error === null) return t('errors.noReasonGiven')
  const message = typeof error === 'object' ? field(error, 'message') : undefined
  if (typeof message === 'string') return message.slice(0, 500)
  return JSON.stringify(error).slice(0, 500)
}

async function readBody(
  response: Response,
  maxBytes: number,
  fallbackMime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge()
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw tooLarge()
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim()
  return { bytes, mime: mime === undefined || mime === '' ? fallbackMime : mime }
}

export interface ChatResult {
  text: string
  usage?: { inputTokens: number; outputTokens: number }
  costUsd?: number
}

export class OpenRouterClient {
  private readonly fetch: FetchLike
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(private readonly options: OpenRouterOptions) {
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init))
    this.baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  private key(): string {
    const key = this.options.getKey()
    if (!key) {
      throw new AppError({
        code: 'provider_auth_failed',
        userMessage: t('errors.theOpenrouterServiceKeyIsn'),
      })
    }
    return key
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.key()}`,
      'Content-Type': 'application/json',
      'X-Title': this.options.appName ?? 'Slima Video Studio',
    }
  }

  private body(req: LlmRequest, stream: boolean): string {
    const model = this.options.endpointFor(req.modelId, 'llm')
    if (!model) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: t('errors.couldnTFindTheOpenrouter', { modelId: req.modelId }),
      })
    }
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages,
    ]
    return JSON.stringify({
      model,
      messages,
      stream,
      usage: { include: true },
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      ...(req.seed === undefined ? {} : { seed: req.seed }),
      ...(req.jsonSchema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'result', strict: true, schema: req.jsonSchema },
            },
          }
        : {}),
    })
  }

  /** 送一次 chat/completions（非串流），回傳 JSON；HTTP 200 裡夾帶的錯誤也整理成 AppError。 */
  private async completion(body: string, signal: AbortSignal): Promise<unknown> {
    const response = await request(
      `${this.baseUrl}/chat/completions`,
      { method: 'POST', headers: this.headers(), body },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: this.timeoutMs },
    )
    const json = await readJson(response, PROVIDER)
    const inline = InlineErrorSchema.safeParse(json)
    if (inline.success) {
      const code = Number(inline.data.error.code)
      throw httpError(PROVIDER, Number.isFinite(code) && code >= 400 ? code : 502, {
        ...(inline.data.error.message ? { detail: inline.data.error.message } : {}),
      })
    }
    return json
  }

  /** 一次問答，回傳完整文字。 */
  async chat(req: LlmRequest, signal: AbortSignal): Promise<ChatResult> {
    const json = await this.completion(this.body(req, false), signal)
    const parsed = ChatResponseSchema.safeParse(json)
    if (!parsed.success) {
      throw new AppError({
        code: 'invalid_response',
        retryable: true,
        userMessage: t('errors.openrouterReturnedContentInAn'),
        cause: parsed.error,
      })
    }
    const choice = parsed.data.choices[0]
    const text = choice?.message.content ?? ''
    if (choice?.finish_reason === 'content_filter' || text === '') {
      throw new AppError({
        code: 'provider_rejected',
        userMessage: t('errors.theModelGaveNoResponse'),
      })
    }
    const usage = parsed.data.usage
    return {
      text,
      ...(usage?.prompt_tokens !== undefined && usage.completion_tokens !== undefined
        ? { usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } }
        : {}),
      ...(usage?.cost === undefined ? {} : { costUsd: usage.cost }),
    }
  }

  /** 串流回應（給 AI 助手用）：每收到一段文字就吐出一次。 */
  async *stream(req: LlmRequest, signal: AbortSignal): AsyncGenerator<string> {
    const response = await request(
      `${this.baseUrl}/chat/completions`,
      { method: 'POST', headers: this.headers(), body: this.body(req, true) },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: this.timeoutMs },
    )
    if (!response.body) {
      throw new AppError({
        code: 'invalid_response',
        retryable: true,
        userMessage: t('errors.openrouterReturnedNoStreamedContent'),
      })
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue // 註解行（": OPENROUTER PROCESSING"）與空行
          const data = line.slice(5).trim()
          if (data === '[DONE]') return
          const delta = parseDelta(data)
          if (delta) yield delta
        }
      }
    } catch (error) {
      if (signal.aborted)
        throw new AppError({ code: 'cancelled', userMessage: t('errors.cancelled') })
      throw error
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }

  private modelSlug(modelId: string, capability: Capability): string {
    const model = this.options.endpointFor(modelId, capability)
    if (!model) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: t('errors.couldnTFindTheOpenrouter', { modelId }),
      })
    }
    return model
  }

  /**
   * 生圖（chat/completions 加 `modalities`）：一次回一張。參考圖以 data URI 放進訊息內容。
   * 回傳解出來的圖片檔與供應商回報的花費。
   */
  async generateImage(
    input: {
      modelId: string
      capability: 't2i' | 'edit'
      prompt: string
      aspectRatio: string
      referenceDataUris: readonly string[]
      seed?: number
    },
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mime: string; costUsd?: number }> {
    const imageApi = this.options.imageApiFor?.(input.modelId)
    if (imageApi) return this.generateImageViaImagesApi(input, imageApi, signal)
    const content =
      input.referenceDataUris.length === 0
        ? input.prompt
        : [
            { type: 'text', text: input.prompt },
            ...input.referenceDataUris.map((url) => ({ type: 'image_url', image_url: { url } })),
          ]
    const json = await this.completion(
      JSON.stringify({
        model: this.modelSlug(input.modelId, input.capability),
        messages: [{ role: 'user', content }],
        modalities: ['image', 'text'],
        image_config: { aspect_ratio: input.aspectRatio },
        stream: false,
        usage: { include: true },
        ...(input.seed === undefined ? {} : { seed: input.seed }),
      }),
      signal,
    )
    const parsed = ImageResponseSchema.safeParse(json)
    const message = parsed.success ? parsed.data.choices[0]?.message : undefined
    const url = message ? findImageUrl(message) : undefined
    if (url === undefined) {
      throw new AppError({
        code: 'provider_rejected',
        userMessage: t('errors.openrouterReturnedNoPictureThe'),
      })
    }
    const file = await this.fileFromUrl(url, signal, MAX_IMAGE_BYTES)
    const cost = parsed.success ? parsed.data.usage?.cost : undefined
    return { ...file, ...(cost === undefined ? {} : { costUsd: cost }) }
  }

  /**
   * 生圖（`POST /images`）：gpt-image 這類只能走這條路。一次只要一張（`n: 1`，多張由呼叫端各送一次）；
   * 參考圖放 `input_references`。不送 seed——這個模型不保證支援，送了可能整個請求被拒。
   * 出圖比 chat/completions 慢（高畫質實測 80～95 秒），逾時放寬為兩倍。
   */
  private async generateImageViaImagesApi(
    input: {
      modelId: string
      capability: 't2i' | 'edit'
      prompt: string
      aspectRatio: string
      referenceDataUris: readonly string[]
    },
    imageApi: ImageApi,
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mime: string; costUsd?: number }> {
    const body = JSON.stringify({
      model: this.modelSlug(input.modelId, input.capability),
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio,
      quality: imageApi.quality,
      output_format: 'png',
      n: 1,
      ...(input.referenceDataUris.length === 0
        ? {}
        : {
            input_references: input.referenceDataUris.map((url) => ({
              type: 'image_url',
              image_url: { url },
            })),
          }),
    })
    const response = await request(
      `${this.baseUrl}/images`,
      { method: 'POST', headers: this.headers(), body },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: this.timeoutMs * 2 },
    )
    const json = await readJson(response, PROVIDER)
    const inline = InlineErrorSchema.safeParse(json)
    if (inline.success) {
      const code = Number(inline.data.error.code)
      throw httpError(PROVIDER, Number.isFinite(code) && code >= 400 ? code : 502, {
        ...(inline.data.error.message ? { detail: inline.data.error.message } : {}),
      })
    }
    const parsed = ImagesApiResponseSchema.safeParse(json)
    if (!parsed.success) {
      throw new AppError({
        code: 'invalid_response',
        retryable: true,
        userMessage: t('errors.openrouterReturnedContentInAn'),
        cause: parsed.error,
      })
    }
    const item = parsed.data.data[0]
    const source =
      item?.b64_json !== undefined && item.b64_json !== ''
        ? `data:image/png;base64,${item.b64_json}`
        : item?.url
    if (source === undefined || source === '') {
      throw new AppError({
        code: 'provider_rejected',
        userMessage: t('errors.openrouterReturnedNoPictureThe'),
      })
    }
    const file = await this.fileFromUrl(source, signal, MAX_IMAGE_BYTES)
    const cost = parsed.data.usage?.cost
    return { ...file, ...(cost === undefined ? {} : { costUsd: cost }) }
  }

  /**
   * 旁白（`POST /audio/speech`）：回應是原始的 mp3 位元組（不是 JSON），而且不帶花費。
   * `voice` 必填（沒給 OpenRouter 會回 400）。回傳 `generationId`，花費要另外用 generationCost 查。
   */
  async speech(
    input: { modelId: string; text: string; voice: string },
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mime: string; generationId?: string }> {
    let response: Response
    try {
      response = await request(
        `${this.baseUrl}/audio/speech`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            model: this.modelSlug(input.modelId, 'tts'),
            input: input.text,
            voice: input.voice,
            response_format: 'mp3',
          }),
        },
        { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: this.timeoutMs },
      )
    } catch (error) {
      // 400：多半是聲音名稱不被這個模型接受（例如 ElevenLabs 的 Unknown voice）或文字太長；原文留在 cause
      if (error instanceof AppError && error.code === 'provider_rejected') {
        throw new AppError({
          code: 'provider_rejected',
          userMessage: t('errors.openrouterDidnTAcceptThis'),
          cause: error,
        })
      }
      throw error
    }
    const file = await readBody(response, MAX_AUDIO_BYTES, 'audio/mpeg')
    // HTTP 200 卻回 JSON：是夾帶的錯誤（或不是音訊），不要把它當成音檔存起來
    if (file.mime.includes('json')) {
      const inline = InlineErrorSchema.safeParse(JSON.parse(new TextDecoder().decode(file.bytes)))
      const code = inline.success ? Number(inline.data.error.code) : 502
      throw httpError(PROVIDER, Number.isFinite(code) && code >= 400 ? code : 502, {
        ...(inline.success && inline.data.error.message
          ? { detail: inline.data.error.message }
          : {}),
      })
    }
    const generationId = response.headers.get('x-generation-id')
    return { ...file, ...(generationId === null ? {} : { generationId }) }
  }

  /**
   * 查某次呼叫的實收花費（美元）。旁白的回應沒有 usage，只能事後查，而且**不可靠**：2026-10-19 實測，
   * 第一次探測查得到 US$0.0049，之後同一個模型 12 秒內查了 6 次都是 404。所以只等一次（約 1 秒）就放棄，
   * 回傳 undefined，呼叫端改用牌價估算並標「估算」。這個查詢失敗不影響旁白本身，所以不丟錯。
   */
  async generationCost(generationId: string, signal: AbortSignal): Promise<number | undefined> {
    const delay = this.options.costLookupDelayMs ?? 1000
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    if (signal.aborted) return undefined
    try {
      const response = await request(
        `${this.baseUrl}/generation?id=${encodeURIComponent(generationId)}`,
        { method: 'GET', headers: this.headers() },
        { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: 15_000 },
      )
      const parsed = GenerationSchema.safeParse(await readJson(response, PROVIDER))
      return parsed.success ? parsed.data.data.total_cost : undefined
    } catch {
      return undefined // 還沒入帳（404）或暫時查不到
    }
  }

  /**
   * 配樂（Lyria）：`chat/completions` 加 `modalities: ["text","audio"]`，**一定要串流**（`stream: true`）；
   * 音訊是 SSE 事件裡 `choices[0].delta.audio.data` 的 base64（實測整首只有一個片段）；`usage.cost` 是實收。
   * 長度只能靠文字「提示」，而且不可靠：實測要求 30 秒得 32.8 秒、60 秒得 62.7 秒，但同一個模型要求 20 秒卻得約 62 秒。
   * 有 durationSec 時在 prompt 後面補一句；實際長度以回來的檔案為準，混音時比影片長就截掉（淡出）、比影片短就循環。
   */
  async generateMusic(
    input: { modelId: string; prompt: string; durationSec?: number },
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mime: string; costUsd?: number }> {
    const prompt =
      input.durationSec === undefined
        ? input.prompt
        : `${input.prompt}\nMake it about ${String(Math.round(input.durationSec))} seconds long.`
    const response = await request(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.modelSlug(input.modelId, 'music'),
          messages: [{ role: 'user', content: prompt }],
          modalities: ['text', 'audio'],
          audio: { format: 'mp3' },
          stream: true,
        }),
      },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: this.timeoutMs * 2 },
    )
    const parts: string[] = []
    let cost: number | undefined
    for (const line of (await response.text()).split('\n')) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '' || data === '[DONE]') continue
      let json: unknown
      try {
        json = JSON.parse(data)
      } catch {
        continue // 不認得的片段略過
      }
      const inline = InlineErrorSchema.safeParse(json)
      if (inline.success) {
        const code = Number(inline.data.error.code)
        throw httpError(PROVIDER, Number.isFinite(code) && code >= 400 ? code : 502, {
          ...(inline.data.error.message ? { detail: inline.data.error.message } : {}),
        })
      }
      const event = MusicEventSchema.safeParse(json)
      if (!event.success) continue
      for (const choice of event.data.choices ?? []) {
        const chunk = choice.delta?.audio?.data
        if (chunk) parts.push(chunk)
      }
      if (event.data.usage?.cost !== undefined) cost = event.data.usage.cost
    }
    if (parts.length === 0) {
      throw new AppError({
        code: 'provider_rejected',
        userMessage: t('errors.openrouterReturnedNoMusicThe'),
      })
    }
    const bytes = new Uint8Array(Buffer.from(parts.join(''), 'base64'))
    if (bytes.byteLength > MAX_MUSIC_BYTES) throw tooLarge()
    return { bytes, mime: 'audio/mpeg', ...(cost === undefined ? {} : { costUsd: cost }) }
  }

  /** `data:` 網址直接解碼；一般網址就下載（公開網址，不帶 Key）。 */
  private async fileFromUrl(
    url: string,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
    if (match) {
      const bytes =
        match[2] === undefined
          ? new TextEncoder().encode(decodeURIComponent(match[3] ?? ''))
          : new Uint8Array(Buffer.from(match[3] ?? '', 'base64'))
      if (bytes.byteLength > maxBytes) throw tooLarge()
      return { bytes, mime: match[1] ?? 'application/octet-stream' }
    }
    const response = await request(
      url,
      { method: 'GET' },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: this.timeoutMs },
    )
    return readBody(response, maxBytes, 'image/png')
  }

  /** 送出影片工作（非同步）：回傳工作編號。 */
  async submitVideo(body: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    let response: Response
    try {
      response = await request(
        `${this.baseUrl}/videos`,
        { method: 'POST', headers: this.headers(), body: JSON.stringify(body) },
        { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: this.timeoutMs },
      )
    } catch (error) {
      // 400／422：多半是這個模型不接受首尾幀、參考圖或某個欄位；原始訊息留在 cause（log），畫面給白話提示
      if (error instanceof AppError && error.code === 'provider_rejected') {
        throw new AppError({
          code: 'provider_rejected',
          userMessage: t('errors.openrouterDidnTAcceptThis2'),
          cause: error,
        })
      }
      throw error
    }
    const parsed = VideoSubmitSchema.safeParse(await readJson(response, PROVIDER))
    if (!parsed.success) {
      throw new AppError({
        code: 'invalid_response',
        retryable: true,
        userMessage: t('errors.openrouterReturnedContentInAn'),
        cause: parsed.error,
      })
    }
    return parsed.data.id
  }

  /** 影片的模型 slug（driver 組 /videos 請求內容時用）。 */
  videoModel(modelId: string, capability: Capability): string {
    return this.modelSlug(modelId, capability)
  }

  async videoStatus(jobId: string, signal: AbortSignal): Promise<VideoStatus> {
    const response = await request(
      `${this.baseUrl}/videos/${encodeURIComponent(jobId)}`,
      { method: 'GET', headers: this.headers() },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: 30_000 },
    )
    const parsed = VideoStatusSchema.safeParse(await readJson(response, PROVIDER))
    if (!parsed.success) {
      throw new AppError({
        code: 'invalid_response',
        retryable: true,
        userMessage: t('errors.openrouterReturnedAStatusIn'),
        cause: parsed.error,
      })
    }
    const { status, error, usage } = parsed.data
    const name = status.toLowerCase()
    if (/^(completed?|succeeded|success|done)$/.test(name)) {
      return { state: 'completed', ...(usage?.cost === undefined ? {} : { costUsd: usage.cost }) }
    }
    const hasError = error !== undefined && error !== null && error !== ''
    if (/fail|cancel|expire|error|reject/.test(name) || hasError) {
      return { state: 'failed', reason: hasError ? describeError(error) : name }
    }
    return { state: 'pending' }
  }

  /** 下載完成的影片：網址沒有預先簽名，要帶 Key。 */
  async downloadVideo(
    jobId: string,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    const response = await request(
      `${this.baseUrl}/videos/${encodeURIComponent(jobId)}/content?index=0`,
      { method: 'GET', headers: this.headers() },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: this.timeoutMs * 4 },
    )
    return readBody(response, maxBytes, 'video/mp4')
  }

  /** 測試連線：Key 有效就回傳用量資訊。 */
  async testKey(signal: AbortSignal): Promise<{ label?: string }> {
    const response = await request(
      `${this.baseUrl}/key`,
      { method: 'GET', headers: this.headers() },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: 30_000 },
    )
    const parsed = z
      .object({ data: z.object({ label: z.string().optional() }) })
      .safeParse(await readJson(response, PROVIDER))
    return parsed.success && parsed.data.data.label ? { label: parsed.data.data.label } : {}
  }

  /** 查剩餘額度（美金）。 */
  async balance(
    signal: AbortSignal,
  ): Promise<{ totalCredits: number; totalUsage: number; remainingUsd: number }> {
    const response = await request(
      `${this.baseUrl}/credits`,
      { method: 'GET', headers: this.headers() },
      { fetch: this.fetch, provider: PROVIDER, signal, timeoutMs: 30_000 },
    )
    const parsed = z
      .object({ data: z.object({ total_credits: z.number(), total_usage: z.number() }) })
      .safeParse(await readJson(response, PROVIDER))
    if (!parsed.success) {
      throw new AppError({
        code: 'invalid_response',
        retryable: true,
        userMessage: t('errors.couldnTReadTheBalance'),
      })
    }
    const { total_credits: totalCredits, total_usage: totalUsage } = parsed.data.data
    return { totalCredits, totalUsage, remainingUsd: totalCredits - totalUsage }
  }
}

function parseDelta(data: string): string | undefined {
  try {
    const parsed = z
      .object({
        choices: z.array(
          z.object({ delta: z.object({ content: z.string().nullable().optional() }).optional() }),
        ),
      })
      .parse(JSON.parse(data))
    return parsed.choices[0]?.delta?.content ?? undefined
  } catch {
    return undefined // 不認得的片段直接略過
  }
}
