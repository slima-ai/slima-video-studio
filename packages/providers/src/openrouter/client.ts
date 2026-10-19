import { AppError, type Capability, type LlmRequest } from '@svs/schema'
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

const tooLarge = (): AppError =>
  new AppError({ code: 'provider_rejected', userMessage: 'OpenRouter 回傳的檔案太大，已略過。' })

/** 失敗原因可能是字串、`{message}` 或其他物件：能取到訊息就取，不然把整個物件轉成字串（只寫進 log）。 */
const describeError = (error: unknown): string => {
  if (typeof error === 'string') return error.slice(0, 500)
  if (error === undefined || error === null) return '沒有說明原因'
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
        userMessage: '還沒有設定 OpenRouter 的服務金鑰，請先到設定頁填入。',
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
        userMessage: `找不到模型「${req.modelId}」在 OpenRouter 上的對應。`,
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
        userMessage: 'OpenRouter 回傳的內容格式不對，稍後會自動重試。',
        cause: parsed.error,
      })
    }
    const choice = parsed.data.choices[0]
    const text = choice?.message.content ?? ''
    if (choice?.finish_reason === 'content_filter' || text === '') {
      throw new AppError({
        code: 'provider_rejected',
        userMessage: '模型沒有給出回應（內容可能被過濾），請修改內容後再試。',
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
        userMessage: 'OpenRouter 沒有回傳串流內容。',
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
      if (signal.aborted) throw new AppError({ code: 'cancelled', userMessage: '已取消。' })
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
        userMessage: `找不到模型「${modelId}」在 OpenRouter 上的對應。`,
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
        userMessage: 'OpenRouter 沒有回傳圖片，可能是內容被過濾了。請調整描述後再試。',
      })
    }
    const file = await this.fileFromUrl(url, signal, MAX_IMAGE_BYTES)
    const cost = parsed.success ? parsed.data.usage?.cost : undefined
    return { ...file, ...(cost === undefined ? {} : { costUsd: cost }) }
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
          userMessage:
            'OpenRouter 不接受這個影片請求（可能是這個模型不支援首尾幀或參考圖）。請換一個影片模型再試。',
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
        userMessage: 'OpenRouter 回傳的內容格式不對，稍後會自動重試。',
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
        userMessage: 'OpenRouter 回傳的狀態格式不對，稍後會自動重試。',
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
        userMessage: '讀不懂 OpenRouter 回傳的餘額資料。',
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
