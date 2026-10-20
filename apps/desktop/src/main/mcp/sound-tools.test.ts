import type { LlmRequest } from '@svs/schema'
import { FAKE_OPENROUTER_KEY, startFakeOpenRouter } from '@svs/test-utils'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { locateTools } from '../bundled-tools'
import { dataOf, startRealMcp, textOf } from './test-support'

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
  for (const c of closers.splice(0)) await c()
})

const shot = (description: string) => ({
  description,
  size: 'wide',
  angle: 'eye_level',
  cameraMove: null,
  durationSec: 5,
  characters: [],
  dialogue: '',
  lighting: null,
  mood: null,
})
const SPLIT = {
  acts: [
    { title: '一', summary: '', scenes: [{ title: '追逐', summary: '追種子', location: '' }] },
  ],
  characters: [],
  locations: [],
}
const SHOTS = { shots: [shot('裂谷全景'), shot('小饅頭彈起')] }
const mockLlm = (r: LlmRequest): object | undefined => {
  if (r.system?.includes('編劇助手')) return SPLIT
  if (r.system?.includes('分鏡助手')) return SHOTS
  return undefined
}

const Clip = z.looseObject({
  id: z.string(),
  kind: z.string(),
  version: z.number(),
  adopted: z.boolean(),
  gainDb: z.number().nullable(),
})
const Sound = z.looseObject({
  settings: z.looseObject({ duck: z.boolean(), musicGainDb: z.number() }),
  shots: z.array(
    z.looseObject({ shotId: z.string(), dialogue: z.string(), narration: Clip.nullable() }),
  ),
  music: Clip.nullable(),
  totalSec: z.number(),
})
const Plan = z.looseObject({
  ok: z.boolean(),
  items: z.array(
    z.looseObject({ kind: z.string(), shotId: z.string().optional(), estimatedUsd: z.number() }),
  ),
  totalUsd: z.number(),
  demoMode: z.boolean(),
})
const Made = z.looseObject({
  clip: Clip,
  spending: z.looseObject({ estimatedUsd: z.number() }),
})

async function start(options: Parameters<typeof startRealMcp>[0] = {}): Promise<Running> {
  const r = await startRealMcp({ mockLlm, ...options })
  running.push(r)
  return r
}

/** 建專案、拆出 2 鏡，第 1 鏡寫台詞；回傳兩鏡的 id。 */
async function waitDone(r: Running): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const waited = dataOf(
      z.looseObject({ finished: z.boolean() }),
      await r.call('wait_for_generation', { maxSeconds: 30 }),
    )
    if (waited.finished) return
  }
  throw new Error('生成一直沒結束')
}

async function withShots(r: Running): Promise<string[]> {
  await r.call('create_project', { name: 'x' })
  await r.call('split_story_into_scenes', { story: '故事' })
  const outline = JSON.parse(textOf(await r.call('get_outline'))) as {
    acts: { scenes: { id: string }[] }[]
  }
  await r.call('split_scene_into_shots', { sceneId: outline.acts[0]?.scenes[0]?.id ?? '' })
  const ids = dataOf(
    z.object({ shots: z.array(z.looseObject({ id: z.string() })) }),
    await r.call('list_shots'),
  ).shots.map((s) => s.id)
  await r.call('update_shot', { shotId: ids[0], dialogue: '小饅頭，你要去哪裡？' })
  return ids
}

describe('聲音工具（示範模式）', () => {
  it('看聲音 → 預估 → 念旁白（多版本、換回舊版）→ 配樂 → 調整 → 設定 → 刪除', async () => {
    const r = await start()
    const [first, second] = await withShots(r)

    const sound = dataOf(Sound, await r.call('get_sound'))
    expect(sound.shots.map((s) => s.shotId)).toEqual([first, second])
    expect(sound.shots[0]?.dialogue).toBe('小饅頭，你要去哪裡？')
    expect(sound.shots[0]?.narration).toBeNull()
    expect(sound.music).toBeNull()

    // 預估：只有有台詞的那一鏡
    const plan = dataOf(Plan, await r.call('plan_sound', { music: true }))
    expect(plan.ok).toBe(true)
    expect(plan.demoMode).toBe(true)
    expect(plan.items.filter((i) => i.kind === 'narration').map((i) => i.shotId)).toEqual([first])
    expect(plan.items.some((i) => i.kind === 'music')).toBe(true)
    // 回的是金額：每一項有估價，總額大於 0（getting-started 說聲音用 plan_sound 看估價）
    expect(plan.items.every((i) => i.estimatedUsd >= 0)).toBe(true)
    expect(plan.totalUsd).toBeGreaterThan(0)

    const v1 = dataOf(Made, await r.call('generate_narration', { shotId: first }))
    expect(v1.clip).toMatchObject({ kind: 'narration', version: 1, adopted: true })
    const v2 = dataOf(Made, await r.call('generate_narration', { shotId: first }))
    expect(v2.clip).toMatchObject({ version: 2, adopted: true })
    const now = dataOf(Sound, await r.call('get_sound'))
    expect(now.shots[0]?.narration?.version).toBe(2)
    // 換回第 1 版
    const back = dataOf(Clip, await r.call('adopt_sound_clip', { clipId: v1.clip.id }))
    expect(back).toMatchObject({ version: 1, adopted: true })
    expect(dataOf(Sound, await r.call('get_sound')).shots[0]?.narration?.version).toBe(1)

    // 配樂
    const music = dataOf(Made, await r.call('generate_music', { prompt: '輕快的冒險' }))
    expect(music.clip).toMatchObject({ kind: 'music', adopted: true })

    // 調整：只改給的欄位；null 回預設
    const loud = dataOf(
      Clip,
      await r.call('adjust_sound_clip', { clipId: music.clip.id, gainDb: -12, offsetSec: 0 }),
    )
    expect(loud.gainDb).toBe(-12)
    const reset = dataOf(
      Clip,
      await r.call('adjust_sound_clip', { clipId: music.clip.id, gainDb: null }),
    )
    expect(reset.gainDb).toBeNull()

    // 設定：逐項合併
    const settings = dataOf(
      z.looseObject({ duck: z.boolean(), musicGainDb: z.number(), nativeAudio: z.boolean() }),
      await r.call('set_sound_settings', { duck: false }),
    )
    expect(settings.duck).toBe(false)
    expect(settings.musicGainDb).toBe(-18)
    expect(dataOf(Sound, await r.call('get_sound')).settings.duck).toBe(false)

    // 刪除
    await r.call('remove_sound_clip', { clipId: music.clip.id })
    expect(dataOf(Sound, await r.call('get_sound')).music).toBeNull()
  })

  it('混音：還沒接片就混 → 白話錯誤；接片（自動混入現有聲音）→ 改了聲音 → mix_sound 多一個成品版本 → 匯出', async () => {
    const r = await start()
    const [first] = await withShots(r)
    const early = await r.call('mix_sound')
    expect(early.isError).toBe(true)
    expect(textOf(early)).not.toMatch(/undefined|\.ts:|at .*\(/)

    await r.call('generate_first_frames')
    await waitDone(r)
    await r.call('generate_videos')
    await waitDone(r)
    await r.call('generate_narration', { shotId: first })
    await r.call('assemble_film')
    const music = dataOf(Made, await r.call('generate_music', { durationSec: 6 }))
    await r.call('adjust_sound_clip', { clipId: music.clip.id, gainDb: -24 })
    const mixed = dataOf(
      z.looseObject({ mixed: z.boolean(), filmVersion: z.number() }),
      await r.call('mix_sound'),
    )
    expect(mixed.mixed).toBe(true)
    expect(mixed.filmVersion).toBeGreaterThanOrEqual(2)
    const again = dataOf(z.looseObject({ filmVersion: z.number() }), await r.call('mix_sound'))
    expect(again.filmVersion).toBeGreaterThan(mixed.filmVersion)
    // 量測：整體響度、每鏡音量、警示（示範影片的聲音是真的 FFmpeg 量出來的數字）
    const analysis = dataOf(
      z.looseObject({
        filmVersion: z.number(),
        durationSec: z.number(),
        loudness: z.looseObject({ integratedLufs: z.number().nullable() }),
        shots: z.array(z.looseObject({ number: z.number(), rmsDb: z.number().nullable() })),
        warnings: z.array(z.string()),
      }),
      await r.call('analyze_sound'),
    )
    expect(analysis.filmVersion).toBeGreaterThanOrEqual(mixed.filmVersion)
    expect(analysis.durationSec).toBeGreaterThan(0)
    expect(analysis.shots.length).toBeGreaterThan(0)
    expect(Array.isArray(analysis.warnings)).toBe(true)
    const exported = JSON.parse(textOf(await r.call('export_film'))) as { fileName: string }
    expect(exported.fileName).toMatch(/\.mp4$/)
  }, 60_000) // 真的用 FFmpeg 接片、混音兩次、量測：機器忙的時候要將近 20 秒，預設逾時會誤判

  it('量測：還沒接片 → 白話錯誤，不是例外', async () => {
    const r = await start()
    await withShots(r)
    const out = await r.call('analyze_sound')
    expect(out.isError).toBe(true)
    expect(textOf(out)).not.toMatch(/undefined|\.ts:|at .*\(/)
  })

  it('示範的旁白與配樂是跟真的一樣的 mp3（旁白單聲道、配樂立體聲）、長度不是剛好整數秒——這樣示範流程才抓得到真格式才會出的混音問題', async () => {
    const r = await start()
    const [first] = await withShots(r)
    const narration = dataOf(Made, await r.call('generate_narration', { shotId: first }))
    const music = dataOf(Made, await r.call('generate_music', { durationSec: 6 }))
    const state = r.h.sound.state()
    const files = [
      { clip: state.shots[0]?.narration, channels: 1 },
      { clip: state.music, channels: 2 },
    ]
    expect(files.map((f) => f.clip?.id)).toEqual([narration.clip.id, music.clip.id])
    for (const { clip, channels } of files) {
      const found = r.h.projects.current()?.assets.find(clip?.assetHash ?? '')
      if (!found) throw new Error('找不到素材')
      const bytes = readFileSync(found.path)
      // mp3：ID3 標頭或直接是影格同步字（0xFFEx）
      const isMp3 =
        bytes.subarray(0, 3).toString('latin1') === 'ID3' ||
        (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
      expect(isMp3, clip?.kind).toBe(true)
      // 用內建的 FFmpeg 看聲道數
      const probe = spawnSync(locateTools().ffmpegPath, ['-hide_banner', '-i', found.path], {
        encoding: 'utf8',
      })
      expect(`${probe.stderr}${probe.stdout}`, clip?.kind).toMatch(
        channels === 1 ? /mono/i : /stereo/i,
      )
      expect(Number.isInteger(clip?.durationSec), `${clip?.kind} 長度不該剛好是整數秒`).toBe(false)
    }
  })

  it('白話錯誤：找不到的鏡頭、沒有台詞的鏡頭、不存在的片段；不是例外', async () => {
    const r = await start()
    const [, second] = await withShots(r)
    for (const [tool, args] of [
      ['generate_narration', { shotId: 'nope' }],
      ['generate_narration', { shotId: second }], // 沒有台詞 → 預估裡沒有這一項
      ['adopt_sound_clip', { clipId: 'nope' }],
      ['adjust_sound_clip', { clipId: 'nope', gainDb: 1 }],
    ] as const) {
      const out = await r.call(tool, args)
      expect(out.isError, tool).toBe(true)
      expect(textOf(out), tool).not.toMatch(/undefined|\.ts:|at .*\(/)
    }
    expect(textOf(await r.call('generate_narration', { shotId: second }))).toContain('dialogue')
  })

  it('刪除不存在的片段不會出錯（重複呼叫同樣結果）；聲音指南可以讀', async () => {
    const r = await start()
    await withShots(r)
    expect((await r.call('remove_sound_clip', { clipId: 'nope' })).isError).not.toBe(true)
    const guide = textOf(await r.call('load_guide', { topic: 'sound' }))
    expect(guide).toContain('You cannot hear audio')
  })
})

describe('聲音的花錢步驟（真實模式、假的 OpenRouter）', () => {
  const startReal = async () => {
    const fake = await startFakeOpenRouter()
    closers.push(() => fake.close())
    const r = await start({ demoMode: false, openrouterBaseUrl: fake.url })
    r.h.keys.set('openrouter', FAKE_OPENROUTER_KEY)
    return { r, fake }
  }
  const noJobs = (fake: Awaited<ReturnType<typeof startFakeOpenRouter>>) =>
    fake.requests.filter((q) => q.path !== '/models')

  it('list_models 帶出旁白模型可選的聲音（id、名稱、語言），不含金鑰', async () => {
    const { r } = await startReal()
    const models = JSON.parse(textOf(await r.call('list_models'))) as {
      available: { id: string; capabilities: string[]; voices?: { id: string; label: string }[] }[]
    }
    const withVoices = models.available.filter((m) => (m.voices?.length ?? 0) > 0)
    expect(withVoices.length).toBeGreaterThan(0)
    expect(withVoices.every((m) => m.capabilities.includes('tts'))).toBe(true)
    expect(JSON.stringify(models)).not.toContain(FAKE_OPENROUTER_KEY)
  })

  it('額度 0：旁白與配樂都被擋下（白話訊息）；沒有請求送出、沒有預留', async () => {
    const { r, fake } = await startReal()
    r.h.settings.update({ mcp: { allowanceUsd: 5 } })
    const ids = await withShots(r)
    r.h.settings.update({ mcp: { allowanceUsd: 0 } })
    const before = noJobs(fake).length
    const committed = r.controller.allowance.status().committedUsd
    for (const [tool, args] of [
      ['generate_narration', { shotId: ids[0] }],
      ['generate_music', {}],
    ] as const) {
      const out = await r.call(tool, args)
      expect(out.isError, tool).toBe(true)
      expect(textOf(out), tool).toContain('額度只剩 US$0.00')
      expect(textOf(out), tool).toContain('額度只剩 US$0.00')
    }
    expect(noJobs(fake)).toHaveLength(before)
    expect(r.controller.allowance.status().committedUsd).toBe(committed)
  })

  it('人調高額度後：預留的是預估 × 1.25（旁白與配樂各一次）；maxCostUsd 低於預估就不做、不預留；回傳不含金鑰與 token', async () => {
    const { r, fake } = await startReal()
    r.h.settings.update({ mcp: { allowanceUsd: 5 } })
    const ids = await withShots(r)
    const committed = () => r.controller.allowance.status().committedUsd
    const start0 = committed()
    const requestsBefore = noJobs(fake).length
    // 上限比預估低：直接拒絕，沒有預留、沒有請求
    const capped = await r.call('generate_music', { maxCostUsd: 0.01 })
    expect(capped.isError).toBe(true)
    expect(textOf(capped)).toContain('超過你給的上限')
    expect(committed()).toBe(start0)
    expect(noJobs(fake)).toHaveLength(requestsBefore)
    // 正常做：預留 = 預估 × 1.25
    const out = await r.call('generate_narration', { shotId: ids[0] })
    const text = textOf(out)
    expect(text).not.toContain(FAKE_OPENROUTER_KEY)
    expect(text).not.toContain(r.token)
    const reserved = committed() - start0
    expect(reserved).toBeCloseTo(0.002 * 1.25, 5)
  })
})
