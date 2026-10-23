import type { ProjectHandle } from '@svs/db'
import type { JobQueue } from '@svs/engine'
import { concatVideos, probe, type MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  GenerationOutputSchema,
  type AssetRef,
  type GenerationRequest,
  type Job,
  type JobKind,
  type ModelCard,
  type VideoRequest,
  t,
} from '@svs/schema'
import {
  resolveCameraMove,
  type GenerateContext,
  type GenerateResult,
  type StudioServices,
} from '@svs/workflows'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const JOB_KIND: Record<GenerationRequest['capability'], JobKind> = {
  llm: 'llm',
  t2i: 'image',
  edit: 'image',
  t2v: 'video',
  i2v: 'video',
  r2v: 'video',
  tts: 'tts',
  music: 'music',
}

/** ModelCard id 的第一段就是供應商（fal/…、openrouter/…、mock/…）。 */
export function providerOf(modelId: string): string {
  return modelId.split('/')[0] ?? modelId
}

function jobError(job: Job): AppError {
  if (job.status === 'cancelled')
    return new AppError({ code: 'cancelled', userMessage: t('services.cancelled') })
  const shape = job.error
  return new AppError({
    code: shape?.code ?? 'internal_error',
    retryable: shape?.retryable ?? false,
    userMessage: shape?.userMessage ?? t('services.generationFailedPleaseTryAgain'),
  })
}

/** 把兩份英文逗號分隔的清單接起來，相同的詞（不分大小寫）只留第一個。 */
export function mergeTerms(base: string, extra: string | undefined): string {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of `${base},${extra ?? ''}`.split(',')) {
    const term = raw.trim()
    if (term === '' || seen.has(term.toLowerCase())) continue
    seen.add(term.toLowerCase())
    terms.push(term)
  }
  return terms.join(', ')
}

/**
 * 影片的負面提示：模型卡有 `negativePrompt` 才送（沒有的模型一律不送）。
 * 使用者在設定頁改過的清單（節點參數帶進來）優先，沒有就用卡上內建的；走 OpenRouter 時一併帶上實際供應商的 slug。
 */
export function withNegativePrompt<R extends VideoRequest>(
  request: R,
  card: Pick<ModelCard, 'negativePrompt'> | undefined,
): R {
  const spec = card?.negativePrompt
  const rest: Partial<VideoRequest> = { ...request }
  delete rest.negativePrompt
  delete rest.negativePromptRoute
  delete rest.negativeExtra
  // 模型不接受負面提示：就算有人在請求裡帶了也拿掉，不送給供應商
  if (!spec) return rest as R
  return {
    ...rest,
    // 通用清單（使用者改過的，或模型卡內建的）後面接上出場角色不要出現的特徵
    negativePrompt: mergeTerms(request.negativePrompt ?? spec.default, request.negativeExtra),
    ...(spec.routeProvider === undefined ? {} : { negativePromptRoute: spec.routeProvider }),
  } as R
}

export interface StudioDeps {
  queue: JobQueue
  handle: ProjectHandle
  tools: MediaTools
  /** 查模型的運鏡設定與偏好語言；沒給就一律把運鏡加進 Prompt。 */
  models?: Pick<ModelRegistry, 'get'>
}

/** 把任務佇列與媒體工具包成節點用的 StudioServices。 */
export function createStudioServices({ queue, handle, tools, models }: StudioDeps): StudioServices {
  return {
    async generate(original, ctx: GenerateContext): Promise<GenerateResult> {
      // 影片的運鏡在這裡換成模型看得懂的形式：原生參數，或加進 Prompt
      const request =
        original.capability === 't2v' ||
        original.capability === 'i2v' ||
        original.capability === 'r2v'
          ? withNegativePrompt(
              resolveCameraMove(original, models?.get(original.modelId)),
              models?.get(original.modelId),
            )
          : original
      const provider = providerOf(request.modelId)
      const job = queue.enqueue({
        provider,
        modelId: request.modelId,
        kind: JOB_KIND[request.capability],
        input: request,
        ...(ctx.nodeRunId === undefined ? {} : { nodeRunId: ctx.nodeRunId }),
      })
      const onAbort = (): void => {
        queue.cancel(job.id)
      }
      if (ctx.signal.aborted) onAbort()
      ctx.signal.addEventListener('abort', onAbort, { once: true })
      try {
        const done = await queue.wait(job.id)
        if (done.status !== 'succeeded') throw jobError(done)
        const parsed = GenerationOutputSchema.safeParse(done.output)
        if (!parsed.success) {
          throw new AppError({
            code: 'invalid_response',
            userMessage: t('services.theProviderReturnedContentIn'),
          })
        }
        return {
          output: parsed.data,
          provider,
          jobId: done.id,
          ...(done.costUsd === undefined ? {} : { costUsd: done.costUsd }),
        }
      } finally {
        ctx.signal.removeEventListener('abort', onAbort)
      }
    },

    async concatVideos(videos, ctx): Promise<AssetRef> {
      const paths = videos.map((v) => {
        const found = handle.assets.find(v.hash)
        if (!found) {
          throw new AppError({
            code: 'invalid_request',
            userMessage: t('services.canTFindOneOf'),
          })
        }
        return found.path
      })
      const dir = await mkdtemp(join(tmpdir(), 'svs-concat-'))
      try {
        const out = join(dir, 'joined.mp4')
        await concatVideos(tools, paths, out, { signal: ctx.signal })
        const info = await probe(tools, out, { signal: ctx.signal })
        const meta = {
          ...(info.width ? { width: info.width } : {}),
          ...(info.height ? { height: info.height } : {}),
          durationSec: info.durationSec,
        }
        const stored = await handle.assets.put(
          new Uint8Array(await readFile(out)),
          'video/mp4',
          meta,
        )
        return { hash: stored.hash, kind: 'video', mime: 'video/mp4', bytes: stored.bytes, ...meta }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}
