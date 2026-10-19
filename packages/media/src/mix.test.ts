import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildMixGraph, detectSilences, measureLoudness, measureRmsDb, mixAudio } from './mix'
import { imageToVideo } from './ops'
import { probe } from './probe'
import { resolveTools, runTool } from './run'

const tools = resolveTools()
let dir = ''
const path = (name: string): string => join(dir, name)

const BASE = ['-hide_banner', '-loglevel', 'error', '-y']

/** 十秒的測試影片；原聲是 220 Hz 的純音（有 audio 才加）。 */
async function makeVideo(
  name: string,
  opts: { audio: boolean; seconds?: number },
): Promise<string> {
  const seconds = opts.seconds ?? 10
  const out = path(name)
  const args = [
    ...BASE,
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=320x180:rate=24:duration=${String(seconds)}`,
  ]
  if (opts.audio) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=220:duration=${String(seconds)}`)
    args.push('-af', 'volume=0.3')
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p')
  if (opts.audio) args.push('-c:a', 'aac', '-shortest')
  args.push(out)
  await runTool(tools.ffmpegPath, args)
  return out
}

/** 一段純音的音檔（WAV）。 */
async function makeTone(name: string, hz: number, seconds: number, volume = 0.5): Promise<string> {
  const out = path(name)
  await runTool(tools.ffmpegPath, [
    ...BASE,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${String(hz)}:duration=${String(seconds)}`,
    '-af',
    `volume=${String(volume)}`,
    out,
  ])
  return out
}

const band = (hz: number): string => `bandpass=f=${String(hz)}:width_type=h:w=30`

let silentVideo = ''
let soundVideo = ''
let narration = ''
let music = ''
let shortMusic = ''
let sfx = ''

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'svs-mix-'))
  silentVideo = await makeVideo('silent.mp4', { audio: false })
  soundVideo = await makeVideo('sound.mp4', { audio: true })
  narration = await makeTone('narration.wav', 1000, 2) // 1000 Hz、2 秒
  music = await makeTone('music.wav', 330, 12, 0.4) // 330 Hz、比影片長
  shortMusic = await makeTone('music-short.wav', 330, 4, 0.4) // 比影片短，要循環
  sfx = await makeTone('sfx.wav', 2000, 0.5)
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('mixAudio：對齊與長度', () => {
  it('旁白從指定的秒數開始（前後都是靜音），輸出長度等於影片、有影像也有聲音', async () => {
    const out = path('align.mp4')
    await mixAudio(tools, silentVideo, out, {
      narration: [{ file: narration, startSec: 3 }],
      normalize: false,
    })
    const info = await probe(tools, out)
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.durationSec).toBeCloseTo(10, 0)

    const before = await measureRmsDb(tools, out, {
      startSec: 0.5,
      durationSec: 2,
      filter: band(1000),
    })
    const onset = await measureRmsDb(tools, out, {
      startSec: 2.7,
      durationSec: 0.25,
      filter: band(1000),
    })
    const during = await measureRmsDb(tools, out, {
      startSec: 3.2,
      durationSec: 1.5,
      filter: band(1000),
    })
    const after = await measureRmsDb(tools, out, {
      startSec: 5.3,
      durationSec: 3,
      filter: band(1000),
    })
    expect(before).toBeLessThan(-60)
    expect(onset).toBeLessThan(-60) // 起點誤差小於 0.3 秒
    expect(during).toBeGreaterThan(-40)
    expect(after).toBeLessThan(-60)
  })

  it('音效也對得上位置；影片沒有聲音時用靜音墊著', async () => {
    const out = path('sfx.mp4')
    await mixAudio(tools, silentVideo, out, {
      sfx: [{ file: sfx, startSec: 6 }],
      normalize: false,
    })
    const hit = await measureRmsDb(tools, out, {
      startSec: 6.05,
      durationSec: 0.3,
      filter: band(2000),
    })
    const quiet = await measureRmsDb(tools, out, {
      startSec: 1,
      durationSec: 4,
      filter: band(2000),
    })
    expect(hit).toBeGreaterThan(-45)
    expect(quiet).toBeLessThan(-60)
  })

  it('配樂比影片短就循環到最後，比影片長就截掉；開頭淡入、結尾淡出', async () => {
    for (const [name, file] of [
      ['loop.mp4', shortMusic],
      ['trim.mp4', music],
    ] as const) {
      const out = path(name)
      await mixAudio(tools, silentVideo, out, { music: { file, gainDb: -6 }, normalize: false })
      expect((await probe(tools, out)).durationSec).toBeCloseTo(10, 0)
      const first = await measureRmsDb(tools, out, {
        startSec: 0,
        durationSec: 0.4,
        filter: band(330),
      })
      const middle = await measureRmsDb(tools, out, {
        startSec: 4.5,
        durationSec: 1,
        filter: band(330),
      })
      const late = await measureRmsDb(tools, out, {
        startSec: 7.5,
        durationSec: 1,
        filter: band(330),
      })
      const last = await measureRmsDb(tools, out, {
        startSec: 9.7,
        durationSec: 0.3,
        filter: band(330),
      })
      expect(middle).toBeGreaterThan(-45)
      expect(late).toBeGreaterThan(-45) // 循環的版本在第 8 秒前後也還有聲音
      expect(first).toBeLessThan(middle - 6)
      expect(last).toBeLessThan(middle - 6)
    }
  })

  it('只靜音原聲的某一段（例如某一鏡）：那段的 220 Hz 消失，前後都還在', async () => {
    const out = path('native-range-muted.mp4')
    await mixAudio(tools, soundVideo, out, {
      nativeMutes: [{ startSec: 4, endSec: 7 }],
      normalize: false,
    })
    const band220 = { filter: band(220) }
    expect(
      await measureRmsDb(tools, out, { startSec: 1, durationSec: 2, ...band220 }),
    ).toBeGreaterThan(-45)
    expect(
      await measureRmsDb(tools, out, { startSec: 4.3, durationSec: 2.4, ...band220 }),
    ).toBeLessThan(-60)
    expect(
      await measureRmsDb(tools, out, { startSec: 7.5, durationSec: 2, ...band220 }),
    ).toBeGreaterThan(-45)
  })

  it('靜音影片原聲：220 Hz 消失，但長度不變', async () => {
    const kept = path('native-kept.mp4')
    const muted = path('native-muted.mp4')
    await mixAudio(tools, soundVideo, kept, { normalize: false })
    await mixAudio(tools, soundVideo, muted, { muteNative: true, normalize: false })
    expect(
      await measureRmsDb(tools, kept, { startSec: 2, durationSec: 3, filter: band(220) }),
    ).toBeGreaterThan(-45)
    expect(
      await measureRmsDb(tools, muted, { startSec: 2, durationSec: 3, filter: band(220) }),
    ).toBeLessThan(-60)
    expect((await probe(tools, muted)).durationSec).toBeCloseTo(10, 0)
  })
})

describe('mixAudio：旁白出現時自動壓低', () => {
  const options = (duck: boolean) => ({
    narration: [{ file: narration, startSec: 3 }],
    music: { file: music, gainDb: -6, fadeInSec: 0.1, fadeOutSec: 0.1 },
    muteNative: true,
    duck,
    normalize: false,
  })

  it('開啟時，旁白期間的配樂比旁白之前低至少 6 dB，旁白一停就回來', async () => {
    const out = path('duck-on.mp4')
    await mixAudio(tools, silentVideo, out, options(true))
    const before = await measureRmsDb(tools, out, {
      startSec: 1.5,
      durationSec: 1,
      filter: band(330),
    })
    const during = await measureRmsDb(tools, out, {
      startSec: 3.6,
      durationSec: 1,
      filter: band(330),
    })
    const recovered = await measureRmsDb(tools, out, {
      startSec: 7,
      durationSec: 1.5,
      filter: band(330),
    })
    expect(before - during).toBeGreaterThanOrEqual(6)
    expect(recovered).toBeGreaterThan(before - 2)
  })

  it('關閉壓低時，配樂在旁白期間不變（相差小於 1.5 dB）', async () => {
    const out = path('duck-off.mp4')
    await mixAudio(tools, silentVideo, out, options(false))
    const before = await measureRmsDb(tools, out, {
      startSec: 1.5,
      durationSec: 1,
      filter: band(330),
    })
    const during = await measureRmsDb(tools, out, {
      startSec: 3.6,
      durationSec: 1,
      filter: band(330),
    })
    expect(Math.abs(before - during)).toBeLessThan(1.5)
  })

  it('影片原聲也會被壓低', async () => {
    const out = path('duck-native.mp4')
    await mixAudio(tools, soundVideo, out, {
      narration: [{ file: narration, startSec: 3 }],
      normalize: false,
    })
    const before = await measureRmsDb(tools, out, {
      startSec: 1,
      durationSec: 1.5,
      filter: band(220),
    })
    const during = await measureRmsDb(tools, out, {
      startSec: 3.6,
      durationSec: 1,
      filter: band(220),
    })
    expect(before - during).toBeGreaterThanOrEqual(6)
  })
})

describe('mixAudio：響度', () => {
  it('預設正規化到 −16 LUFS（±1），真峰值不超過 −1 dBTP', async () => {
    const out = path('loud.mp4')
    await mixAudio(tools, soundVideo, out, {
      narration: [{ file: narration, startSec: 3 }],
      music: { file: music },
    })
    const loudness = await measureLoudness(tools, out)
    expect(loudness.integratedLufs).toBeGreaterThan(-17)
    expect(loudness.integratedLufs).toBeLessThan(-15)
    expect(loudness.truePeakDb).toBeLessThanOrEqual(-1)
  })

  it('整支都是靜音時不會壞掉（略過正規化）', async () => {
    const out = path('all-silent.mp4')
    await mixAudio(tools, silentVideo, out)
    expect((await probe(tools, out)).hasAudio).toBe(true)
    expect(await measureRmsDb(tools, out)).toBe(Number.NEGATIVE_INFINITY)
  })
})

/** 8 kHz 單聲道 16 位元的 WAV（440 Hz 正弦波，振幅 8000／32768）：示範模式的假旁白就是這種規格。 */
function demoNarrationWav(seconds: number): Buffer {
  const rate = 8000
  const samples = rate * seconds
  const pcm = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // 單聲道
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

describe('mixAudio：App 自己做出來的影片（有靜音音軌）加示範模式規格的旁白', () => {
  it('imageToVideo 做的影片加 8 kHz 單聲道的旁白，預設響度正規化也能混（FFmpeg 6.x 的第二趟曾因聲道配置失敗）', async () => {
    await runTool(tools.ffmpegPath, [
      ...BASE,
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x180',
      '-frames:v',
      '1',
      path('still.png'),
    ])
    await imageToVideo(tools, path('still.png'), path('still.mp4'), {
      durationSec: 3,
      silentAudio: true,
    })
    writeFileSync(path('demo-narration.wav'), demoNarrationWav(2))
    const out = path('demo-mixed.mp4')
    await mixAudio(tools, path('still.mp4'), out, {
      narration: [{ file: path('demo-narration.wav'), startSec: 0.4 }],
    })
    const info = await probe(tools, out)
    expect(info.hasAudio).toBe(true)
    expect(info.durationSec).toBeCloseTo(3, 0)
    expect(
      await measureRmsDb(tools, out, { startSec: 0.8, durationSec: 1.2, filter: band(440) }),
    ).toBeGreaterThan(-45)
  })
})

describe('mixAudio：輸入不對', () => {
  it('旁白起點超出影片長度、音檔沒有聲音、檔案沒有影像：都給白話錯誤，不留半成品', async () => {
    const out = path('bad.mp4')
    await expect(
      mixAudio(tools, silentVideo, out, { narration: [{ file: narration, startSec: 10.5 }] }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
      userMessage: '旁白的位置超出影片長度，請調整它的起點。',
    })
    await expect(
      mixAudio(tools, silentVideo, out, { sfx: [{ file: silentVideo, startSec: 1 }] }),
    ).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(mixAudio(tools, narration, out)).rejects.toMatchObject({ code: 'invalid_request' })
    expect(existsSync(out)).toBe(false)
  })
})

describe('buildMixGraph', () => {
  const base = {
    video: 'v.mp4',
    videoSec: 10,
    videoHasAudio: true,
    narration: [],
    sfx: [],
    nativeGainDb: 0,
    muteNative: false,
    duck: true,
  }

  it('只有影片：原聲直通；輸入順序是影片、旁白、音效、配樂', () => {
    expect(buildMixGraph(base).graph).toContain('[nat]anull[mix]')
    const plan = buildMixGraph({
      ...base,
      narration: [{ file: 'n.wav', startSec: 1, durationSec: 2 }],
      sfx: [{ file: 's.wav', startSec: 2, durationSec: 1 }],
      music: { file: 'm.wav', durationSec: 20 },
    })
    expect(plan.inputs).toEqual(['v.mp4', 'n.wav', 's.wav', 'm.wav'])
    expect(plan.graph).toContain('adelay=1000:all=1')
    expect(plan.graph).toContain('sidechaincompress')
    expect(plan.graph).toContain('[mix]')
  })

  it('配樂比影片短：同一個檔案重複成多個輸入再用 acrossfade 接（FFmpeg 6.0 的 asplit 接 acrossfade 會只剩兩秒）', () => {
    const plan = buildMixGraph({ ...base, music: { file: 'm.wav', durationSec: 4 } })
    expect(plan.inputs).toEqual(['v.mp4', 'm.wav', 'm.wav', 'm.wav'])
    expect(plan.graph).toContain('acrossfade')
    expect(plan.graph).not.toContain('asplit')
    expect(buildMixGraph({ ...base, music: { file: 'm.wav', durationSec: 20 } }).inputs).toEqual([
      'v.mp4',
      'm.wav',
    ])
  })

  it('沒有旁白就不放壓縮器；關掉 duck 也不放', () => {
    const music = { file: 'm.wav', durationSec: 20 }
    expect(buildMixGraph({ ...base, music }).graph).not.toContain('sidechaincompress')
    expect(
      buildMixGraph({
        ...base,
        music,
        duck: false,
        narration: [{ file: 'n.wav', startSec: 1, durationSec: 2 }],
      }).graph,
    ).not.toContain('sidechaincompress')
  })
})

describe('detectSilences', () => {
  it('找出旁白前後的安靜段；整支都安靜就是一段到結尾', async () => {
    const out = path('silences.mp4')
    await mixAudio(tools, silentVideo, out, {
      narration: [{ file: narration, startSec: 3 }],
      normalize: false,
    })
    const spans = await detectSilences(tools, out)
    expect(spans).toHaveLength(2)
    expect(spans[0]?.startSec).toBeCloseTo(0, 0)
    expect(spans[0]?.endSec).toBeGreaterThan(2.5)
    expect(spans[0]?.endSec).toBeLessThan(3.2)
    expect(spans[1]?.startSec).toBeGreaterThan(4.8)
    expect(spans[1]?.endSec).toBeCloseTo(10, 0)

    const quiet = path('all-quiet.mp4')
    await mixAudio(tools, silentVideo, quiet)
    const all = await detectSilences(tools, quiet)
    expect(all).toHaveLength(1)
    expect(all[0]?.startSec).toBeCloseTo(0, 1)
    expect(all[0]?.endSec).toBeCloseTo(10, 0)
  })
})
