import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  STILL_MOTIONS,
  buildConcatFilters,
  buildStillFilter,
  concatVideos,
  extractFrame,
  stillToVideo,
} from './ops'
import { probe, type MediaInfo } from './probe'
import { resolveTools, runTool, runToolRaw } from './run'

const tools = resolveTools()
let dir = ''
const path = (name: string): string => join(dir, name)

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'svs-stills-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 黑底、正中央一個白色方塊的圖（方塊是畫面寬的 1/4）：運鏡之後量方塊的大小與位置，就知道鏡頭怎麼動。 */
async function makeBoxImage(name: string, width: number, height: number): Promise<string> {
  const out = path(name)
  const box = Math.round(width / 4)
  await runTool(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${String(width)}x${String(height)},drawbox=x=${String((width - box) / 2)}:y=${String((height - box) / 2)}:w=${String(box)}:h=${String(box)}:color=white:t=fill`,
    '-frames:v',
    '1',
    out,
  ])
  return out
}

async function makeClip(name: string, seconds: number, audio = true): Promise<string> {
  const out = path(name)
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=320x180:rate=24:duration=${String(seconds)}`,
  ]
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${String(seconds)}`)
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p')
  if (audio) args.push('-c:a', 'aac', '-shortest')
  args.push(out)
  await runTool(tools.ffmpegPath, args)
  return out
}

/** 影片有幾格（解碼數出來，不靠容器上寫的長度）。 */
async function frameCount(file: string): Promise<number> {
  const result = await runToolRaw(tools.ffmpegPath, [
    '-hide_banner',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-f',
    'null',
    '-',
  ])
  const counts = [...result.stderr.matchAll(/frame=\s*(\d+)/g)].map((m) => Number(m[1]))
  return counts.at(-1) ?? 0
}

/** 抽一格，量裡面白色方塊的外框（cropdetect）：寬、高與中心點。 */
async function boxOf(
  video: string,
  atSec: number,
  name: string,
): Promise<{ w: number; h: number; cx: number; cy: number }> {
  const png = path(name)
  await extractFrame(tools, video, png, { atSec })
  const result = await runToolRaw(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    png,
    '-vf',
    'cropdetect=limit=0.2:round=2:skip=0,metadata=print:file=-',
    '-frames:v',
    '1',
    '-f',
    'null',
    '-',
  ])
  const pick = (key: string): number => {
    const found = new RegExp(`lavfi\\.cropdetect\\.${key}=(\\d+)`).exec(result.stdout)
    if (!found)
      throw new Error(`量不到方塊：${result.stdout.slice(-300)}${result.stderr.slice(-300)}`)
    return Number(found[1])
  }
  const w = pick('w')
  const h = pick('h')
  const x = pick('x')
  const y = pick('y')
  return { w, h, cx: x + w / 2, cy: y + h / 2 }
}

/** 抽一格，回平均亮度（0～255；黑是 16 上下）。 */
async function lumaAt(video: string, atSec: number): Promise<number> {
  const result = await runToolRaw(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(atSec),
    '-i',
    video,
    '-vf',
    'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-frames:v',
    '1',
    '-f',
    'null',
    '-',
  ])
  const found = /YAVG=([\d.]+)/.exec(result.stdout)
  if (!found)
    throw new Error(`量不到亮度：${result.stdout.slice(-200)}${result.stderr.slice(-200)}`)
  return Number(found[1])
}

/** 平均音量（RMS，dB）：0 秒起算 length 秒。靜音是 -inf 或非常小。 */
async function rmsDb(video: string, fromSec: number, lengthSec: number): Promise<number> {
  const result = await runToolRaw(tools.ffmpegPath, [
    '-hide_banner',
    '-ss',
    String(fromSec),
    '-t',
    String(lengthSec),
    '-i',
    video,
    '-vn',
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ])
  const found = /mean_volume: (-?[\d.]+|-inf) dB/.exec(result.stderr)
  if (!found) throw new Error(`量不到音量：${result.stderr.slice(-300)}`)
  return found[1] === '-inf' ? -200 : Number(found[1])
}

describe('buildStillFilter：每種運鏡的濾鏡字串', () => {
  it('五種運鏡都有；全部先把圖放大再做 zoompan（避免慢推時抖動），輸出整數格', () => {
    expect([...STILL_MOTIONS]).toEqual(['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'none'])
    for (const motion of STILL_MOTIONS) {
      const filter = buildStillFilter({ width: 1280, height: 720, fps: 24, frames: 72, motion })
      expect(filter, motion).toMatch(/^scale=\d+:\d+:/)
      expect(filter, motion).toContain('zoompan=')
      expect(filter, motion).toContain('d=72')
      expect(filter, motion).toContain('s=1280x720')
      expect(filter, motion).toContain('fps=24')
      expect(filter, motion).toMatch(/format=yuv420p$/)
    }
  })

  it('運鏡不同，z 與 x 的算式就不同；不動就是固定 1 倍', () => {
    const filters = new Set(
      STILL_MOTIONS.map((motion) =>
        buildStillFilter({ width: 640, height: 360, fps: 24, frames: 48, motion }),
      ),
    )
    expect(filters.size).toBe(STILL_MOTIONS.length)
    expect(
      buildStillFilter({ width: 640, height: 360, fps: 24, frames: 48, motion: 'none' }),
    ).toContain("z='1'")
  })
})

describe('stillToVideo（真的 FFmpeg）', () => {
  it('輸出剛好是 round(秒數×fps) 格、有一條靜音音軌、解析度對（橫式與直式）', async () => {
    for (const [width, height] of [
      [640, 360],
      [360, 640],
    ] as const) {
      const image = await makeBoxImage(`box-${String(width)}.png`, 1280, 720)
      for (const [seconds, fps] of [
        [2.5, 24],
        [1.3, 30],
      ] as const) {
        const out = path(`still-${String(width)}-${String(seconds)}.mp4`)
        await stillToVideo(tools, image, out, {
          durationSec: seconds,
          fps,
          width,
          height,
          motion: 'zoom_in',
        })
        expect(
          await frameCount(out),
          `${String(width)}x${String(height)} ${String(seconds)}s`,
        ).toBe(Math.round(seconds * fps))
        const info: MediaInfo = await probe(tools, out)
        expect(info).toMatchObject({ width, height, hasAudio: true, hasVideo: true })
        expect(info.fps).toBeCloseTo(fps, 0)
        // 音軌是靜音
        expect(await rmsDb(out, 0, Math.min(seconds, 1))).toBeLessThan(-60)
      }
    }
  })

  it('慢推近：最後一格與第一格不同，而且中心的方塊被放大；第一格是原圖的大小', async () => {
    const image = await makeBoxImage('box-zoom.png', 1280, 720)
    const out = path('zoom-in.mp4')
    await stillToVideo(tools, image, out, {
      durationSec: 2,
      fps: 24,
      width: 640,
      height: 360,
      motion: 'zoom_in',
    })
    const first = await boxOf(out, 0, 'zin-first.png')
    const last = await boxOf(out, 2 - 1 / 24, 'zin-last.png')
    // 640 寬的畫面裡方塊本來是 1/4 ＝ 160
    expect(first.w).toBeGreaterThanOrEqual(156)
    expect(first.w).toBeLessThanOrEqual(164)
    expect(last.w).toBeGreaterThan(first.w * 1.06)
    // 中心不動
    expect(Math.abs(last.cx - first.cx)).toBeLessThan(4)
    expect(Math.abs(last.cy - first.cy)).toBeLessThan(4)
  })

  it('慢拉遠：反過來，方塊越來越小', async () => {
    const image = await makeBoxImage('box-zoomout.png', 1280, 720)
    const out = path('zoom-out.mp4')
    await stillToVideo(tools, image, out, {
      durationSec: 2,
      fps: 24,
      width: 640,
      height: 360,
      motion: 'zoom_out',
    })
    const first = await boxOf(out, 0, 'zout-first.png')
    const last = await boxOf(out, 2 - 1 / 24, 'zout-last.png')
    expect(first.w).toBeGreaterThan(last.w * 1.06)
  })

  it('左移、右移：畫面內容朝反方向走，大小不變；不動：每一格都一樣', async () => {
    const image = await makeBoxImage('box-pan.png', 1280, 720)
    const left = path('pan-left.mp4')
    const right = path('pan-right.mp4')
    await stillToVideo(tools, image, left, {
      durationSec: 2,
      fps: 24,
      width: 640,
      height: 360,
      motion: 'pan_left',
    })
    await stillToVideo(tools, image, right, {
      durationSec: 2,
      fps: 24,
      width: 640,
      height: 360,
      motion: 'pan_right',
    })
    const l0 = await boxOf(left, 0, 'pl0.png')
    const l1 = await boxOf(left, 2 - 1 / 24, 'pl1.png')
    const r0 = await boxOf(right, 0, 'pr0.png')
    const r1 = await boxOf(right, 2 - 1 / 24, 'pr1.png')
    // 鏡頭往左移＝內容往右走
    expect(l1.cx).toBeGreaterThan(l0.cx + 10)
    expect(r1.cx).toBeLessThan(r0.cx - 10)
    expect(Math.abs(l1.w - l0.w)).toBeLessThan(6)

    const still = path('none.mp4')
    await stillToVideo(tools, image, still, {
      durationSec: 2,
      fps: 24,
      width: 640,
      height: 360,
      motion: 'none',
    })
    const n0 = await boxOf(still, 0, 'n0.png')
    const n1 = await boxOf(still, 2 - 1 / 24, 'n1.png')
    expect(n1).toEqual(n0)
  })

  it('圖片的比例跟輸出不同：等比例放大、裁掉多的邊，不拉伸、不留黑邊', async () => {
    const image = await makeBoxImage('box-square.png', 800, 800) // 方塊 200，正方形的圖
    const out = path('square-to-wide.mp4')
    await stillToVideo(tools, image, out, {
      durationSec: 1,
      fps: 24,
      width: 640,
      height: 360,
      motion: 'none',
    })
    const box = await boxOf(out, 0, 'sq.png')
    // 800 寬的圖放到 640 寬：方塊 200 → 160，而且還是正方形
    expect(Math.abs(box.w - box.h)).toBeLessThan(4)
    expect(box.w).toBeGreaterThanOrEqual(156)
    expect(box.w).toBeLessThanOrEqual(164)
  })

  it('秒數不是正數就拒絕', async () => {
    const image = await makeBoxImage('box-bad.png', 640, 360)
    await expect(
      stillToVideo(tools, image, path('bad.mp4'), { durationSec: 0, width: 640, height: 360 }),
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('不給運鏡就是不動', async () => {
    const image = await makeBoxImage('box-default.png', 640, 360)
    const out = path('default.mp4')
    await stillToVideo(tools, image, out, { durationSec: 1, width: 640, height: 360 })
    const a = await boxOf(out, 0, 'd0.png')
    const b = await boxOf(out, 1 - 1 / 24, 'd1.png')
    expect(b).toEqual(a)
  })
})

describe('接片：每一段的淡入、淡出', () => {
  const info = (hasAudio: boolean, durationSec: number): MediaInfo => ({
    durationSec,
    width: 640,
    height: 360,
    fps: 24,
    hasAudio,
    hasVideo: true,
  })
  const size = { width: 1280, height: 720, fps: 24 }

  it('沒給淡入淡出：濾鏡字串跟加這個功能之前逐字相同（舊專案的行為不變）', () => {
    const filters = buildConcatFilters(
      [
        { path: 'a' },
        { path: 'b' },
        { path: 'c', inSec: 0.5, outSec: 2.5 },
        { path: 'd', inSec: 1 },
      ],
      [info(true, 3), info(false, 2.5), info(true, 4), info(false, 3)],
      size,
    )
    expect(filters).toEqual([
      '[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v0]',
      '[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0]',
      '[1:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v1]',
      'anullsrc=r=44100:cl=stereo,atrim=duration=2.500[a1]',
      '[2:v]trim=start=0.500000:end=2.500000,setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=0.5,trim=end_frame=48,setpts=PTS-STARTPTS,format=yuv420p[v2]',
      '[2:a]atrim=start=0.500000:end=2.500000,asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=2.000000[a2]',
      '[3:v]trim=start=1.000000:end=3.000000,setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=0.5,trim=end_frame=48,setpts=PTS-STARTPTS,format=yuv420p[v3]',
      'anullsrc=r=44100:cl=stereo,atrim=duration=2.000000[a3]',
      '[v0][a0][v1][a1][v2][a2][v3][a3]concat=n=4:v=1:a=1[v][a]',
    ])
    // 淡入淡出給 0 或不給一樣
    expect(
      buildConcatFilters([{ path: 'a', fadeInSec: 0, fadeOutSec: 0 }], [info(true, 3)], size).slice(
        0,
        2,
      ),
    ).toEqual(buildConcatFilters([{ path: 'a' }], [info(true, 3)], size).slice(0, 2))
  })

  it('有給：畫面加 fade、有聲音的片段聲音加 afade；淡出從「長度 − 淡出秒數」開始（裁切過的用裁切後的長度）', () => {
    const filters = buildConcatFilters(
      [
        { path: 'a', fadeInSec: 0.5, fadeOutSec: 1 },
        { path: 'b', inSec: 0, outSec: 2, fadeOutSec: 0.5 },
      ],
      [info(true, 4), info(true, 5)],
      size,
    )
    expect(filters[0]).toBe(
      '[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p,fade=t=in:st=0:d=0.500000,fade=t=out:st=3.000000:d=1.000000[v0]',
    )
    expect(filters[1]).toBe(
      '[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,afade=t=in:st=0:d=0.500000,afade=t=out:st=3.000000:d=1.000000[a0]',
    )
    expect(filters[2]).toContain('format=yuv420p,fade=t=out:st=1.500000:d=0.500000[v1]')
    expect(filters[3]).toContain(
      'apad,atrim=duration=2.000000,afade=t=out:st=1.500000:d=0.500000[a1]',
    )
  })

  it('淡入淡出的秒數太長（超過片段）：自動縮短，不會出現負的起點', () => {
    const filters = buildConcatFilters(
      [{ path: 'a', fadeInSec: 5, fadeOutSec: 5 }],
      [info(false, 2)],
      size,
    )
    expect(filters[0]).toContain('fade=t=in:st=0:d=1.000000')
    expect(filters[0]).toContain('fade=t=out:st=1.000000:d=1.000000')
  })

  it('真的接起來：淡入的第一格接近全黑、淡入結束後不是；淡出的最後一格接近全黑、之前不是；聲音也跟著', async () => {
    const a = await makeClip('fade-a.mp4', 3)
    const b = await makeClip('fade-b.mp4', 3)
    const plain = path('fade-plain.mp4')
    const faded = path('fade-faded.mp4')
    await concatVideos(tools, [a, b], plain, { width: 320, height: 180, fps: 24 })
    await concatVideos(
      tools,
      [
        { path: a, fadeInSec: 1 },
        { path: b, fadeOutSec: 1 },
      ],
      faded,
      { width: 320, height: 180, fps: 24 },
    )
    const normal = await lumaAt(plain, 0)
    expect(normal).toBeGreaterThan(40)
    expect(await lumaAt(faded, 0)).toBeLessThan(30)
    expect(await lumaAt(faded, 1.5)).toBeGreaterThan(40)
    expect(await lumaAt(faded, 6 - 1 / 24)).toBeLessThan(30)
    expect(await lumaAt(faded, 4.5)).toBeGreaterThan(40)
    // 聲音：淡入前 0.1 秒比沒淡入的小很多；淡出最後 0.1 秒也是
    expect(await rmsDb(faded, 0, 0.1)).toBeLessThan((await rmsDb(plain, 0, 0.1)) - 10)
    expect(await rmsDb(faded, 5.9, 0.1)).toBeLessThan((await rmsDb(plain, 5.9, 0.1)) - 10)
    // 總長不變
    expect(await frameCount(faded)).toBe(await frameCount(plain))
  })
})
