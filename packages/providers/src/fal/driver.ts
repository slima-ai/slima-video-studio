import {
  AppError,
  GenerationRequestSchema,
  isAppError,
  type AssetRef,
  type Capability,
  type DriverContext,
  type GenerationRequest,
  type Job,
  type JobDriver,
  type PollResult,
  type ProviderServices,
  type SubmitResult,
} from '@svs/schema'
import { z } from 'zod'

import { FalClient, type FalOptions } from './client'

export const FAL_PROVIDER_ID = 'fal'

/** 單一檔案上限：影片最大，給 500 MB 已綽綽有餘。 */
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024

export interface FalDriverOptions extends FalOptions {
  /** ModelCard id + 能力 → fal 端點 id；找不到回傳 undefined。 */
  endpointFor: (modelId: string, capability: Capability) => string | undefined
  /** 讀取參考圖、存放結果的素材庫。 */
  services: ProviderServices
}

const FileSchema = z.object({
  url: z.url(),
  content_type: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

/** 圖片端點回 `images` 陣列（有些回單張 `image`）；影片端點回 `video`。 */
const ResultSchema = z.object({
  images: z.array(FileSchema).optional(),
  image: FileSchema.optional(),
  video: FileSchema.optional(),
})

type MediaRequest = Exclude<GenerationRequest, { capability: 'llm' | 'tts' }>

function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp'
  return 'application/octet-stream'
}

/** 參考圖用 data URI 帶給 fal，不需要另外上傳。 */
async function toDataUri(services: ProviderServices, hash: string): Promise<string> {
  const bytes = await services.assets.read(hash)
  return `data:${sniffMime(bytes)};base64,${Buffer.from(bytes).toString('base64')}`
}

/**
 * 圖生影片的首尾幀欄位名稱因模型而異。Kling 3.0 / O3 官方頁寫 `start_image_url`、`end_image_url`
 * （2026-10-12 核對）；其他模型暫用 `image_url`、`end_image_url`，尚未逐一對照（見 docs/models.md）。
 */
function frameFields(endpoint: string): { start: string; end: string } {
  return /^fal-ai\/kling-video\/(v3|o3)\//.test(endpoint)
    ? { start: 'start_image_url', end: 'end_image_url' }
    : { start: 'image_url', end: 'end_image_url' }
}

async function buildInput(
  req: MediaRequest,
  endpoint: string,
  services: ProviderServices,
): Promise<Record<string, unknown>> {
  const seed = req.seed === undefined ? {} : { seed: req.seed }
  switch (req.capability) {
    case 't2i':
      return {
        prompt: req.prompt,
        aspect_ratio: req.aspectRatio,
        num_images: req.count,
        output_format: 'png',
        ...seed,
      }
    case 'edit':
      return {
        prompt: req.prompt,
        image_urls: await Promise.all(req.referenceAssets.map((h) => toDataUri(services, h))),
        aspect_ratio: req.aspectRatio,
        num_images: req.count,
        output_format: 'png',
        ...seed,
      }
    case 't2v':
      return {
        prompt: req.prompt,
        duration: String(Math.round(req.durationSec)),
        aspect_ratio: req.aspectRatio,
        generate_audio: req.audio,
        ...req.cameraParams,
        ...seed,
      }
    case 'i2v': {
      if (!req.startFrameAsset) {
        throw new AppError({
          code: 'invalid_request',
          userMessage: '圖生影片需要一張起始畫面。',
        })
      }
      const fields = frameFields(endpoint)
      return {
        prompt: req.prompt,
        [fields.start]: await toDataUri(services, req.startFrameAsset),
        ...(req.endFrameAsset
          ? { [fields.end]: await toDataUri(services, req.endFrameAsset) }
          : {}),
        duration: String(Math.round(req.durationSec)),
        aspect_ratio: req.aspectRatio,
        generate_audio: req.audio,
        ...req.cameraParams,
        ...seed,
      }
    }
    case 'r2v':
      return {
        prompt: req.prompt,
        image_urls: await Promise.all(req.referenceAssets.map((h) => toDataUri(services, h))),
        duration: String(Math.round(req.durationSec)),
        aspect_ratio: req.aspectRatio,
        generate_audio: req.audio,
        ...req.cameraParams,
        ...seed,
      }
  }
}

function parseRequest(job: Job): MediaRequest {
  const parsed = GenerationRequestSchema.safeParse(job.input)
  if (!parsed.success || parsed.data.capability === 'llm' || parsed.data.capability === 'tts') {
    throw new AppError({
      code: 'provider_rejected',
      userMessage: 'fal.ai 這裡只處理圖片與影片的請求。',
    })
  }
  return parsed.data
}

/** fal.ai 的任務驅動：圖片、影片都走佇列（送出 → 輪詢 → 取回 → 存進素材庫）。 */
export function createFalDriver(options: FalDriverOptions): Required<JobDriver> & {
  client: FalClient
  /** 測試 Key 是否有效（設定頁的「測試連線」用）。 */
  testKey: (signal: AbortSignal) => Promise<boolean>
} {
  const client = new FalClient(options)

  const endpointOf = (req: MediaRequest): string => {
    const endpoint = options.endpointFor(req.modelId, req.capability)
    if (!endpoint) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: `找不到模型「${req.modelId}」在 fal.ai 上的對應端點。`,
      })
    }
    return endpoint
  }

  async function collect(
    req: MediaRequest,
    result: unknown,
    signal: AbortSignal,
  ): Promise<AssetRef[]> {
    const parsed = ResultSchema.safeParse(result)
    const files = parsed.success
      ? [...(parsed.data.images ?? []), ...(parsed.data.image ? [parsed.data.image] : [])]
      : []
    const video = parsed.success ? parsed.data.video : undefined
    const isVideo = req.capability === 't2v' || req.capability === 'i2v' || req.capability === 'r2v'
    if (isVideo && video) files.push(video)
    if (files.length === 0) {
      throw new AppError({
        code: 'provider_rejected',
        userMessage: 'fal.ai 沒有回傳任何結果，可能是內容被過濾了。請調整描述後再試。',
      })
    }
    const assets: AssetRef[] = []
    for (const file of files) {
      const { bytes, mime } = await client.download(file.url, signal, MAX_DOWNLOAD_BYTES)
      const meta = {
        ...(file.width ? { width: file.width } : {}),
        ...(file.height ? { height: file.height } : {}),
        ...(isVideo ? { durationSec: videoSeconds(req) } : {}),
      }
      assets.push(
        await options.services.assets.put(
          bytes,
          mime ?? file.content_type ?? (isVideo ? 'video/mp4' : sniffMime(bytes)),
          meta,
        ),
      )
    }
    return assets
  }

  return {
    client,
    testKey: (signal) => {
      const endpoint = options.endpointFor('fal/nano-banana-2', 't2i') ?? 'fal-ai/nano-banana-2'
      return client.testKey(endpoint, signal)
    },
    async submit(job: Job, ctx: DriverContext): Promise<SubmitResult> {
      const req = parseRequest(job)
      const endpoint = endpointOf(req)
      const providerJobId = await client.submit(
        endpoint,
        await buildInput(req, endpoint, options.services),
        ctx.signal,
      )
      return { status: 'submitted', providerJobId }
    },
    async poll(job: Job, ctx: DriverContext): Promise<PollResult> {
      const req = parseRequest(job)
      if (!job.providerJobId) {
        throw new AppError({ code: 'internal_error', userMessage: '任務缺少 fal.ai 的編號。' })
      }
      const endpoint = endpointOf(req)
      const status = await client.status(endpoint, job.providerJobId, ctx.signal)
      if (status.state === 'pending') return { status: 'pending' }
      if (status.failure !== undefined) {
        return {
          status: 'failed',
          error: new AppError({
            code: 'provider_rejected',
            userMessage: 'fal.ai 無法完成這個任務，請調整描述或換一個模型。',
            cause: new Error(status.failure.slice(0, 500)),
          }).toShape(),
        }
      }
      try {
        const result = await client.result(endpoint, job.providerJobId, ctx.signal)
        const assets = await collect(req, result, ctx.signal)
        return { status: 'done', output: { kind: 'assets', assets } }
      } catch (error) {
        // 不可重試的錯誤（內容被拒、結果檔案太大）回報為任務失敗；暫時性錯誤丟出去，下次輪詢再試
        if (isAppError(error) && !error.retryable && error.code !== 'cancelled') {
          return { status: 'failed', error: error.toShape() }
        }
        throw error
      }
    },
    async cancel(job: Job): Promise<void> {
      if (!job.providerJobId) return
      const req = parseRequest(job)
      await client.cancel(endpointOf(req), job.providerJobId, AbortSignal.timeout(10_000))
    },
  }
}

const videoSeconds = (req: MediaRequest): number =>
  req.capability === 't2v' || req.capability === 'i2v' || req.capability === 'r2v'
    ? req.durationSec
    : 0
