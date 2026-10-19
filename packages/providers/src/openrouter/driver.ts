import {
  AppError,
  GenerationRequestSchema,
  isAppError,
  type AssetRef,
  type DriverContext,
  type GenerationRequest,
  type Job,
  type JobDriver,
  type PollResult,
  type ProviderServices,
  type SubmitResult,
} from '@svs/schema'

import { OpenRouterClient, type OpenRouterOptions } from './client'

export const OPENROUTER_PROVIDER_ID = 'openrouter'

/** 單一影片檔上限：給 500 MB 已綽綽有餘。 */
const MAX_VIDEO_BYTES = 500 * 1024 * 1024

export interface OpenRouterDriverOptions extends OpenRouterOptions {
  /** 讀取參考圖、存放結果的素材庫。 */
  services: ProviderServices
  /** 旁白請求沒指定聲音時，這張模型卡的預設聲音（OpenRouter 的 TTS 一定要帶 voice）。 */
  defaultVoiceFor?: (modelId: string) => string | undefined
}

type SupportedRequest = GenerationRequest
type TtsRequest = Extract<GenerationRequest, { capability: 'tts' }>
type ImageRequest = Extract<GenerationRequest, { capability: 't2i' | 'edit' }>
type VideoRequest = Extract<GenerationRequest, { capability: 't2v' | 'i2v' | 'r2v' }>

const isVideo = (req: SupportedRequest): req is VideoRequest =>
  req.capability === 't2v' || req.capability === 'i2v' || req.capability === 'r2v'

function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp'
  return 'application/octet-stream'
}

/** 參考圖用 data URI 帶給 OpenRouter，不需要另外上傳。 */
async function toDataUri(services: ProviderServices, hash: string): Promise<string> {
  const bytes = await services.assets.read(hash)
  return `data:${sniffMime(bytes)};base64,${Buffer.from(bytes).toString('base64')}`
}

const imagePart = (url: string): { type: 'image_url'; image_url: { url: string } } => ({
  type: 'image_url',
  image_url: { url },
})

function parseRequest(job: Job): SupportedRequest {
  const parsed = GenerationRequestSchema.safeParse(job.input)
  if (!parsed.success) {
    throw new AppError({
      code: 'provider_rejected',
      userMessage: 'OpenRouter 收到的請求格式不對。',
      cause: parsed.error,
    })
  }
  return parsed.data
}

/**
 * OpenRouter 的任務驅動：
 * 文字與圖片一次呼叫就完成（chat/completions，圖片加 `modalities`；gpt-image 這類模型卡有 `imageApi` 的走 `POST /images`）；
 * 影片走非同步工作（`POST /videos` → 輪詢 → 帶 Key 下載 → 存進素材庫）。
 */
export function createOpenRouterDriver(
  options: OpenRouterDriverOptions,
): Required<Pick<JobDriver, 'submit' | 'poll'>> & { client: OpenRouterClient } {
  const client = new OpenRouterClient(options)
  const { services } = options

  async function generateImages(req: ImageRequest, ctx: DriverContext): Promise<SubmitResult> {
    const refs =
      req.capability === 'edit'
        ? await Promise.all(req.referenceAssets.map((hash) => toDataUri(services, hash)))
        : []
    // 一次呼叫只會回一張，要幾張就各送一次
    const results = await Promise.all(
      Array.from({ length: req.count }, (_, index) =>
        client.generateImage(
          {
            modelId: req.modelId,
            capability: req.capability,
            prompt: req.prompt,
            aspectRatio: req.aspectRatio,
            referenceDataUris: refs,
            // 同一個 seed 會得到同一張圖，多張時要錯開
            ...(req.seed === undefined ? {} : { seed: req.seed + index }),
          },
          ctx.signal,
        ),
      ),
    )
    const assets: AssetRef[] = []
    for (const result of results) {
      assets.push(await services.assets.put(result.bytes, result.mime || sniffMime(result.bytes)))
    }
    const costs = results.map((r) => r.costUsd)
    const costUsd = costs.every((c) => c === undefined)
      ? undefined
      : costs.reduce<number>((sum, c) => sum + (c ?? 0), 0)
    return {
      status: 'done',
      output: { kind: 'assets', assets },
      ...(costUsd === undefined ? {} : { costUsd }),
    }
  }

  /** 旁白：一次呼叫回一個 mp3；實收花費事後查，查不到就不回報（由呼叫端依牌價估算）。 */
  async function synthesize(req: TtsRequest, ctx: DriverContext): Promise<SubmitResult> {
    const voice = req.voiceId ?? options.defaultVoiceFor?.(req.modelId)
    if (voice === undefined) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: '這個旁白模型需要指定一個聲音，請到設定頁選擇。',
      })
    }
    const result = await client.speech({ modelId: req.modelId, text: req.text, voice }, ctx.signal)
    const asset = await services.assets.put(result.bytes, result.mime)
    const costUsd =
      result.generationId === undefined
        ? undefined
        : await client.generationCost(result.generationId, ctx.signal)
    return {
      status: 'done',
      output: { kind: 'assets', assets: [asset] },
      ...(costUsd === undefined ? {} : { costUsd }),
    }
  }

  async function videoBody(req: VideoRequest): Promise<Record<string, unknown>> {
    const base = {
      model: client.videoModel(req.modelId, req.capability),
      prompt: req.prompt,
      duration: Math.round(req.durationSec),
      aspect_ratio: req.aspectRatio,
      generate_audio: req.audio,
      ...(req.seed === undefined ? {} : { seed: req.seed }),
    }
    switch (req.capability) {
      case 't2v':
        return base
      case 'i2v': {
        if (!req.startFrameAsset) {
          throw new AppError({
            code: 'invalid_request',
            userMessage: '圖生影片需要一張起始畫面。',
          })
        }
        return {
          ...base,
          frame_images: [
            {
              ...imagePart(await toDataUri(services, req.startFrameAsset)),
              frame_type: 'first_frame',
            },
            ...(req.endFrameAsset
              ? [
                  {
                    ...imagePart(await toDataUri(services, req.endFrameAsset)),
                    frame_type: 'last_frame',
                  },
                ]
              : []),
          ],
        }
      }
      case 'r2v':
        return {
          ...base,
          input_references: await Promise.all(
            req.referenceAssets.map(async (hash) => imagePart(await toDataUri(services, hash))),
          ),
        }
    }
  }

  return {
    client,
    async submit(job: Job, ctx: DriverContext): Promise<SubmitResult> {
      const req = parseRequest(job)
      if (req.capability === 'llm') {
        const result = await client.chat(req, ctx.signal)
        return {
          status: 'done',
          output: {
            kind: 'text',
            text: result.text,
            ...(result.usage ? { usage: result.usage } : {}),
          },
          ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
        }
      }
      if (req.capability === 'tts') return synthesize(req, ctx)
      if (isVideo(req)) {
        const providerJobId = await client.submitVideo(await videoBody(req), ctx.signal)
        return { status: 'submitted', providerJobId }
      }
      return generateImages(req, ctx)
    },
    async poll(job: Job, ctx: DriverContext): Promise<PollResult> {
      const req = parseRequest(job)
      if (!isVideo(req) || !job.providerJobId) {
        throw new AppError({
          code: 'internal_error',
          userMessage: 'OpenRouter 只有影片任務需要輪詢。',
        })
      }
      const status = await client.videoStatus(job.providerJobId, ctx.signal)
      if (status.state === 'pending') return { status: 'pending' }
      if (status.state === 'failed') {
        return {
          status: 'failed',
          error: new AppError({
            code: 'provider_rejected',
            userMessage: 'OpenRouter 無法完成這個影片，請調整描述或換一個模型。',
            cause: new Error(status.reason),
          }).toShape(),
        }
      }
      try {
        const { bytes, mime } = await client.downloadVideo(
          job.providerJobId,
          ctx.signal,
          MAX_VIDEO_BYTES,
        )
        const asset = await services.assets.put(bytes, mime, { durationSec: req.durationSec })
        return {
          status: 'done',
          output: { kind: 'assets', assets: [asset] },
          ...(status.costUsd === undefined ? {} : { costUsd: status.costUsd }),
        }
      } catch (error) {
        // 不可重試的錯誤（檔案太大）回報為任務失敗；暫時性錯誤丟出去，下次輪詢再試
        if (isAppError(error) && !error.retryable && error.code !== 'cancelled') {
          return { status: 'failed', error: error.toShape() }
        }
        throw error
      }
    },
  }
}
