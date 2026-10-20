import type { ProjectHandle } from '@svs/db'
import type { JobQueue } from '@svs/engine'
import { concatVideos, probe, trimLetterbox, type MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  GenerationOutputSchema,
  type AssetRef,
  type GenerationRequest,
  type Job,
  type JobKind,
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
    return new AppError({ code: 'cancelled', userMessage: '已取消。' })
  const shape = job.error
  return new AppError({
    code: shape?.code ?? 'internal_error',
    retryable: shape?.retryable ?? false,
    userMessage: shape?.userMessage ?? '生成失敗，請再試一次。',
  })
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
          ? resolveCameraMove(original, models?.get(original.modelId))
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
            userMessage: '供應商回傳的內容格式不對。',
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

    async trimLetterbox(image, aspectRatio, ctx): Promise<AssetRef> {
      const found = handle.assets.find(image.hash)
      if (!found) return image
      const [w, h] = aspectRatio.split(':').map(Number)
      if (!w || !h) return image
      const dir = await mkdtemp(join(tmpdir(), 'svs-letterbox-'))
      try {
        const out = join(dir, 'trimmed.png')
        // 沒有黑邊就什麼都不做；有（上下或左右兩條差不多寬）就裁掉、補回 aspectRatio、放大回原尺寸
        if (!(await trimLetterbox(tools, found.path, out, w / h, { signal: ctx.signal }))) {
          return image
        }
        const info = await probe(tools, out, { signal: ctx.signal })
        const meta = {
          ...(info.width ? { width: info.width } : {}),
          ...(info.height ? { height: info.height } : {}),
        }
        const stored = await handle.assets.put(
          new Uint8Array(await readFile(out)),
          'image/png',
          meta,
        )
        return { hash: stored.hash, kind: 'image', mime: 'image/png', bytes: stored.bytes, ...meta }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },

    async concatVideos(videos, ctx): Promise<AssetRef> {
      const paths = videos.map((v) => {
        const found = handle.assets.find(v.hash)
        if (!found) {
          throw new AppError({
            code: 'invalid_request',
            userMessage: '找不到其中一段影片，可能已被刪除。',
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
