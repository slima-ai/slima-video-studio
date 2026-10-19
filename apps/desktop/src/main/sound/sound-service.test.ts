import { probe, resolveTools } from '@svs/media'
import { makePng } from '@svs/test-utils'
import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []
const setup = (options: Parameters<typeof createStudioHarness>[0] = {}): Harness => {
  const harness = createStudioHarness(options)
  open.push(harness)
  return harness
}
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

/** 跑完一次快速開始（3 鏡、每鏡 3 秒），回傳鏡頭編號。 */
async function withShots(h: Harness): Promise<string[]> {
  await h.runQuickStart()
  return h.shots.list().shots.map((s) => s.id)
}

describe('SoundService（示範模式）', () => {
  it('沒開專案時回報白話錯誤', () => {
    const h = setup()
    expect(() => h.sound.state()).toThrow('請先開啟或建立一個專案')
  })

  it('狀態：鏡頭依序排在時間軸上（起點是前面各鏡長度的累加），預設設定全開，模型用示範的', async () => {
    const h = setup()
    const ids = await withShots(h)
    const state = h.sound.state()
    expect(state.shots.map((s) => s.shotId)).toEqual(ids)
    expect(state.shots[0]?.startSec).toBe(0)
    const [a, b, c] = state.shots
    expect(b?.startSec).toBeCloseTo(a?.durationSec ?? -1)
    expect(c?.startSec).toBeCloseTo((a?.durationSec ?? 0) + (b?.durationSec ?? 0))
    expect(state.totalSec).toBeCloseTo(state.shots.reduce((sum, s) => sum + s.durationSec, 0))
    expect(state.settings).toMatchObject({ nativeAudio: true, duck: true, musicGainDb: -18 })
    expect(state.models).toEqual({ tts: 'mock/tts', music: 'mock/music' })
    expect(state.music).toBeUndefined()
    expect(state.warnings).toEqual([])
  })

  it('預估：只列有台詞而且還沒有旁白的鏡頭，加上配樂；不花錢', async () => {
    const h = setup()
    const [first, second] = await withShots(h)
    if (!first || !second) throw new Error('應該有鏡頭')
    h.shots.update(first, { dialogue: '黑藤爬滿了斷橋。' })
    const plan = h.sound.plan({ narration: {}, music: {} })
    expect(plan.ok).toBe(true)
    expect(plan.items.map((i) => i.kind)).toEqual(['narration', 'music'])
    expect(plan.items[0]?.shotId).toBe(first)
    expect(plan.totalUsd).toBeCloseTo(plan.items.reduce((sum, i) => sum + i.estimatedUsd, 0))
    // 指定鏡頭時，沒有台詞的鏡頭不列
    expect(h.sound.plan({ narration: { shotIds: [second] } }).items).toEqual([])
  })

  it('旁白：念鏡頭的台詞，存成採用中的版本，量長度、記帳、推送 sound.changed', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    h.shots.update(first, { dialogue: '黑藤爬滿了斷橋。' })
    const clip = await h.sound.generateNarration({ shotId: first })
    expect(clip).toMatchObject({
      kind: 'narration',
      shotId: first,
      text: '黑藤爬滿了斷橋。',
      version: 1,
      adopted: true,
      modelId: 'mock/tts',
      offsetSec: 0.4,
    })
    expect(clip.durationSec).toBeGreaterThan(0)
    expect(clip.costEstimated).toBe(true)
    expect(h.sound.state().shots[0]?.narration?.id).toBe(clip.id)
    const handle = h.projects.current()
    expect(handle?.repos.costs.list(handle.projectId).some((c) => c.jobId !== undefined)).toBe(true)
    const pushed = h.events.filter((e) => e.name === 'sound.changed')
    expect(pushed.length).toBeGreaterThan(0)
  })

  it('再生一次多一個版本並自動採用；可以改回舊版本、刪除，刪掉採用中的就採用剩下最新的', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    h.shots.update(first, { dialogue: '第一句。' })
    const v1 = await h.sound.generateNarration({ shotId: first })
    const v2 = await h.sound.generateNarration({ shotId: first, text: '改成第二句比較長的台詞。' })
    expect([v1.version, v2.version]).toEqual([1, 2])
    expect(h.sound.state().shots[0]?.narration?.id).toBe(v2.id)
    h.sound.adoptClip(v1.id)
    expect(h.sound.state().shots[0]?.narration?.id).toBe(v1.id)
    h.sound.removeClip(v1.id)
    expect(h.sound.state().shots[0]?.narration?.id).toBe(v2.id)
  })

  it('沒有台詞、文字太長、找不到鏡頭：送出前就用白話回報，不花錢', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    await expect(h.sound.generateNarration({ shotId: first })).rejects.toThrow('還沒有台詞')
    await expect(
      h.sound.generateNarration({ shotId: first, text: '字'.repeat(5001) }),
    ).rejects.toThrow('旁白太長')
    await expect(h.sound.generateNarration({ shotId: 'nope', text: 'x' })).rejects.toThrow(
      '找不到這個鏡頭',
    )
    const handle = h.projects.current()
    expect(handle?.repos.sound.listClips()).toEqual([])
  })

  it('同一鏡正在生成時不能重複開始', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    h.shots.update(first, { dialogue: '一句話。' })
    const running = h.sound.generateNarration({ shotId: first })
    await expect(h.sound.generateNarration({ shotId: first })).rejects.toThrow('正在生成中')
    await running
  })

  it('旁白比鏡頭長很多：state 給白話警示，說是第幾鏡', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    h.shots.update(first, { dialogue: '很長的台詞'.repeat(20) })
    await h.sound.generateNarration({ shotId: first })
    const warning = h.sound.state().warnings.find((w) => w.kind === 'narration_too_long')
    expect(warning?.shotId).toBe(first)
    expect(warning?.message).toContain('第 1 鏡的旁白')
  })

  it('配樂：沒給描述就組一段純音樂的描述；整支一首，再生一次換成新版本', async () => {
    const h = setup()
    await withShots(h)
    const clip = await h.sound.generateMusic({})
    expect(clip).toMatchObject({ kind: 'music', version: 1, adopted: true, modelId: 'mock/music' })
    expect(clip.shotId).toBeUndefined()
    expect(clip.text).toContain('Instrumental only, no vocals')
    expect(h.sound.state().music?.id).toBe(clip.id)
    const second = await h.sound.generateMusic({ prompt: 'Calm piano, instrumental only.' })
    expect(second.version).toBe(2)
    expect(h.sound.state().music?.id).toBe(second.id)
  })

  it('調整片段與設定不花錢：起點、增益、淡化、哪幾鏡靜音原聲、關掉壓低', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    h.shots.update(first, { dialogue: '一句話。' })
    const clip = await h.sound.generateNarration({ shotId: first })
    const spentBefore = h.projects
      .current()
      ?.repos.costs.list(h.projects.current()?.projectId ?? '').length
    const tuned = h.sound.updateClip(clip.id, { offsetSec: 1, gainDb: -3, fadeOutSec: 0.5 })
    expect(tuned).toMatchObject({ offsetSec: 1, gainDb: -3, fadeOutSec: 0.5 })
    expect(h.sound.updateClip(clip.id, { gainDb: null }).gainDb).toBeUndefined()
    const settings = h.sound.updateSettings({ duck: false, muteNativeShotIds: [first] })
    expect(settings).toMatchObject({ duck: false, nativeAudio: true, muteNativeShotIds: [first] })
    expect(h.sound.state().shots[0]?.nativeMuted).toBe(true)
    // 只改一項，其他不動
    expect(h.sound.updateSettings({ musicGainDb: -24 })).toMatchObject({
      duck: false,
      musicGainDb: -24,
    })
    const spentAfter = h.projects
      .current()
      ?.repos.costs.list(h.projects.current()?.projectId ?? '').length
    expect(spentAfter).toBe(spentBefore)
  })

  it('超過單次花費上限：送出前就擋下，並說明', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    h.settings.update({ budget: { perRunLimitUsd: 0.000001 } })
    h.shots.update(first, { dialogue: '一句話。' })
    const plan = h.sound.plan({ narration: {}, music: {} })
    expect(plan.ok).toBe(false)
    expect(plan.issue).toBeTruthy()
    await expect(h.sound.generateMusic({})).rejects.toThrow()
  })
})

describe('SoundService：混音與成品（示範模式）', () => {
  const tools = resolveTools()
  const finalOf = (h: Harness) => {
    const handle = h.projects.current()
    const latest = handle?.repos.finalCuts.latest()
    if (!latest) throw new Error('還沒有成品')
    return latest
  }
  const durationOf = async (
    h: Harness,
    hash: string,
  ): Promise<{ hasAudio: boolean; durationSec: number }> => {
    const found = h.projects.current()?.assets.find(hash)
    if (!found) throw new Error('找不到素材')
    return probe(tools, found.path)
  }

  it('還沒有接好的成品時不能混音', async () => {
    const h = setup()
    // 只新增一個空鏡頭（會自動建專案），還沒接過片
    h.shots.create({})
    await expect(h.sound.mix()).rejects.toThrow('還沒有接好的成品')
  })

  it('沒有聲音要處理：接片的成品就是接片的結果，不算過期', async () => {
    const h = setup()
    await withShots(h)
    await h.shots.rejoin()
    const latest = finalOf(h)
    expect(latest.baseAssetHash).toBeUndefined()
    expect(latest.soundKey).toBeUndefined()
    expect(h.shots.finalCut()?.stale).toBe(false)
  })

  it('加了旁白與配樂之後成品變過期；混音產生新的成品版本（有聲、長度不變、記得接片結果），不再過期', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    await h.shots.rejoin()
    const plain = finalOf(h)
    h.shots.update(first, { dialogue: '黑藤爬滿了斷橋。' })
    await h.sound.generateNarration({ shotId: first })
    await h.sound.generateMusic({})
    expect(h.shots.finalCut()?.stale).toBe(true)
    expect(h.sound.state().final).toMatchObject({ hasSound: false, soundStale: true })

    const { videoHash, version } = await h.sound.mix()
    expect(h.sound.state().final).toMatchObject({ hasSound: true, soundStale: false })
    expect(version).toBe(plain.version + 1)
    const mixed = finalOf(h)
    expect(mixed.assetHash).toBe(videoHash)
    expect(mixed.baseAssetHash).toBe(plain.assetHash)
    expect(mixed.soundKey).toBeTruthy()
    expect(h.shots.finalCut()?.stale).toBe(false)
    const before = await durationOf(h, plain.assetHash)
    const after = await durationOf(h, videoHash)
    expect(after.hasAudio).toBe(true)
    expect(after.durationSec).toBeCloseTo(before.durationSec, 0)

    // 只調整音量也會讓成品過期，重混就好（接片的結果沒變）
    const narration = h.sound.state().shots[0]?.narration
    if (!narration) throw new Error('應該有旁白')
    h.sound.updateClip(narration.id, { gainDb: -6 })
    expect(h.shots.finalCut()?.stale).toBe(true)
    await h.sound.mix()
    expect(finalOf(h).baseAssetHash).toBe(plain.assetHash)
    expect(h.shots.finalCut()?.stale).toBe(false)
  })

  it('有聲音之後重新接片會自動混音：成品是混好的，不用再按混音', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    h.shots.update(first, { dialogue: '一句話。' })
    await h.sound.generateNarration({ shotId: first })
    const { videoHash } = await h.shots.rejoin()
    const latest = finalOf(h)
    expect(latest.assetHash).toBe(videoHash)
    expect(latest.baseAssetHash).toBeTruthy()
    expect(latest.baseAssetHash).not.toBe(videoHash)
    expect(h.shots.finalCut()?.stale).toBe(false)
  })

  it('把聲音都刪掉再混音：成品回到接片的結果，不再有聲音指紋', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    h.shots.update(first, { dialogue: '一句話。' })
    const clip = await h.sound.generateNarration({ shotId: first })
    await h.shots.rejoin()
    const mixed = finalOf(h)
    h.sound.removeClip(clip.id)
    await h.sound.mix()
    const back = finalOf(h)
    expect(back.assetHash).toBe(mixed.baseAssetHash)
    expect(back.soundKey).toBeUndefined()
    expect(h.shots.finalCut()?.stale).toBe(false)
  })

  it('靜音某一鏡的原聲也能混（只設定、沒有其他聲音）', async () => {
    const h = setup()
    const [first] = await withShots(h)
    if (!first) throw new Error('應該有鏡頭')
    await h.shots.rejoin()
    h.sound.updateSettings({ muteNativeShotIds: [first] })
    expect(h.shots.finalCut()?.stale).toBe(true)
    await h.sound.mix()
    expect(finalOf(h).soundKey).toBeTruthy()
    expect(h.shots.finalCut()?.stale).toBe(false)
  })

  it('量測成品：沒有成品要說明；有聲的成品回傳響度（接近 −16）、每鏡音量；沒有聲音的成品會警示', async () => {
    const h = setup()
    h.shots.create({})
    await expect(h.sound.analyze()).rejects.toThrow('還沒有接好的成品')

    const h2 = setup()
    const [first] = await withShots(h2)
    if (!first) throw new Error('應該有鏡頭')
    h2.shots.update(first, { dialogue: '黑藤爬滿了斷橋。' })
    await h2.sound.generateNarration({ shotId: first })
    await h2.sound.generateMusic({})
    await h2.shots.rejoin()
    const analysis = await h2.sound.analyze()
    expect(analysis.durationSec).toBeGreaterThan(0)
    expect(analysis.loudness.integratedLufs).toBeGreaterThan(-17.5)
    expect(analysis.loudness.integratedLufs).toBeLessThan(-14.5)
    expect(analysis.shots.map((s) => s.shotId)).toEqual(h2.sound.state().shots.map((s) => s.shotId))
    expect(analysis.shots[0]?.rmsDb).not.toBeNull()
    expect(analysis.warnings).toEqual([])
  })

  it('整支都是安靜的成品：警示說沒有任何聲音', async () => {
    const h = setup()
    await withShots(h)
    await h.shots.rejoin()
    const handle = h.projects.current()
    const latest = handle?.repos.finalCuts.latest()
    if (!handle || !latest) throw new Error('應該有成品')
    // 示範影片的音軌是靜音墊的；混音後仍然安靜時要警示
    h.sound.updateSettings({ nativeGainDb: -1 })
    await h.sound.mix()
    const analysis = await h.sound.analyze()
    expect(analysis.warnings.some((w) => w.includes('安靜') || w.includes('沒有'))).toBe(true)
  })
})

describe('SoundService：真實模式的預估價格', () => {
  it('填了 OpenRouter 金鑰、選 Lyria 3 Pro：配樂預估是 US$0.08（不是示範模式的價錢）；旁白用 MiniMax，漢字算兩個單位', () => {
    const h = setup({ demoMode: false })
    h.keys.set('openrouter', 'sk-or-v1-fake-test-key-0000')
    // 只新增一個空鏡頭（會自動建專案）；真實模式不會真的生成，只看預估
    const shot = h.shots.create({})
    h.shots.update(shot.id, { dialogue: '黑藤爬滿了斷橋。' })
    const plan = h.sound.plan({ narration: {}, music: {} })
    expect(plan.ok).toBe(true)
    const music = plan.items.find((i) => i.kind === 'music')
    expect(music).toMatchObject({ modelId: 'openrouter/lyria-3-pro', estimatedUsd: 0.08 })
    const narration = plan.items.find((i) => i.kind === 'narration')
    expect(narration?.modelId).toBe('openrouter/minimax-speech-2.8-hd')
    // 8 個漢字＋1 個全形句點＝9 個全形字×2＝18 個單位×US$0.0001
    expect(narration?.estimatedUsd).toBeCloseTo(0.0018)
    expect(plan.totalUsd).toBeCloseTo(0.0818)
    // 示範模式的價錢另外：不會跟真實模式混在一起
    const demo = setup()
    const demoShot = demo.shots.create({})
    demo.shots.update(demoShot.id, { dialogue: '一句話。' })
    expect(demo.sound.plan({ music: {} }).items[0]).toMatchObject({
      modelId: 'mock/music',
      estimatedUsd: 0.05,
    })
  })
})

describe('影片原聲開關：專案的聲音設定決定生成影片時帶不帶原聲', () => {
  const videoAudio = (h: Harness): boolean[] =>
    (h.projects.current()?.repos.jobs.list() ?? [])
      .filter((job) => job.kind === 'video')
      .map((job) => (job.input as { audio: boolean }).audio)

  it('預設帶原聲；關掉之後重新生成的影片不帶', async () => {
    const h = setup()
    await h.runQuickStart()
    expect(videoAudio(h).length).toBeGreaterThan(0)
    expect(videoAudio(h).every((a) => a)).toBe(true)

    h.sound.updateSettings({ nativeAudio: false })
    const [first] = h.shots.list().shots
    if (!first) throw new Error('應該有鏡頭')
    const before = videoAudio(h).length
    await h.shots.regenerate(first.id, 'video')
    await h.shots.whenIdle()
    const added = videoAudio(h).slice(before)
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((a) => !a)).toBe(true)
  })
})

describe('快速開始的聲音勾選', () => {
  const request = {
    story: '一隻貓在雨天裡找到溫暖的家',
    style: 'anime',
    shotCount: 2,
    durationSec: 3,
    aspectRatio: '16:9',
    variation: 0,
  } as const

  it('勾了配樂：加聲音算進同一次生成——說完成的時候聲音已經混進成品；過程中先顯示「正在加聲音」；原聲勾選存進專案設定', async () => {
    const h = setup()
    await h.quickstart.run({ ...request, sound: { native: false, narration: true, music: true } })
    const done = await h.finished()
    // 一說完成，旁白、配樂與混音都已經做完（不用再等）
    expect(h.sound.state().music).toBeDefined()
    expect(h.sound.state().final).toMatchObject({ hasSound: true, soundStale: false })
    expect(h.sound.state().settings.nativeAudio).toBe(false)
    expect(done.soundFailed).toBeUndefined()
    // 進度順序：接片 → 加聲音（還是進行中）→ 完成；完成之前不能先說完成
    const snapshots = h.progress()
    const soundIndex = snapshots.findIndex((p) => p.phase === 'sound')
    const doneIndex = snapshots.findIndex((p) => p.status === 'succeeded')
    expect(soundIndex).toBeGreaterThan(-1)
    expect(doneIndex).toBeGreaterThan(soundIndex)
    expect(snapshots.slice(0, doneIndex).every((p) => p.status === 'running')).toBe(true)
    // 完成時的成品就是混好聲音的那一版
    const handle = h.projects.current()
    expect(done.finalVideoHash).toBe(handle?.repos.finalCuts.latest()?.assetHash)
    expect(handle?.repos.finalCuts.latest()?.soundKey).toBeTruthy()
  })

  it('加聲音失敗：影片照樣完成（狀態成功），標記聲音沒加成，成品是沒有聲音的那一版', async () => {
    const h = setup()
    vi.spyOn(h.sound, 'addAll').mockRejectedValue(new Error('旁白服務壞了'))
    await h.quickstart.run({ ...request, sound: { native: true, narration: true, music: true } })
    const done = await h.finished()
    expect(done).toMatchObject({ status: 'succeeded', phase: 'done', soundFailed: true })
    expect(done.finalVideoHash).toBeDefined()
    expect(h.projects.current()?.repos.finalCuts.latest()?.soundKey).toBeUndefined()
  })

  it('加聲音的途中按停止：算停止（做好的影片留著），不算失敗', async () => {
    const h = setup()
    vi.spyOn(h.sound, 'addAll').mockImplementation(
      (input) =>
        new Promise((_resolve, reject) => {
          input.signal?.addEventListener('abort', () => {
            reject(new Error('已取消'))
          })
          // 等到進入加聲音階段才停止
          setTimeout(() => {
            h.quickstart.cancel()
          }, 20)
        }),
    )
    await h.quickstart.run({ ...request, sound: { native: true, narration: true, music: true } })
    const done = await h.finished()
    expect(done.status).toBe('cancelled')
    expect(done.soundFailed).toBeUndefined()
    expect(done.finalVideoHash).toBeDefined()
  })

  it('沒給 sound（舊的呼叫方式）：不自動加聲音', async () => {
    const h = setup()
    await h.quickstart.run(request)
    await h.finished()
    expect(h.sound.state().music).toBeUndefined()
    expect(h.sound.state().final?.hasSound).toBe(false)
  })

  it('預估：勾了配樂與旁白就多算它們的花費', () => {
    const h = setup()
    const without = h.quickstart.check(request).estimatedUsd
    const withMusic = h.quickstart.check({
      ...request,
      sound: { native: true, narration: false, music: true },
    }).estimatedUsd
    const withBoth = h.quickstart.check({
      ...request,
      sound: { native: true, narration: true, music: true },
    }).estimatedUsd
    expect(withMusic).toBeGreaterThan(without)
    expect(withBoth).toBeGreaterThan(withMusic)
  })

  it('匯出的是最新一版成品（含聲音），不是這次接好的沒聲音的那版', async () => {
    const h = setup()
    await h.quickstart.run({ ...request, sound: { native: true, narration: false, music: true } })
    await h.finished()
    expect(h.sound.state().final?.hasSound).toBe(true)
    const handle = h.projects.current()
    const latest = handle?.repos.finalCuts.latest()
    if (!handle || !latest?.baseAssetHash) throw new Error('應該有混好的成品')
    const { path } = await h.quickstart.export()
    const exported = readFileSync(path)
    const mixed = readFileSync(handle.assets.find(latest.assetHash)?.path ?? '')
    const base = readFileSync(handle.assets.find(latest.baseAssetHash)?.path ?? '')
    expect(exported.equals(mixed)).toBe(true)
    expect(exported.equals(base)).toBe(false)
  })
})

describe('匯出的片尾字卡', () => {
  const request = {
    story: '一隻貓在雨天裡找到溫暖的家',
    style: 'anime',
    shotCount: 2,
    durationSec: 3,
    aspectRatio: '16:9',
    variation: 0,
  } as const
  const tools = resolveTools()
  const fakeCard =
    (seen: { lines: string[]; width: number; height: number }[]) =>
    (input: { lines: readonly string[]; width: number; height: number }) => {
      seen.push({ lines: [...input.lines], width: input.width, height: input.height })
      return Promise.resolve(
        makePng({ width: input.width, height: input.height, color: [20, 20, 20] }),
      )
    }
  const lengthOf = async (path: string): Promise<number> => (await probe(tools, path)).durationSec

  it('預設加字卡：匯出的檔案比成品多 3 秒，字卡文字收到的是這個專案用的服務（示範模式只有產品那一行），專案裡的成品不變', async () => {
    const seen: { lines: string[]; width: number; height: number }[] = []
    const h = setup({ renderCreditsCard: fakeCard(seen) })
    await h.quickstart.run(request)
    await h.finished()
    const handle = h.projects.current()
    const latest = handle?.repos.finalCuts.latest()
    if (!handle || !latest) throw new Error('應該有成品')
    const finalPath = handle.assets.find(latest.assetHash)?.path ?? ''
    const before = await lengthOf(finalPath)
    const exported = await h.quickstart.export()
    expect(exported.credits).toBe(true)
    expect(await lengthOf(exported.path)).toBeCloseTo(before + 3, 0)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.lines).toEqual(['Made with Slima Video Studio'])
    expect(seen[0]?.width).toBeGreaterThan(0)
    // 專案裡的成品沒有被改
    expect(handle.repos.finalCuts.latest()?.assetHash).toBe(latest.assetHash)
    expect(await lengthOf(finalPath)).toBeCloseTo(before, 1)
  })

  it('credits: false 就匯出沒有字卡的原版（不呼叫畫圖）', async () => {
    const seen: { lines: string[]; width: number; height: number }[] = []
    const h = setup({ renderCreditsCard: fakeCard(seen) })
    await h.quickstart.run(request)
    await h.finished()
    const plain = await h.quickstart.export({ credits: false })
    expect(plain.credits).toBe(false)
    expect(seen).toEqual([])
    const handle = h.projects.current()
    const latest = handle?.repos.finalCuts.latest()
    expect(
      readFileSync(plain.path).equals(
        readFileSync(handle?.assets.find(latest?.assetHash ?? '')?.path ?? ''),
      ),
    ).toBe(true)
  })

  it('字卡畫失敗：不能害使用者匯不出影片，改匯出沒有字卡的版本；沒給畫圖的函式也一樣', async () => {
    const h = setup({
      renderCreditsCard: () => Promise.reject(new Error('離屏視窗開不起來')),
    })
    await h.quickstart.run(request)
    await h.finished()
    const exported = await h.quickstart.export()
    expect(exported.credits).toBe(false)
    expect(existsSync(exported.path)).toBe(true)

    const none = setup()
    await none.quickstart.run(request)
    await none.finished()
    expect((await none.quickstart.export()).credits).toBe(false)
  })
})
