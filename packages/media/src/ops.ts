import { AppError, STILL_MOTIONS, t, type StillMotion } from '@svs/schema'

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
  /** 這一段開頭淡入（畫面從黑、聲音從無聲）幾秒；沒給或 0 就沒有淡入。 */
  fadeInSec?: number | undefined
  /** 這一段結尾淡出（畫面變黑、聲音漸弱）幾秒；沒給或 0 就沒有淡出。 */
  fadeOutSec?: number | undefined
}

const sec6 = (n: number): string => n.toFixed(6)

/**
 * 這一段的淡入淡出（秒）：沒給或 ≤ 0 就是 0；各自最多是片段長度的一半（太長就縮短，淡入淡出不會重疊、起點不會是負的）。
 */
function fadeSecs(input: ConcatInput, lengthSec: number): { in: number; out: number } {
  const cap = lengthSec / 2
  const clean = (n: number | undefined): number => (n !== undefined && n > 0 ? Math.min(n, cap) : 0)
  return { in: clean(input.fadeInSec), out: clean(input.fadeOutSec) }
}

/** 淡入淡出接在濾鏡鏈最後面；沒有淡入淡出就是空字串（濾鏡字串跟加這個功能之前逐字相同）。 */
function fadeTail(
  kind: 'fade' | 'afade',
  fade: { in: number; out: number },
  lengthSec: number,
): string {
  return (
    (fade.in > 0 ? `,${kind}=t=in:st=0:d=${sec6(fade.in)}` : '') +
    (fade.out > 0 ? `,${kind}=t=out:st=${sec6(lengthSec - fade.out)}:d=${sec6(fade.out)}` : '')
  )
}

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
      const fade = fadeSecs(input, info.durationSec)
      filters.push(
        `[${String(i)}:v]${scale},format=yuv420p${fadeTail('fade', fade, info.durationSec)}[v${String(i)}]`,
      )
      if (info.hasAudio) {
        filters.push(
          `[${String(i)}:a]${audioFormat}${fadeTail('afade', fade, info.durationSec)}[a${String(i)}]`,
        )
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
      const fade = fadeSecs(input, length)
      filters.push(
        `[${String(i)}:v]trim=start=${sec6(start)}:end=${sec6(end)},setpts=PTS-STARTPTS,${scale},` +
          `tpad=stop_mode=clone:stop_duration=0.5,trim=end_frame=${String(frames)},setpts=PTS-STARTPTS,format=yuv420p${fadeTail('fade', fade, length)}[v${String(i)}]`,
      )
      if (info.hasAudio) {
        filters.push(
          `[${String(i)}:a]atrim=start=${sec6(start)}:end=${sec6(end)},asetpts=PTS-STARTPTS,${audioFormat},` +
            `apad,atrim=duration=${sec6(length)}${fadeTail('afade', fade, length)}[a${String(i)}]`,
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

export { STILL_MOTIONS, type StillMotion }

/** 推近、拉遠、左右移動的幅度：畫面最多放大到 1.12 倍（慢推到最後比第一格大 12%）。 */
const STILL_ZOOM = 0.12

export interface StillFilterOptions {
  width: number
  height: number
  fps: number
  /** 輸出幾格。 */
  frames: number
  motion: StillMotion
}

/**
 * 一張圖變成運鏡影片的濾鏡（`-vf`）。先把圖放大（4 倍，輸出很大時 2 倍）、等比例填滿再 zoompan：
 * zoompan 的位置只能算到整數像素，不先放大，慢推時畫面會一格一格地抖。圖片比例和輸出不同時，等比例放大並裁掉多的邊（不留黑邊）。
 */
export function buildStillFilter(options: StillFilterOptions): string {
  const { width, height, fps, frames, motion } = options
  const factor = Math.max(2, Math.min(4, Math.floor(4096 / width)))
  const bigW = width * factor
  const bigH = height * factor
  // on＝第幾格（從 0 起）；最後一格剛好走完全程
  const progress = frames > 1 ? `on/${String(frames - 1)}` : '0'
  const centerX = 'iw/2-(iw/zoom/2)'
  const centerY = 'ih/2-(ih/zoom/2)'
  const zoom = String(1 + STILL_ZOOM)
  const motions: Record<StillMotion, { z: string; x: string; y: string }> = {
    zoom_in: { z: `1+${String(STILL_ZOOM)}*${progress}`, x: centerX, y: centerY },
    zoom_out: { z: `${zoom}-${String(STILL_ZOOM)}*${progress}`, x: centerX, y: centerY },
    pan_right: { z: zoom, x: `(iw-iw/zoom)*${progress}`, y: centerY },
    pan_left: { z: zoom, x: `(iw-iw/zoom)*(1-${progress})`, y: centerY },
    none: { z: '1', x: '0', y: '0' },
  }
  const m = motions[motion]
  return (
    `scale=${String(bigW)}:${String(bigH)}:force_original_aspect_ratio=increase,crop=${String(bigW)}:${String(bigH)},` +
    `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${String(frames)}:s=${String(width)}x${String(height)}:fps=${String(fps)},` +
    'format=yuv420p'
  )
}

export interface StillToVideoOptions extends RunOptions {
  durationSec: number
  /** 輸出的寬高（要是偶數）。 */
  width: number
  height: number
  fps?: number
  /** 預設不動。 */
  motion?: StillMotion
}

/**
 * 一張圖變成一段有運鏡的影片（靜態鏡頭、字卡、片名卡都靠它）。長度是整數格：round(秒數 × fps) 格，
 * 帶一條靜音音軌（接片時各段聲音規格一致）。輸出 H.264 + AAC 的 MP4。
 */
export async function stillToVideo(
  tools: MediaTools,
  image: string,
  output: string,
  options: StillToVideoOptions,
): Promise<void> {
  if (!(options.durationSec > 0)) {
    throw new AppError({ code: 'invalid_request', userMessage: t('errors.theVideoLengthMustBe') })
  }
  const fps = options.fps ?? 24
  const frames = Math.max(1, Math.round(options.durationSec * fps))
  const filter = buildStillFilter({
    width: even(options.width),
    height: even(options.height),
    fps,
    frames,
    motion: options.motion ?? 'none',
  })
  await runTool(
    tools.ffmpegPath,
    [
      ...BASE,
      '-i',
      image,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=stereo',
      '-vf',
      filter,
      '-frames:v',
      String(frames),
      '-t',
      sec6(frames / fps),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(fps),
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      output,
    ],
    options,
  )
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
