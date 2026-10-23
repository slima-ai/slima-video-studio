import { AppError, t } from '@svs/schema'

import { probe, type MediaInfo } from './probe'
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
    throw new AppError({ code: 'invalid_request', userMessage: t('errors.theTrimRangeIsnT') })
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

/** 接片的一段：整支，或只用 [inSec, outSec]（沒給的那端就是頭／尾）。 */
export interface ConcatInput {
  path: string
  inSec?: number | undefined
  outSec?: number | undefined
}

const sec6 = (n: number): string => n.toFixed(6)

export interface ConcatOptions extends RunOptions {
  /** 輸出解析度；沒給就用第一段的。所有片段會等比縮放並補黑邊到這個大小。 */
  width?: number
  height?: number
  fps?: number
}

/**
 * 接片的濾鏡圖（一行一個濾鏡鏈）。沒裁切的片段，字串和加入裁切之前逐字相同（測試釘住，舊專案的行為不變）。
 * 裁切的片段：畫面與聲音用同一組時間剪（用濾鏡逐格剪，不是切在關鍵格），
 * 再補滿／截到「整數格」，每段長度＝格數／幀率，接起來不累積誤差。
 */
export function buildConcatFilters(
  inputs: readonly ConcatInput[],
  infos: readonly MediaInfo[],
  size: { width: number; height: number; fps: number },
): string[] {
  const { width, height, fps } = size
  const filters: string[] = []
  const labels: string[] = []
  for (const [i, input] of inputs.entries()) {
    const info = infos[i]
    if (info === undefined) continue
    const scale =
      `scale=${String(width)}:${String(height)}:force_original_aspect_ratio=decrease,` +
      `pad=${String(width)}:${String(height)}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${String(fps)}`
    const audioFormat = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo'
    if (input.inSec === undefined && input.outSec === undefined) {
      filters.push(`[${String(i)}:v]${scale},format=yuv420p[v${String(i)}]`)
      if (info.hasAudio) {
        filters.push(`[${String(i)}:a]${audioFormat}[a${String(i)}]`)
      } else {
        // 沒有聲音的片段補一段同長度的靜音，concat 濾鏡才接得起來
        filters.push(
          `anullsrc=r=44100:cl=stereo,atrim=duration=${info.durationSec.toFixed(3)}[a${String(i)}]`,
        )
      }
    } else {
      const start = input.inSec ?? 0
      const end = input.outSec ?? info.durationSec
      const frames = Math.max(1, Math.round((end - start) * fps))
      const length = frames / fps
      filters.push(
        `[${String(i)}:v]trim=start=${sec6(start)}:end=${sec6(end)},setpts=PTS-STARTPTS,${scale},` +
          `tpad=stop_mode=clone:stop_duration=0.5,trim=end_frame=${String(frames)},setpts=PTS-STARTPTS,format=yuv420p[v${String(i)}]`,
      )
      if (info.hasAudio) {
        filters.push(
          `[${String(i)}:a]atrim=start=${sec6(start)}:end=${sec6(end)},asetpts=PTS-STARTPTS,${audioFormat},` +
            `apad,atrim=duration=${sec6(length)}[a${String(i)}]`,
        )
      } else {
        filters.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${sec6(length)}[a${String(i)}]`)
      }
    }
    labels.push(`[v${String(i)}][a${String(i)}]`)
  }
  filters.push(`${labels.join('')}concat=n=${String(inputs.length)}:v=1:a=1[v][a]`)
  return filters
}

/**
 * 把多段影片接成一支。先把每段統一解析度與幀率（沒有聲音的補上靜音），
 * 再用 concat 濾鏡接起來，所以不同來源、不同大小的片段都能接。輸出 H.264 + AAC 的 MP4。
 */
export async function concatVideos(
  tools: MediaTools,
  rawInputs: readonly (string | ConcatInput)[],
  output: string,
  options: ConcatOptions = {},
): Promise<void> {
  const inputs = rawInputs.map((i): ConcatInput => (typeof i === 'string' ? { path: i } : i))
  const [first] = inputs
  if (first === undefined) {
    throw new AppError({ code: 'invalid_request', userMessage: t('errors.thereAreNoVideosTo') })
  }
  const firstInfo = await probe(tools, first.path, options)
  const width = even(options.width ?? firstInfo.width ?? 1280)
  const height = even(options.height ?? firstInfo.height ?? 720)
  const fps = options.fps ?? (firstInfo.fps ? Math.round(firstInfo.fps) : 24)

  const args: string[] = [...BASE]
  const infos: MediaInfo[] = []
  for (const input of inputs) {
    const info = await probe(tools, input.path, options)
    if (!info.hasVideo) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: t('errors.oneOfTheFilesHas'),
      })
    }
    args.push('-i', input.path)
    infos.push(info)
  }
  const filters = buildConcatFilters(inputs, infos, { width, height, fps })
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[v]',
    '-map',
    '[a]',
    // 明確指定輸出幀率：concat 濾鏡的輸出沒有幀率資訊時，FFmpeg 7 會退回預設的 25 fps 重新取樣（多出 4% 的格）
    '-r',
    String(fps),
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
    throw new AppError({ code: 'invalid_request', userMessage: t('errors.theVideoLengthMustBe') })
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
