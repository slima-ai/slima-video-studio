import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { concatVideos, cropImage, extractFrame, imageToVideo } from './ops'
import { parseFfmpegBanner, probe } from './probe'
import { resolveTools, runTool } from './run'

const tools = resolveTools()
let dir = ''
const path = (name: string): string => join(dir, name)

/** 用 FFmpeg 自己的 lavfi 來源產生測試素材，不把二進位檔放進 repo。 */
async function makeClip(
  name: string,
  opts: { size: string; seconds: number; fps?: number; audio?: boolean },
): Promise<string> {
  const out = path(name)
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=${opts.size}:rate=${String(opts.fps ?? 24)}:duration=${String(opts.seconds)}`,
  ]
  if (opts.audio)
    args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${String(opts.seconds)}`)
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p')
  if (opts.audio) args.push('-c:a', 'aac', '-shortest')
  args.push(out)
  await runTool(tools.ffmpegPath, args)
  return out
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'svs-media-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveTools', () => {
  it('環境變數優先，其次是呼叫端給的路徑，最後用 PATH 上的名稱', () => {
    expect(resolveTools({}, {})).toEqual({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' })
    expect(resolveTools({ ffmpegPath: '/a/ffmpeg' }, {})).toMatchObject({ ffmpegPath: '/a/ffmpeg' })
    expect(
      resolveTools({ ffmpegPath: '/a/ffmpeg' }, { SVS_FFMPEG: '/env/ffmpeg' }).ffmpegPath,
    ).toBe('/env/ffmpeg')
  })

  it('ffprobePath 給 null 代表沒有 ffprobe（打包版只內建 ffmpeg）；環境變數仍然優先', () => {
    expect(resolveTools({ ffmpegPath: '/a/ffmpeg', ffprobePath: null }, {}).ffprobePath).toBeNull()
    expect(resolveTools({ ffprobePath: null }, { SVS_FFPROBE: '/env/ffprobe' }).ffprobePath).toBe(
      '/env/ffprobe',
    )
  })

  it('SVS_FFPROBE=none：沒有 ffprobe（跟打包版一樣），測試可以用它對「App 實際帶的 FFmpeg」跑', () => {
    expect(resolveTools({}, { SVS_FFPROBE: 'none' }).ffprobePath).toBeNull()
    expect(
      resolveTools({ ffprobePath: '/a/ffprobe' }, { SVS_FFPROBE: 'none' }).ffprobePath,
    ).toBeNull()
  })
})

describe('probe', () => {
  it('讀出時長、解析度、幀率與有沒有聲音', async () => {
    const silent = await makeClip('silent.mp4', { size: '320x180', seconds: 2 })
    const sound = await makeClip('sound.mp4', { size: '320x180', seconds: 2, audio: true })
    const a = await probe(tools, silent)
    expect(a).toMatchObject({ width: 320, height: 180, hasVideo: true, hasAudio: false })
    expect(a.durationSec).toBeCloseTo(2, 0)
    expect(a.fps).toBeCloseTo(24, 0)
    expect((await probe(tools, sound)).hasAudio).toBe(true)
  })

  it('檔案不存在或損毀時回報可讀的錯誤，原始訊息不在 userMessage 裡', async () => {
    await expect(probe(tools, path('nope.mp4'))).rejects.toMatchObject({ code: 'internal_error' })
    try {
      await probe(tools, path('nope.mp4'))
    } catch (error) {
      expect((error as { userMessage: string }).userMessage).not.toContain('nope.mp4')
    }
  })
})

describe('probe（沒有 ffprobe，改由 ffmpeg 讀）', () => {
  const noProbe = { ...tools, ffprobePath: null }

  it('跟 ffprobe 讀到一樣的時長、解析度、幀率與聲音', async () => {
    const silent = await makeClip('np-silent.mp4', { size: '320x180', seconds: 2, fps: 24 })
    const sound = await makeClip('np-sound.mp4', {
      size: '240x240',
      seconds: 3,
      fps: 30,
      audio: true,
    })
    for (const file of [silent, sound]) {
      const viaFfmpeg = await probe(noProbe, file)
      const viaFfprobe = await probe(tools, file)
      expect(viaFfmpeg).toMatchObject({
        width: viaFfprobe.width,
        height: viaFfprobe.height,
        hasAudio: viaFfprobe.hasAudio,
        hasVideo: true,
      })
      expect(viaFfmpeg.durationSec).toBeCloseTo(viaFfprobe.durationSec, 1)
      expect(viaFfmpeg.fps).toBeCloseTo(viaFfprobe.fps ?? 0, 0)
    }
  })

  it('檔案不存在或不是影片 → 可讀的錯誤', async () => {
    await expect(probe(noProbe, path('missing.mp4'))).rejects.toMatchObject({
      code: 'internal_error',
      userMessage: '讀不懂這個影片檔的資訊。',
    })
  })

  it('ffmpeg 不存在 → 請重新安裝', async () => {
    const error = await probe(
      { ffmpegPath: path('no-such-ffmpeg'), ffprobePath: null },
      path('x.mp4'),
    ).catch((e: unknown) => e)
    expect((error as { userMessage: string }).userMessage).toContain('找不到影片處理工具')
  })
})

describe('parseFfmpegBanner', () => {
  const banner = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:01:02.50, start: 0.000000, bitrate: 123 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 21 kb/s, 29.97 fps, 30 tbr, 12288 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 2 kb/s (default)
At least one output file must be specified`

  it('讀出時長、解析度、幀率與聲音（括號裡的十六進位不會被誤判成解析度）', () => {
    expect(parseFfmpegBanner(banner)).toEqual({
      durationSec: 62.5,
      width: 1920,
      height: 1080,
      fps: 29.97,
      hasAudio: true,
      hasVideo: true,
    })
  })

  it('只有聲音的檔案沒有寬高；沒有 fps 時改用 tbr', () => {
    expect(
      parseFfmpegBanner(`  Duration: 00:00:03.00, start: 0.0\n  Stream #0:0: Audio: mp3, 44100 Hz`),
    ).toEqual({ durationSec: 3, hasAudio: true, hasVideo: false })
    expect(
      parseFfmpegBanner(
        `  Duration: 00:00:01.00, start: 0.0\n  Stream #0:0: Video: vp9, yuv420p, 640x360, 25 tbr, 1k tbn`,
      ),
    ).toMatchObject({ width: 640, height: 360, fps: 25 })
  })

  it('完全讀不出資訊 → undefined', () => {
    expect(parseFfmpegBanner('x.mp4: No such file or directory')).toBeUndefined()
  })
})

describe('concatVideos', () => {
  it('不同解析度、幀率、有無聲音的片段接成一支，時長是各段相加', async () => {
    const a = await makeClip('a.mp4', { size: '320x180', seconds: 1, fps: 24 })
    const b = await makeClip('b.mp4', { size: '240x240', seconds: 2, fps: 30, audio: true })
    const c = await makeClip('c.mp4', { size: '640x360', seconds: 1, fps: 25 })
    const out = path('joined.mp4')
    await concatVideos(tools, [a, b, c], out, { width: 320, height: 180, fps: 24 })
    const info = await probe(tools, out)
    expect(info).toMatchObject({ width: 320, height: 180, hasAudio: true, hasVideo: true })
    expect(info.durationSec).toBeCloseTo(4, 0)
    expect(info.fps).toBeCloseTo(24, 0)
  })

  it('沒指定大小時沿用第一段；只有一段也能輸出', async () => {
    const a = await makeClip('only.mp4', { size: '320x180', seconds: 1 })
    const out = path('single.mp4')
    await concatVideos(tools, [a], out)
    expect(await probe(tools, out)).toMatchObject({ width: 320, height: 180, hasAudio: true })
  })

  it('沒有片段、或包含沒有影像的檔案時拒絕', async () => {
    await expect(concatVideos(tools, [], path('x.mp4'))).rejects.toMatchObject({
      code: 'invalid_request',
    })
    const wav = path('tone.wav')
    await runTool(tools.ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=duration=1',
      wav,
    ])
    await expect(concatVideos(tools, [wav], path('y.mp4'))).rejects.toMatchObject({
      code: 'invalid_request',
    })
  })

  it('取消時中止 FFmpeg', async () => {
    const a = await makeClip('cancel.mp4', { size: '320x180', seconds: 1 })
    const controller = new AbortController()
    controller.abort()
    await expect(
      concatVideos(tools, [a], path('z.mp4'), { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'cancelled',
    })
  })
})

describe('extractFrame / cropImage / imageToVideo', () => {
  it('抽出指定秒數的畫面；裁切圖片；一張圖變成指定長度的影片', async () => {
    const clip = await makeClip('frames.mp4', { size: '320x180', seconds: 2 })
    const frame = path('frame.png')
    await extractFrame(tools, clip, frame, { atSec: 1 })
    expect(statSync(frame).size).toBeGreaterThan(100)
    expect(await probe(tools, frame)).toMatchObject({ width: 320, height: 180 })

    const crop = path('crop.png')
    await cropImage(tools, frame, crop, { x: 10, y: 20, width: 100, height: 50 })
    expect(await probe(tools, crop)).toMatchObject({ width: 100, height: 50 })

    const video = path('from-image.mp4')
    await imageToVideo(tools, frame, video, { durationSec: 3, silentAudio: true })
    const info = await probe(tools, video)
    expect(info.durationSec).toBeCloseTo(3, 0)
    expect(info).toMatchObject({ width: 320, height: 180, hasAudio: true })

    const noAudio = path('from-image-silent.mp4')
    await imageToVideo(tools, frame, noAudio, { durationSec: 1 })
    expect((await probe(tools, noAudio)).hasAudio).toBe(false)
  })

  it('不合法的參數被擋下', async () => {
    const frame = path('frame.png')
    await expect(
      cropImage(tools, frame, path('bad.png'), { x: 0, y: 0, width: 0, height: 10 }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    })
    await expect(
      cropImage(tools, frame, path('bad.png'), { x: -1, y: 0, width: 10, height: 10 }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    })
    await expect(
      imageToVideo(tools, frame, path('bad.mp4'), { durationSec: 0 }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    })
  })
})

describe('runTool', () => {
  it('找不到執行檔時說明是缺少 FFmpeg', async () => {
    await expect(runTool('/definitely/not/here', [])).rejects.toMatchObject({
      code: 'internal_error',
      userMessage: expect.stringContaining('FFmpeg') as string,
    })
  })
})
