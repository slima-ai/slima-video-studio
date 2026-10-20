import type { ProjectHandle } from '@svs/db'
import type { JobDriver } from '@svs/engine'
import { probe, trimLetterbox, type MediaTools } from '@svs/media'
import {
  GenerationOutputSchema,
  GenerationRequestSchema,
  type AspectRatio,
  type AssetRef,
  type Job,
  type PollResult,
  type SubmitResult,
} from '@svs/schema'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 一張圖：沒有黑邊就原樣回傳；有（上下或左右兩條差不多寬）就裁掉、補回要求的比例、存成新素材並標 letterboxTrimmed。 */
async function trimAsset(
  deps: { handle: ProjectHandle; tools: MediaTools },
  image: AssetRef,
  aspectRatio: AspectRatio,
  signal: AbortSignal,
): Promise<AssetRef> {
  const { handle, tools } = deps
  const found = handle.assets.find(image.hash)
  if (!found) return image
  const [w, h] = aspectRatio.split(':').map(Number)
  if (!w || !h) return image
  const dir = await mkdtemp(join(tmpdir(), 'svs-letterbox-'))
  try {
    const out = join(dir, 'trimmed.png')
    if (!(await trimLetterbox(tools, found.path, out, w / h, { signal }))) return image
    const info = await probe(tools, out, { signal })
    const meta = {
      ...(info.width ? { width: info.width } : {}),
      ...(info.height ? { height: info.height } : {}),
    }
    const stored = await handle.assets.put(new Uint8Array(await readFile(out)), 'image/png', meta)
    return {
      hash: stored.hash,
      kind: 'image',
      mime: 'image/png',
      bytes: stored.bytes,
      ...meta,
      letterboxTrimmed: true,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 首幀圖（請求帶 `trimLetterbox`）生成完、存進素材庫之前，把模型自己畫上去的黑邊裁掉。
 * 在任務佇列裡做（任務完成時輸出的就是裁好的圖）：所以「生成中」會一直到裁完，花費與時間的查詢
 * （用任務輸出的素材雜湊）不用另外處理。裁圖失敗用原圖，不讓已經花掉的生成作廢；取消照樣丟出。
 */
export function withLetterboxTrim<D extends JobDriver>(
  driver: D,
  deps: { handle: ProjectHandle; tools: MediaTools | undefined },
): D {
  const { tools } = deps
  if (!tools) return driver
  const trim = async <R extends SubmitResult | PollResult>(
    job: Job,
    result: R,
    signal: AbortSignal,
  ): Promise<R> => {
    if (result.status !== 'done') return result
    const parsed = GenerationRequestSchema.safeParse(job.input)
    const request = parsed.success ? parsed.data : undefined
    if (
      !request ||
      (request.capability !== 't2i' && request.capability !== 'edit') ||
      request.trimLetterbox !== true
    ) {
      return result
    }
    const aspectRatio = request.aspectRatio
    const output = GenerationOutputSchema.safeParse(result.output)
    if (!output.success || output.data.kind !== 'assets') return result
    try {
      const assets = await Promise.all(
        output.data.assets.map((asset) =>
          asset.kind === 'image'
            ? trimAsset({ handle: deps.handle, tools }, asset, aspectRatio, signal)
            : Promise.resolve(asset),
        ),
      )
      return { ...result, output: { kind: 'assets', assets } }
    } catch (error) {
      if (signal.aborted) throw error
      return result
    }
  }
  const { poll } = driver
  return {
    ...driver,
    submit: async (job, ctx) => trim(job, await driver.submit(job, ctx), ctx.signal),
    ...(poll
      ? {
          poll: async (job: Job, ctx: { signal: AbortSignal }) =>
            trim(job, await poll(job, ctx), ctx.signal),
        }
      : {}),
  }
}
