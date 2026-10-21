import { AppError } from '@svs/schema'

import { probe } from './probe'
import { runTool, type MediaTools, type RunOptions } from './run'

const BASE = ['-hide_banner', '-loglevel', 'error', '-y'] as const

/** 抽出某一秒的畫面存成 PNG（縮圖、取尾幀當下一鏡首幀都用它）。 */
export async function extractFrame(
  tools: MediaTools,
  input: string,
  output: string,
  options: RunOptions & { atSec?: number } = {},
): Promise<void> {
  await runTool(
    tools.ffmpegPath,
    [...BASE, '-ss', String(options.atSec ?? 0), '-i', input, '-frames:v', '1', output],
    options,
  )
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** 裁切圖片（三視圖切圖用）。座標與大小是像素。 */
export async function cropImage(
  tools: MediaTools,
  input: string,
  output: string,
  rect: CropRect,
  options: RunOptions = {},
): Promise<void> {
  const values = [rect.x, rect.y, rect.width, rect.height]
  if (
    !values.every((v) => Number.isInteger(v) && v >= 0) ||
    rect.width === 0 ||
    rect.height === 0
  ) {
    throw new AppError({ code: 'invalid_request', userMessage: '裁切範圍不正確。' })
  }
  await runTool(
    tools.ffmpegPath,
    [
      ...BASE,
      '-i',
      input,
      '-vf',
      `crop=${String(rect.width)}:${String(rect.height)}:${String(rect.x)}:${String(rect.y)}`,
      '-frames:v',
      '1',
      output,
    ],
    options,
  )
}

export interface ConcatOptions extends RunOptions {
  /** 輸出解析度；沒給就用第一段的。所有片段會等比縮放並補黑邊到這個大小。 */
  width?: number
  height?: number
  fps?: number
}

/**
 * 把多段影片接成一支。先把每段統一解析度與幀率（沒有聲音的補上靜音），
 * 再用 concat 濾鏡接起來，所以不同來源、不同大小的片段都能接。輸出 H.264 + AAC 的 MP4。
 */
export async function concatVideos(
  tools: MediaTools,
  inputs: readonly string[],
  output: string,
  options: ConcatOptions = {},
): Promise<void> {
  const [first] = inputs
  if (first === undefined) {
    throw new AppError({ code: 'invalid_request', userMessage: '沒有可以接的影片。' })
  }
  const firstInfo = await probe(tools, first, options)
  const width = even(options.width ?? firstInfo.width ?? 1280)
  const height = even(options.height ?? firstInfo.height ?? 720)
  const fps = options.fps ?? (firstInfo.fps ? Math.round(firstInfo.fps) : 24)

  const args: string[] = [...BASE]
  const filters: string[] = []
  const labels: string[] = []
  for (const [i, file] of inputs.entries()) {
    const info = await probe(tools, file, options)
    if (!info.hasVideo) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: '其中一個檔案沒有影像，沒辦法接成成品。',
      })
    }
    args.push('-i', file)
    filters.push(
      `[${String(i)}:v]scale=${String(width)}:${String(height)}:force_original_aspect_ratio=decrease,` +
        `pad=${String(width)}:${String(height)}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${String(fps)},format=yuv420p[v${String(i)}]`,
    )
    if (info.hasAudio) {
      filters.push(
        `[${String(i)}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${String(i)}]`,
      )
    } else {
      // 沒有聲音的片段補一段同長度的靜音，concat 濾鏡才接得起來
      filters.push(
        `anullsrc=r=44100:cl=stereo,atrim=duration=${info.durationSec.toFixed(3)}[a${String(i)}]`,
      )
    }
    labels.push(`[v${String(i)}][a${String(i)}]`)
  }
  filters.push(`${labels.join('')}concat=n=${String(inputs.length)}:v=1:a=1[v][a]`)
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    output,
  )
  await runTool(tools.ffmpegPath, args, options)
}

export interface ImageToVideoOptions extends RunOptions {
  durationSec: number
  fps?: number
  /** 加一條靜音音軌（接片時兩邊聲音規格一致）。 */
  silentAudio?: boolean
}

/** 一張圖變成指定長度的影片（示範模式的影片、以及之後的靜態鏡頭用）。 */
export async function imageToVideo(
  tools: MediaTools,
  image: string,
  output: string,
  options: ImageToVideoOptions,
): Promise<void> {
  if (!(options.durationSec > 0)) {
    throw new AppError({ code: 'invalid_request', userMessage: '影片長度必須大於 0 秒。' })
  }
  const fps = String(options.fps ?? 24)
  const args: string[] = [...BASE, '-loop', '1', '-framerate', fps, '-i', image]
  if (options.silentAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo')
  args.push(
    '-t',
    options.durationSec.toFixed(3),
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-r',
    fps,
  )
  if (options.silentAudio) args.push('-c:a', 'aac', '-shortest')
  args.push('-movflags', '+faststart', output)
  await runTool(tools.ffmpegPath, args, options)
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
