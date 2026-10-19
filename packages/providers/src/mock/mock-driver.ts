import {
  AppError,
  GenerationRequestSchema,
  type AssetRef,
  type GenerationOutput,
  type GenerationRequest,
  type Job,
  type JobDriver,
  type LlmRequest,
  type PollResult,
  type ProviderServices,
  type SubmitResult,
} from '@svs/schema'

import { exampleFromJsonSchema } from './json-example'
import { createCanvas, drawText, encodePng, toLabelText } from './png'
import { makeWav } from './wav'

export const MOCK_PROVIDER_ID = 'mock'

export interface MockVideoRender {
  bytes: Uint8Array
  width: number
  height: number
  durationSec: number
}

/** 示範圖（或示範影片的畫面）要畫的內容：給人看的中文，不放英文提示詞。 */
export interface MockFrame {
  kind: 'image' | 'video'
  /** 左上角的小標，例如「示範畫面」「示範圖 2/4」。 */
  title: string
  /** 畫面中間的一句話：提示詞裡給人看的那一段（第一個句號之前）。 */
  caption: string
  /** 右下角的小字：提示詞的指紋，提示詞不同畫面就不同。 */
  detail: string
  /** 決定底色的數字（同一個提示詞永遠同一個顏色）。 */
  hue: number
  width: number
  height: number
}

export interface MockProviderConfig {
  /** 模擬網路延遲（毫秒），submit 與 poll 都會等。預設 0。 */
  latencyMs?: number
  /** 影片、配音這類長任務要輪詢幾次才完成。預設 2。 */
  pollsBeforeDone?: number
  /** 第 N 次 submit（全域累計、從 1 算起）回 429。 */
  rateLimitOnCalls?: readonly number[]
  /** 429 帶的等待時間（毫秒）。預設 1000。 */
  retryAfterMs?: number
  /** 第 N 次 submit 回不可重試的錯誤（模擬內容被拒絕）。 */
  rejectOnCalls?: readonly number[]
  /** 請求內容（Prompt 等）含這段文字就拒絕（不可重試），用來示範與測試「失敗 → 修改 → 重試」。 */
  rejectText?: string
  /** 隨機失敗率 0–1（可重試的 503）。用 seed 決定，結果可重現。預設 0。 */
  failureRate?: number
  seed?: number
  /** LLM 回應覆寫（fixture）：回傳字串原樣使用、物件轉成 JSON；回傳 undefined 用預設的範例資料。 */
  llm?: (request: LlmRequest) => string | object | undefined
  /** 每次完成回報的花費（美元），預設 0（示範模式不花錢）。 */
  costUsd?: (request: GenerationRequest) => number
  /**
   * 把示範畫面畫成 PNG（桌面 App 用系統字型畫，中文才不會變成「??」）。
   * 沒給、或回傳 undefined（例如還沒有視窗）就用內建的點陣字型（只有英數，中文會畫成 ?）。
   */
  renderFrame?: (frame: MockFrame) => Promise<Uint8Array | undefined>
  /** 產生帶文字的色塊影片（正式版接 FFmpeg）。沒給時影片請求會失敗並說明。 */
  renderVideo?: (opts: {
    /** 示範影片的畫面內容。 */
    frame: MockFrame
    label: string
    width: number
    height: number
    durationSec: number
    withAudio: boolean
  }) => Promise<MockVideoRender>
  /** 可以換成假計時器友善的版本。預設 setTimeout，並在取消時立刻結束。 */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export interface MockDriver extends Required<JobDriver> {
  /** 到目前為止的 submit 次數（含失敗的）。 */
  readonly submitCalls: number
  /** 到目前為止的 poll 次數。 */
  readonly pollCalls: number
}

const LONG_CAPABILITIES = new Set<GenerationRequest['capability']>([
  't2v',
  'i2v',
  'r2v',
  'tts',
  'music',
])

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new AppError({ code: 'cancelled', userMessage: '已取消。' }))
      },
      { once: true },
    )
  })
}

/** 可重現的 0–1 亂數（mulberry32）。 */
function rand(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function hashString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const ASPECT_SIZES: Record<string, [number, number]> = {
  '16:9': [640, 360],
  '9:16': [360, 640],
  '1:1': [512, 512],
  '4:3': [640, 480],
  '21:9': [672, 288],
}

/** 示範影片的單張畫面（帶文字的色塊），正式版把它交給 FFmpeg 拉成指定長度。 */
export function renderMockFrame(label: string, width: number, height: number): Buffer {
  const hue = hashString(label)
  const color: [number, number, number] = [
    40 + (hue & 0x7f),
    40 + ((hue >> 8) & 0x7f),
    40 + ((hue >> 16) & 0x7f),
  ]
  const canvas = createCanvas(width, height, color)
  const scale = Math.max(2, Math.floor(width / 160))
  const words = toLabelText(label).match(/.{1,24}/g) ?? []
  words.slice(0, 4).forEach((line, i) => {
    drawText(
      canvas,
      line,
      Math.floor(width / 20),
      Math.floor(height / 8) + i * 10 * scale,
      scale,
      [255, 255, 255],
    )
  })
  return encodePng(width, height, canvas.rgb)
}

export function mockSize(aspect: string): [number, number] {
  return ASPECT_SIZES[aspect] ?? [640, 360]
}

function labelOf(request: GenerationRequest): string[] {
  const seed = 'seed' in request && request.seed !== undefined ? request.seed : 0
  const prompt = 'prompt' in request ? request.prompt : 'text' in request ? request.text : ''
  return [
    `MOCK ${request.capability.toUpperCase()}`,
    `SEED ${String(seed)}`,
    toLabelText(prompt).slice(0, 26),
    // 完整 Prompt 的指紋：Prompt 後半段不同（例如加了運鏡）結果也不同，跟真實模型的行為一致
    `ID ${hashString(prompt).toString(16).slice(0, 4)}`,
  ]
}

/**
 * 假供應商：實作所有能力（LLM、圖、影片、配音），不連網、不需要 Key、不花錢。
 * 可以注入延遲、429、拒絕、隨機失敗，並模擬 submit → poll 的長任務流程。
 * 給 E2E、示範模式與開發時使用。
 */
export function createMockDriver(
  services: ProviderServices,
  config: MockProviderConfig = {},
): MockDriver {
  const sleep = config.sleep ?? defaultSleep
  const pollsBeforeDone = config.pollsBeforeDone ?? 2
  const pending = new Map<string, number>()
  let submitCalls = 0
  let pollCalls = 0

  const parse = (job: Job): GenerationRequest => {
    const parsed = GenerationRequestSchema.safeParse(job.input)
    if (!parsed.success) {
      throw new AppError({
        code: 'provider_rejected',
        userMessage: '示範供應商收到格式不正確的請求。',
      })
    }
    return parsed.data
  }

  const finish = (
    request: GenerationRequest,
    output: GenerationOutput,
  ): { status: 'done'; output: GenerationOutput; costUsd?: number } => {
    const cost = config.costUsd?.(request)
    return { status: 'done', output, ...(cost === undefined ? {} : { costUsd: cost }) }
  }

  const generate = async (request: GenerationRequest): Promise<GenerationOutput> => {
    switch (request.capability) {
      case 'llm':
        return llmOutput(request, config)
      case 't2i':
      case 'edit': {
        const assets: AssetRef[] = []
        const [width, height] = mockSize(request.aspectRatio)
        for (let i = 0; i < request.count; i++) {
          const drawn = await config.renderFrame?.(imageFrame(request, i, width, height))
          const bytes = drawn ?? renderImage(request, i, width, height)
          assets.push(await services.assets.put(bytes, 'image/png', { width, height }))
        }
        return { kind: 'assets', assets }
      }
      case 't2v':
      case 'i2v':
      case 'r2v': {
        if (!config.renderVideo) {
          throw new AppError({
            code: 'internal_error',
            userMessage: '示範模式的影片需要 FFmpeg，目前沒有設定。',
          })
        }
        const [width, height] = mockSize(request.aspectRatio)
        const video = await config.renderVideo({
          frame: {
            kind: 'video',
            title: '示範影片',
            caption: captionOf(request.prompt),
            detail: `#${hashString(request.prompt).toString(16).slice(0, 4)}`,
            hue: hashString(`${request.prompt}|${String(request.seed ?? 0)}`),
            width,
            height,
          },
          label: labelOf(request).join(' '),
          width,
          height,
          durationSec: request.durationSec,
          withAudio: request.audio,
        })
        const asset = await services.assets.put(video.bytes, 'video/mp4', {
          width: video.width,
          height: video.height,
          durationSec: video.durationSec,
        })
        return { kind: 'assets', assets: [asset] }
      }
      case 'tts': {
        const durationSec = Math.max(0.5, Math.min(30, request.text.length * 0.08))
        const asset = await services.assets.put(makeWav(durationSec), 'audio/wav', { durationSec })
        return { kind: 'assets', assets: [asset] }
      }
      case 'music': {
        const durationSec = Math.max(1, Math.min(60, request.durationSec ?? 30))
        const asset = await services.assets.put(makeWav(durationSec), 'audio/wav', { durationSec })
        return { kind: 'assets', assets: [asset] }
      }
    }
  }

  return {
    get submitCalls() {
      return submitCalls
    },
    get pollCalls() {
      return pollCalls
    },

    async submit(job, ctx): Promise<SubmitResult> {
      const call = ++submitCalls
      await sleep(config.latencyMs ?? 0, ctx.signal)
      if (config.rateLimitOnCalls?.includes(call)) {
        throw new AppError({
          code: 'provider_rate_limited',
          retryable: true,
          retryAfterMs: config.retryAfterMs ?? 1000,
          userMessage: '示範供應商：請求太頻繁，稍後會自動重試。',
        })
      }
      if (config.rejectOnCalls?.includes(call)) {
        throw new AppError({
          code: 'provider_rejected',
          userMessage: '示範供應商：內容被拒絕，請修改後再試。',
        })
      }
      if (
        config.rejectText !== undefined &&
        config.rejectText !== '' &&
        JSON.stringify(job.input).includes(config.rejectText)
      ) {
        throw new AppError({
          code: 'provider_rejected',
          userMessage: '示範供應商：內容被拒絕，請修改後再試。',
        })
      }
      if (
        (config.failureRate ?? 0) > 0 &&
        rand((config.seed ?? 0) * 100_003 + call) < (config.failureRate ?? 0)
      ) {
        throw new AppError({
          code: 'provider_unavailable',
          retryable: true,
          userMessage: '示範供應商：暫時無法服務，稍後會自動重試。',
        })
      }
      const request = parse(job)
      if (LONG_CAPABILITIES.has(request.capability)) {
        const providerJobId = `mock-${job.id}`
        pending.set(providerJobId, pollsBeforeDone)
        return { status: 'submitted', providerJobId }
      }
      return finish(request, await generate(request))
    },

    async poll(job, ctx): Promise<PollResult> {
      pollCalls++
      await sleep(config.latencyMs ?? 0, ctx.signal)
      const id = job.providerJobId ?? ''
      // 重開 App 後記憶體裡沒有進度：直接視為完成（任務本身已經在資料庫裡接回來了）
      const remaining = pending.get(id) ?? 0
      if (remaining > 0) {
        pending.set(id, remaining - 1)
        return { status: 'pending' }
      }
      pending.delete(id)
      const request = parse(job)
      return finish(request, await generate(request))
    },

    cancel(job): Promise<void> {
      if (job.providerJobId) pending.delete(job.providerJobId)
      return Promise.resolve()
    },
  }
}

/**
 * 示範模式的拆鏡：Prompt 裡說「已經建好的角色有：阿鐵、小花」時，讓每個鏡頭都由第一位角色出場，
 * 這樣示範模式也能走一遍「角色 → 鏡頭」的流程。其他請求原樣回傳。
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 每一鏡的景別輪流換，看起來比較像真的分鏡（只用 schema 允許的值）。 */
const DEMO_SIZES = ['wide', 'medium', 'close_up'] as const

/**
 * 拆鏡（「請拆成 N 個鏡頭」）：照要求的鏡數，把故事切成幾段當每一鏡的畫面描述，
 * 讓示範模式長出來的鏡頭數量和內容都對得上使用者寫的故事。其他請求原樣回傳。
 */
function demoBreakdown(example: unknown, request: LlmRequest): unknown {
  const last = request.messages.at(-1)?.content ?? ''
  const count = /請拆成\s*(\d+)\s*個鏡頭/.exec(last)?.[1]
  if (count === undefined || !isRecord(example) || !Array.isArray(example.shots)) return example
  const shots: unknown[] = example.shots
  const template: unknown = shots[0]
  if (!isRecord(template)) return example
  const story = (/故事：\s*([\s\S]*?)\s*(?:請拆成|$)/.exec(last)?.[1] ?? '').trim()
  const clauses = story
    .split(/[，。！？；、,.!?;\n]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
  const n = Math.max(1, Math.min(12, Number(count)))
  const sizes = allowedValues(request.jsonSchema, 'size')
  return {
    ...example,
    title: story.length > 0 ? story.slice(0, 16) : example.title,
    shots: Array.from({ length: n }, (_, i) => {
      const clause = clauses[Math.floor((i * clauses.length) / n)] ?? (story || '主角登場')
      const lead = i === 0 ? '開場' : i === n - 1 ? '結尾' : `第 ${String(i + 1)} 段`
      const wanted = DEMO_SIZES[i % DEMO_SIZES.length]
      const size = wanted !== undefined && sizes.includes(wanted) ? wanted : undefined
      return {
        ...template,
        description: `${lead}：${clause}`,
        ...(size === undefined ? {} : { size }),
      }
    }),
  }
}

/** JSON Schema 裡 shots[].<field> 允許的值（enum）。 */
function allowedValues(schema: unknown, field: string): string[] {
  const shots =
    isRecord(schema) && isRecord(schema.properties) ? schema.properties.shots : undefined
  const items = isRecord(shots) ? shots.items : undefined
  const props = isRecord(items) && isRecord(items.properties) ? items.properties[field] : undefined
  const raw: unknown = isRecord(props) ? props.enum : undefined
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
}

function withKnownCharacters(example: unknown, request: LlmRequest): unknown {
  const names = /已經建好的角色有：([^。]+)。/.exec(request.system ?? '')?.[1]?.split('、')
  const first = names?.[0]
  if (!first || typeof example !== 'object' || example === null || !('shots' in example)) {
    return example
  }
  const shots: unknown = example.shots
  if (!Array.isArray(shots)) return example
  return {
    ...example,
    shots: shots.map((shot: unknown) =>
      typeof shot === 'object' && shot !== null && 'characters' in shot
        ? { ...shot, characters: [first] }
        : shot,
    ),
  }
}

function llmOutput(request: LlmRequest, config: MockProviderConfig): GenerationOutput {
  const override = config.llm?.(request)
  let text: string
  if (override !== undefined) {
    text = typeof override === 'string' ? override : JSON.stringify(override)
  } else if (request.jsonSchema) {
    const example = demoBreakdown(exampleFromJsonSchema(request.jsonSchema), request)
    text = JSON.stringify(withKnownCharacters(example, request))
  } else {
    const last = request.messages.at(-1)?.content ?? ''
    text = `（示範回覆）${last.slice(0, 40)}`
  }
  const inputChars = request.messages.reduce(
    (n, m) => n + m.content.length,
    request.system?.length ?? 0,
  )
  return {
    kind: 'text',
    text,
    usage: { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(text.length / 4) },
  }
}

/** 提示詞裡給人看的那一段：第一個句號之前（後面是畫風的英文關鍵字），最多 40 個字。 */
export function captionOf(prompt: string): string {
  const head = prompt.split(/[。\n]/)[0]?.trim() ?? ''
  const text = head.length > 0 ? head : prompt.trim()
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

function imageFrame(
  request: Extract<GenerationRequest, { capability: 't2i' | 'edit' }>,
  index: number,
  width: number,
  height: number,
): MockFrame {
  return {
    kind: 'image',
    title: request.count > 1 ? `示範圖 ${String(index + 1)}/${String(request.count)}` : '示範畫面',
    caption: captionOf(request.prompt),
    detail: `#${hashString(request.prompt).toString(16).slice(0, 4)}`,
    hue: hashString(`${request.prompt}|${String(request.seed ?? 0)}|${String(index)}`),
    width,
    height,
  }
}

function renderImage(
  request: Extract<GenerationRequest, { capability: 't2i' | 'edit' }>,
  index: number,
  width: number,
  height: number,
): Buffer {
  const hue = hashString(`${request.prompt}|${String(request.seed ?? 0)}|${String(index)}`)
  const color: [number, number, number] = [
    40 + (hue & 0x7f),
    40 + ((hue >> 8) & 0x7f),
    40 + ((hue >> 16) & 0x7f),
  ]
  const canvas = createCanvas(width, height, color)
  const lines = labelOf(request)
  if (request.count > 1) lines.push(`IMAGE ${String(index + 1)}/${String(request.count)}`)
  const scale = Math.max(2, Math.floor(width / 160))
  lines.forEach((line, i) => {
    drawText(
      canvas,
      line,
      Math.floor(width / 20),
      Math.floor(height / 8) + i * 10 * scale,
      scale,
      [255, 255, 255],
    )
  })
  return encodePng(width, height, canvas.rgb)
}
