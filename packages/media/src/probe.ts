import { AppError } from '@svs/schema'
import { z } from 'zod'

import { runTool, runToolRaw, type MediaTools, type RunOptions } from './run'

export interface MediaInfo {
  durationSec: number
  /** 沒有影像（純音訊）時沒有寬高。 */
  width?: number
  height?: number
  fps?: number
  hasAudio: boolean
  hasVideo: boolean
}

const ProbeSchema = z.object({
  format: z.object({ duration: z.string().optional() }).optional(),
  streams: z
    .array(
      z.object({
        codec_type: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        r_frame_rate: z.string().optional(),
        duration: z.string().optional(),
      }),
    )
    .default([]),
})

function parseFps(rate: string | undefined): number | undefined {
  if (!rate) return undefined
  const [num, den] = rate.split('/').map(Number)
  if (
    num === undefined ||
    den === undefined ||
    !Number.isFinite(num) ||
    !Number.isFinite(den) ||
    den === 0
  ) {
    return undefined
  }
  return num / den
}

/**
 * 沒有 ffprobe 時，從 `ffmpeg -i` 印出的檔案資訊讀（ffmpeg 內建的說明文字，格式很多年沒變）：
 *   Duration: 00:00:09.04, start: 0.000000, bitrate: 123 kb/s
 *   Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p, 640x360 [SAR 1:1 DAR 16:9], 24 fps, 24 tbr
 *   Stream #0:1: Audio: aac (LC), 44100 Hz, stereo
 */
export function parseFfmpegBanner(stderr: string): MediaInfo | undefined {
  const streams = [...stderr.matchAll(/^\s*Stream #\S+: (Video|Audio|Subtitle|Data): (.*)$/gm)]
  const video = streams.find((m) => m[1] === 'Video')
  const hasAudio = streams.some((m) => m[1] === 'Audio')
  const clock = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  if (!clock && streams.length === 0) return undefined
  const duration = clock ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : 0

  // 先拿掉括號裡的內容（像 0x31637661、[SAR 1:1 DAR 16:9]），避免誤判成寬x高
  const line = (video?.[2] ?? '').replaceAll(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  const size = /\b(\d{2,5})x(\d{2,5})\b/.exec(line)
  const fps = /(\d+(?:\.\d+)?) fps/.exec(line) ?? /(\d+(?:\.\d+)?) tbr/.exec(line)
  return {
    durationSec: Number.isFinite(duration) ? duration : 0,
    ...(size?.[1] && size[2] ? { width: Number(size[1]), height: Number(size[2]) } : {}),
    ...(fps?.[1] ? { fps: Number(fps[1]) } : {}),
    hasAudio,
    hasVideo: video !== undefined,
  }
}

const unreadable = (cause?: unknown): AppError =>
  new AppError({
    code: 'internal_error',
    userMessage: '讀不懂這個影片檔的資訊。',
    ...(cause === undefined ? {} : { cause }),
  })

/** 讀時長、解析度、幀率與有沒有聲音：有 ffprobe 就用它，沒有就請 ffmpeg 印檔案資訊。 */
export async function probe(
  tools: MediaTools,
  file: string,
  options: RunOptions = {},
): Promise<MediaInfo> {
  if (tools.ffprobePath === null) {
    // ffmpeg 只給輸入檔會「沒有輸出」而以結束碼 1 收場，但檔案資訊已經印出來了
    const { stderr } = await runToolRaw(tools.ffmpegPath, ['-hide_banner', '-i', file], options)
    const info = parseFfmpegBanner(stderr)
    if (!info) throw unreadable(new Error(stderr))
    return info
  }
  const stdout = await runTool(
    tools.ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    options,
  )
  const parsed = ProbeSchema.safeParse(JSON.parse(stdout))
  if (!parsed.success) throw unreadable()
  const video = parsed.data.streams.find((s) => s.codec_type === 'video')
  const audio = parsed.data.streams.find((s) => s.codec_type === 'audio')
  const duration = Number(parsed.data.format?.duration ?? video?.duration ?? audio?.duration ?? 0)
  const fps = parseFps(video?.r_frame_rate)
  return {
    durationSec: Number.isFinite(duration) ? duration : 0,
    ...(video?.width ? { width: video.width } : {}),
    ...(video?.height ? { height: video.height } : {}),
    ...(fps === undefined ? {} : { fps }),
    hasAudio: audio !== undefined,
    hasVideo: video !== undefined,
  }
}
