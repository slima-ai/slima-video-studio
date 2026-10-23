import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildConcatFilters, concatVideos, type ConcatInput } from './ops'
import { probe, type MediaInfo } from './probe'
import { resolveTools, runTool } from './run'

const tools = resolveTools()
const FPS = 24
let dir = ''
const path = (name: string): string => join(dir, name)

/**
 * 會「依時間變亮」的測試片：畫面亮度＝秒數×50（第 1 秒的第一格亮度約 50），
 * 聲音在 burstAt 秒起有 0.2 秒的 1kHz 短音，其他時間是靜音。這樣能量出「剪完第一格是原片第幾秒」「旁白落在第幾秒」。
 */
async function makeClip(
  name: string,
  opts: { seconds: number; burstAt?: number; audio?: boolean; fps?: number },
): Promise<string> {
  const out = path(name)
  const fps = opts.fps ?? FPS
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:size=160x90:rate=${String(fps)}:duration=${String(opts.seconds)},geq=lum='min(255,floor(T*50))':cb=128:cr=128`,
  ]
  if (opts.audio !== false) {
    const burst = opts.burstAt ?? 2
    args.push(
      '-f',
      'lavfi',
      '-i',
      `aevalsrc='if(between(t,${String(burst)},${String(burst + 0.2)}),sin(2*PI*1000*t),0)':s=44100:d=${String(opts.seconds)}`,
    )
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '12')
  if (opts.audio !== false) args.push('-c:a', 'aac')
  args.push(out)
  await runTool(tools.ffmpegPath, args)
  return out
}

/** 輸出影片的總格數。 */
async function frameCount(file: string): Promise<number> {
  const out = await runTool(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    file,
    '-map',
    '0:v',
    '-f',
    'framecrc',
    '-',
  ])
  return out.split('\n').filter((line) => line !== '' && !line.startsWith('#')).length
}

/** 第 n 格（從 0 起）的平均亮度。 */
async function lumaAt(file: string, frame: number): Promise<number> {
  const raw = path(`luma-${String(Math.random()).slice(2)}.gray`)
  await runTool(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    file,
    '-vf',
    `select=eq(n\\,${String(frame)}),scale=16:16`,
    '-frames:v',
    '1',
    '-pix_fmt',
    'gray',
    '-f',
    'rawvideo',
    raw,
  ])
  const bytes = readFileSync(raw)
  return bytes.reduce((sum, b) => sum + b, 0) / bytes.length
}

/** 輸出裡「第一個明顯有聲音的時間點」（秒），沒有就是 undefined。 */
async function firstSoundAt(file: string): Promise<number | undefined> {
  const raw = path(`audio-${String(Math.random()).slice(2)}.raw`)
  await runTool(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    file,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '8000',
    '-f',
    's16le',
    raw,
  ])
  const bytes = readFileSync(raw)
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2))
  const index = samples.findIndex((s) => Math.abs(s) > 3000)
  return index < 0 ? undefined : index / 8000
}

/** 輸出裡每一段短音的起點（秒）：前面 0.3 秒是靜音、這一刻開始有聲音。 */
async function soundOnsets(file: string): Promise<number[]> {
  const raw = path(`onsets-${String(Math.random()).slice(2)}.raw`)
  await runTool(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    file,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '8000',
    '-f',
    's16le',
    raw,
  ])
  const bytes = readFileSync(raw)
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2))
  const onsets: number[] = []
  let quietSince = 0
  for (const [index, sample] of samples.entries()) {
    if (Math.abs(sample) <= 3000) continue
    if (
      index - quietSince > 2400 &&
      (onsets.length === 0 || index - (onsets.at(-1) ?? 0) * 8000 > 8000)
    ) {
      onsets.push(index / 8000)
    }
    quietSince = index
  }
  return onsets
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'svs-trim-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const info = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  durationSec: 5,
  hasVideo: true,
  hasAudio: true,
  width: 160,
  height: 90,
  fps: 24,
  ...over,
})

describe('接片的濾鏡圖：沒裁切就和以前逐字相同', () => {
  it('沒有任何裁切：跟加入裁切功能之前的濾鏡圖完全一樣（有聲音、沒聲音各一段）', () => {
    const graph = buildConcatFilters(
      [{ path: 'a.mp4' }, { path: 'b.mp4' }],
      [info(), info({ hasAudio: false, durationSec: 2.5 })],
      { width: 320, height: 180, fps: 24 },
    )
    expect(graph).toEqual([
      '[0:v]scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v0]',
      '[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0]',
      '[1:v]scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v1]',
      'anullsrc=r=44100:cl=stereo,atrim=duration=2.500[a1]',
      '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]',
    ])
  })

  it('字串寫成 string 或 { path } 都一樣（舊的呼叫端不用改）', async () => {
    const a = await makeClip('same-a.mp4', { seconds: 1 })
    const b = await makeClip('same-b.mp4', { seconds: 1 })
    const viaStrings = path('via-strings.mp4')
    const viaObjects = path('via-objects.mp4')
    await concatVideos(tools, [a, b], viaStrings)
    await concatVideos(tools, [{ path: a }, { path: b }], viaObjects)
    expect(await frameCount(viaStrings)).toBe(await frameCount(viaObjects))
  })

  it('有裁切的片段用 trim／atrim（畫面與聲音同一組時間），沒裁的照舊', () => {
    const graph = buildConcatFilters(
      [{ path: 'a.mp4' }, { path: 'b.mp4', inSec: 1, outSec: 4.5 }],
      [info(), info()],
      { width: 160, height: 90, fps: 24 },
    )
    expect(graph[0]).not.toContain('trim')
    const joined = graph.join('\n')
    expect(joined).toContain('[1:v]trim=start=1.000000:end=4.500000,setpts=PTS-STARTPTS,scale=')
    expect(joined).toContain('trim=end_frame=84')
    expect(joined).toContain('[1:a]atrim=start=1.000000:end=4.500000,asetpts=PTS-STARTPTS')
    expect(joined).toContain('atrim=duration=3.500000[a1]')
  })
})

describe('接片照裁切剪（真的跑 FFmpeg）', () => {
  it('剪結尾：出點 3.5，這一段剛好 84 格（3.5 秒）', async () => {
    const clip = await makeClip('tail.mp4', { seconds: 5 })
    const out = path('tail-out.mp4')
    await concatVideos(tools, [{ path: clip, outSec: 3.5 }], out, { fps: FPS })
    expect(await frameCount(out)).toBe(84)
    expect((await probe(tools, out)).durationSec).toBeCloseTo(3.5, 1)
  })

  it('剪開頭：入點 1.0，第一格是原片第 1 秒的畫面（轉灰階後約 40），不是第 0 秒（約 0）', async () => {
    const clip = await makeClip('head.mp4', { seconds: 5 })
    const out = path('head-out.mp4')
    await concatVideos(tools, [{ path: clip, inSec: 1 }], out, { fps: FPS })
    expect(await frameCount(out)).toBe(96)
    // 亮度 50 的 yuv 畫面轉成灰階（全範圍）是 40 上下；第 0 秒的畫面會是 0
    expect(await lumaAt(out, 0)).toBeGreaterThan(30)
    expect(await lumaAt(out, 0)).toBeLessThan(52)
    // 最後一格接近原片第 5 秒（亮度約 245）
    expect(await lumaAt(out, 95)).toBeGreaterThan(220)
  })

  it('原聲跟著畫面一起剪：原片 2.0 秒的短音，入點 1.0 之後出現在 1.0 秒（±1 格）', async () => {
    const clip = await makeClip('sound.mp4', { seconds: 5, burstAt: 2 })
    const out = path('sound-out.mp4')
    await concatVideos(tools, [{ path: clip, inSec: 1, outSec: 4 }], out, { fps: FPS })
    const at = await firstSoundAt(out)
    expect(at).toBeDefined()
    expect(Math.abs((at ?? 0) - 1)).toBeLessThanOrEqual(1 / FPS + 0.01)
  })

  it('沒有聲音的片段也能剪（補的靜音長度是剪完的長度）', async () => {
    const clip = await makeClip('mute.mp4', { seconds: 5, audio: false })
    const out = path('mute-out.mp4')
    await concatVideos(tools, [{ path: clip, inSec: 0.5, outSec: 3 }], out, { fps: FPS })
    expect(await frameCount(out)).toBe(60)
    expect((await probe(tools, out)).hasAudio).toBe(true)
  })

  it('展示片的情境：十段混著剪，總格數＝各段格數的總和、旁白落點每一段都 ≤ 1 格', async () => {
    // 5 秒的片子；偶數段剪成 3.5 秒（84 格）、奇數段整支（120 格），共 5 段剪過 + 5 段整支
    const clips: string[] = []
    for (let i = 0; i < 10; i++) {
      clips.push(await makeClip(`show-${String(i)}.mp4`, { seconds: 5, burstAt: 2 }))
    }
    const inputs: ConcatInput[] = clips.map((file, i) =>
      i % 2 === 0 ? { path: file, outSec: 3.5 } : { path: file },
    )
    const out = path('show-out.mp4')
    await concatVideos(tools, inputs, out, { fps: FPS })
    const expectedFrames = 5 * 84 + 5 * 120
    // 整支的段落自己的格數可能差一格（編碼器），剪過的段落一定是整數格：總數誤差不超過整支段落的數量
    expect(Math.abs((await frameCount(out)) - expectedFrames)).toBeLessThanOrEqual(5)
    expect((await probe(tools, out)).durationSec).toBeCloseTo(expectedFrames / FPS, 0)
  })

  it('十段全部剪成 3.5 秒：總格數剛好 840，不累積誤差', async () => {
    const clips: ConcatInput[] = []
    for (let i = 0; i < 10; i++) {
      clips.push({ path: await makeClip(`all-${String(i)}.mp4`, { seconds: 5 }), outSec: 3.5 })
    }
    const out = path('all-out.mp4')
    await concatVideos(tools, clips, out, { fps: FPS })
    expect(await frameCount(out)).toBe(840)
  })

  it('出點超過影片長度也不會壞（剪到影片結束為止，補滿到格數）', async () => {
    const clip = await makeClip('over.mp4', { seconds: 2 })
    const out = path('over-out.mp4')
    await concatVideos(tools, [{ path: clip, inSec: 0.5, outSec: 2 }], out, { fps: FPS })
    expect(await frameCount(out)).toBe(36)
  })

  it('《黑藤裂谷》粗剪：8 鏡每鏡 121 格、鏡 5、6 剪到 3.5 秒（84 格）＝894 格；每鏡起點（格）0、121、242、363、484、568、652、773，每鏡開頭的短音落在這些起點上（≤ 1 格）', async () => {
    // 每鏡 121 格（5.0417 秒，Kling 實際輸出），聲音在每鏡第 0.35 秒有短音（對應旁白的 +0.35）
    const seconds = 121 / FPS
    const inputs: ConcatInput[] = []
    for (let n = 1; n <= 8; n++) {
      const file = await makeClip(`film-${String(n)}.mp4`, { seconds, burstAt: 0.35 })
      expect(await frameCount(file)).toBe(121)
      inputs.push(n === 5 || n === 6 ? { path: file, outSec: 3.5 } : { path: file })
    }
    const out = path('film-out.mp4')
    await concatVideos(tools, inputs, out, { fps: FPS })
    expect(await frameCount(out)).toBe(894)
    const startFrames = [0, 121, 242, 363, 484, 568, 652, 773]
    const onsets = await soundOnsets(out)
    expect(onsets).toHaveLength(8)
    for (const [i, frame] of startFrames.entries()) {
      const expected = frame / FPS + 0.35
      expect(Math.abs((onsets[i] ?? -1) - expected), `鏡 ${String(i + 1)}`).toBeLessThanOrEqual(
        1 / FPS + 0.005,
      )
    }
  })
})
