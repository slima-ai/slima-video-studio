import { vi } from 'vitest'
import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

/** 跑完一次 3 鏡的快速開始：三個鏡頭都有首幀圖和影片。 */
async function setup() {
  const harness = createStudioHarness()
  harnesses.push(harness)
  await harness.runQuickStart()
  return harness
}

const shotIds = (h: Awaited<ReturnType<typeof setup>>): string[] =>
  h.shots.list().shots.map((s) => s.id)

describe('canvas.runPlan', () => {
  it('生成鈕旁選「高品質／平衡／經濟」：用那一組推薦的模型，預估花費跟著變；沒給就用設定的', async () => {
    const h = await setup()
    h.shots.create({})
    // 關掉示範模式、填 fal.ai 的金鑰：才有分等級的真實模型
    h.settings.update({ demoMode: false })
    h.keys.set('fal', 'fal-test-key-1234567890')
    const plan = (quality?: 'premium' | 'balanced' | 'budget') =>
      h.canvas.runPlan({ keys: [], all: true, ...(quality ? { quality } : {}) })
    const premium = plan('premium')
    const balanced = plan('balanced')
    expect(premium.models.video).toBe('Kling 3.0 Pro')
    expect(balanced.models.video).toBe('Kling 3.0 Standard')
    // 一鏡 3 秒：預設帶原聲，影片每秒有聲價 0.168 對 0.126
    expect(premium.estimatedUsd).toBeGreaterThan(balanced.estimatedUsd)
    expect(premium.estimatedUsd - balanced.estimatedUsd).toBeCloseTo((0.168 - 0.126) * 3, 3)
    // 把影片原聲關掉：回到無聲價 0.112 對 0.084
    h.sound.updateSettings({ nativeAudio: false })
    expect(plan('premium').estimatedUsd - plan('balanced').estimatedUsd).toBeCloseTo(
      (0.112 - 0.084) * 3,
      3,
    )
    // 沒指定：設定裡的（預設是平衡組推薦的）
    expect(plan().models.video).toBe('Kling 3.0 Standard')
    // 那一組沒有能用的圖片模型（只有 fal 時高品質圖片要 OpenRouter）：照平常
    expect(premium.models.image).toBe('Nano Banana 2')
  })

  it('照選的等級執行：真的用那一組的模型生成', async () => {
    const h = await setup()
    const created = h.shots.create({})
    const settled = h.canvas.run({ keys: [`shot:${created.id}:video`], quality: 'budget' })
    await expect(settled).resolves.toMatchObject({ started: 1 })
    // 示範模式只有一組示範模型：每一等級都退回同一個，不會失敗
    await h.shots.whenIdle()
    const view = h.shots.list().shots.find((s) => s.id === created.id)
    expect(view?.videos.at(-1)?.modelId).toBe('mock/video')
  })

  it('全部都生成好了：沒有要跑的步驟，也不花錢', async () => {
    const h = await setup()
    const plan = h.canvas.runPlan({ keys: [], all: true })
    expect(plan).toMatchObject({ ok: true, steps: [], shotCount: 0, estimatedUsd: 0 })
  })

  it('新增的空鏡頭：全部生成補首幀圖和影片，其他鏡頭不動', async () => {
    const h = await setup()
    const created = h.shots.create({})
    const plan = h.canvas.runPlan({ keys: [], all: true })
    expect(plan.ok).toBe(true)
    expect(plan.shotCount).toBe(1)
    // 新鏡頭也放進成品：接好的成品對不上了，最後一步是接成品
    expect(plan.steps.map((s) => [s.key, s.kind, s.redo])).toEqual([
      [`shot:${created.id}:image`, 'image', false],
      [`shot:${created.id}:video`, 'video', false],
      ['cut', 'cut', false],
    ])
    expect(plan.rejoin).toBe(true)
    expect(plan.segments).toBe(4)
    expect(plan.highlightKeys).toEqual(
      expect.arrayContaining([
        `shot:${created.id}`,
        `shot:${created.id}:image`,
        `shot:${created.id}:video`,
      ]),
    )
    expect(plan.steps[0]?.label).toBe(`第 ${String(created.number)} 鏡：第一張畫面`)
  })

  it('按在已完成的影片上：只重做這支影片；按在已完成的圖上：整個鏡頭重做', async () => {
    const h = await setup()
    const [first] = shotIds(h)
    expect(first).toBeDefined()
    const video = h.canvas.runPlan({ keys: [`shot:${first}:video`] })
    expect(video.steps.map((s) => [s.kind, s.redo])).toEqual([['video', true]])
    // 重做會產生第 2 版，第 1 版保留
    expect(video.steps[0]?.versions).toEqual({ current: 1, next: 2 })
    const image = h.canvas.runPlan({ keys: [`shot:${first}:image`] })
    expect(image.steps.map((s) => [s.kind, s.redo])).toEqual([
      ['image', true],
      ['video', true],
    ])
    // 選了好幾個節點：只補缺的，不重做已完成的
    const many = h.canvas.runPlan({ keys: [`shot:${first}:video`, `shot:${first}:image`] })
    expect(many.steps).toEqual([])
  })

  it('場節點：只跑這個場的鏡頭（缺的才補）', async () => {
    const h = await setup()
    const scene = h.canvas.add({ kind: 'scene' })
    const shot = h.canvas.add({ kind: 'shot', sceneKey: scene.key })
    const plan = h.canvas.runPlan({ keys: [scene.key] })
    expect(plan.steps.map((s) => s.key)).toEqual([`${shot.key}:image`, `${shot.key}:video`])
    expect(plan.shotCount).toBe(1)
  })

  it('剪輯節點：都有影片時只剩接片一步', async () => {
    const h = await setup()
    const plan = h.canvas.runPlan({ keys: ['cut'] })
    expect(plan).toMatchObject({ ok: true, rejoin: true, shotCount: 0 })
    expect(plan.steps.map((s) => s.kind)).toEqual(['cut'])
    expect(plan.highlightKeys).toContain('cut')
  })

  it('不認得的節點、沒有鏡頭：說明這裡沒有可以執行的', async () => {
    const h = await setup()
    expect(h.canvas.runPlan({ keys: ['character:x'] })).toMatchObject({
      ok: false,
      issue: '這裡沒有可以執行的鏡頭。',
    })
  })
})

// 真的生成並用 FFmpeg 接片：全套並行時會超過預設的 5 秒
describe('canvas.run', { timeout: 30_000 }, () => {
  it('補跑缺的步驟：開始後鏡頭有首幀圖和影片，再檢查就沒有要跑的了', async () => {
    const h = await setup()
    const created = h.shots.create({})
    const result = await h.canvas.run({ keys: [`shot:${created.id}:video`] })
    expect(result).toEqual({ started: 1, failed: [] })
    await vi.waitFor(
      () => {
        const shot = h.shots.list().shots.find((s) => s.id === created.id)
        expect(shot?.firstFrames).toHaveLength(1)
        expect(shot?.videos).toHaveLength(1)
        expect(shot?.activity).toBeUndefined()
      },
      { timeout: 30_000, interval: 20 },
    )
    // 素材都補好了；成品還是舊的三段，跟現在對不上，所以「全部生成」只剩接成品（不花錢）
    const after = h.canvas.runPlan({ keys: [], all: true })
    expect(after.steps.map((s) => s.kind)).toEqual(['cut'])
    expect(after.estimatedUsd).toBe(0)
  })

  it('全部生成：補完缺的再接成品；接好之後就都生成好了，成品多一個版本', async () => {
    const h = await setup()
    expect(h.shots.finalCut()).toMatchObject({ version: 1, stale: false })
    h.shots.create({})
    expect(h.shots.finalCut()?.stale).toBe(true)
    await h.canvas.run({ keys: [], all: true })
    await vi.waitFor(
      () => {
        expect(h.shots.finalCut()).toMatchObject({ version: 2, stale: false })
      },
      { timeout: 30_000, interval: 20 },
    )
    expect(h.canvas.runPlan({ keys: [], all: true }).steps).toEqual([])
  })

  it('關掉一鏡的「放進成品」：成品對不上，接成品時跳過它；全部關掉就不能接', async () => {
    const h = await setup()
    const [first, second, third] = shotIds(h)
    if (!first || !second || !third) throw new Error('鏡頭不夠')
    h.shots.update(second, { inCut: false })
    const plan = h.canvas.runPlan({ keys: [], all: true })
    expect(plan.steps.map((s) => s.kind)).toEqual(['cut'])
    expect(plan.segments).toBe(2)
    await h.shots.rejoin()
    const latest = h.projects.current()?.repos.finalCuts.latest()
    const adopted = (id: string) =>
      h.projects
        .current()
        ?.repos.shots.listTakes(id, 'video')
        .find((t) => t.adopted)?.id
    expect(latest?.takeIds).toEqual([adopted(first), adopted(third)])
    expect(h.shots.finalCut()).toMatchObject({ version: 2, stale: false })

    h.shots.update(first, { inCut: false })
    h.shots.update(third, { inCut: false })
    await expect(h.shots.rejoin()).rejects.toThrow('沒有放進成品的鏡頭')
  })

  it('重做一支影片：多一個版本，圖不變', async () => {
    const h = await setup()
    const [first] = shotIds(h)
    if (!first) throw new Error('沒有鏡頭')
    await h.canvas.run({ keys: [`shot:${first}:video`] })
    await vi.waitFor(
      () => {
        const shot = h.shots.list().shots.find((s) => s.id === first)
        expect(shot?.videos).toHaveLength(2)
        expect(shot?.activity).toBeUndefined()
      },
      { timeout: 30_000, interval: 20 },
    )
    expect(h.shots.list().shots.find((s) => s.id === first)?.firstFrames).toHaveLength(1)
  })

  it('剪輯節點：生成完自動接片，完成後通知畫面', async () => {
    const h = await setup()
    h.shots.create({})
    const result = await h.canvas.run({ keys: ['cut'] })
    expect(result.started).toBe(1)
    await vi.waitFor(
      () => {
        const notice = h.events.filter((e) => e.name === 'canvas.notice').at(-1)
        expect(notice?.payload).toEqual({ tone: 'success', message: '成品接好了' })
      },
      { timeout: 30_000, interval: 20 },
    )
    expect(h.shots.list().shots.every((s) => s.videos.length > 0)).toBe(true)
  })

  it('沒有東西要跑的時候執行：不丟錯，開始 0 個', async () => {
    const h = await setup()
    expect(await h.canvas.run({ keys: [], all: true })).toEqual({ started: 0, failed: [] })
  })
})

// 「先產生分鏡」之後按「全部生成」：照一句話卡片記住的聲音勾選，接好片後自動加旁白與配樂
describe('全部生成加聲音', { timeout: 60_000 }, () => {
  const ALL_ON = { native: false, narration: true, music: true }

  /** 一句話卡片勾好聲音 → 先產生分鏡 → 每個鏡頭寫上台詞（分鏡寫好後使用者看過、改好）。 */
  async function storyboarded(sound: { native: boolean; narration: boolean; music: boolean }) {
    const harness = createStudioHarness()
    harnesses.push(harness)
    const oneliner = harness.canvas.add({ kind: 'oneliner' })
    harness.canvas.updateOneliner({ key: oneliner.key, patch: { sound } })
    await harness.quickstart.run({
      story: '一隻貓在雨天裡找到溫暖的家',
      style: 'anime',
      shotCount: 3,
      durationSec: 3,
      aspectRatio: '16:9',
      variation: 0,
      mode: 'append',
      sourceKey: oneliner.key,
      sound,
      stage: 'storyboard',
    })
    await harness.finished()
    for (const shot of harness.shots.list().shots) {
      harness.shots.update(shot.id, { dialogue: `第 ${String(shot.number)} 鏡的台詞。` })
    }
    return { h: harness, oneliner }
  }

  const noticesOf = (h: Awaited<ReturnType<typeof storyboarded>>['h']): string[] =>
    h.events
      .filter((e) => e.name === 'canvas.notice')
      .map((e) => (e.payload as { message: string }).message)

  const settled = async (h: Awaited<ReturnType<typeof storyboarded>>['h'], text: string) => {
    await vi.waitFor(
      () => {
        expect(noticesOf(h)).toContain(text)
      },
      { timeout: 30_000, interval: 20 },
    )
  }

  it('預估多出旁白與配樂的錢，確認面板能列出來；差額就是聲音那一份', async () => {
    const { h, oneliner } = await storyboarded(ALL_ON)
    const withSound = h.canvas.runPlan({ keys: [], all: true })
    expect(withSound.sound).toMatchObject({ narration: true, music: true })
    expect(withSound.sound?.usd).toBeGreaterThan(0)
    // 把卡片上的旁白與配樂都關掉：同一批鏡頭的預估少了聲音那一份，也不再有 sound
    h.canvas.updateOneliner({
      key: oneliner.key,
      patch: { sound: { native: false, narration: false, music: false } },
    })
    const without = h.canvas.runPlan({ keys: [], all: true })
    expect(without.sound).toBeUndefined()
    expect(withSound.estimatedUsd - without.estimatedUsd).toBeCloseTo(withSound.sound?.usd ?? -1, 6)
  })

  it('全部生成：影片接好後自動念每一鏡的台詞、生一首配樂，成品混進聲音', async () => {
    const { h } = await storyboarded(ALL_ON)
    await h.canvas.run({ keys: [], all: true })
    await settled(h, '旁白與配樂也加好了')
    const state = h.sound.state()
    expect(state.shots.every((s) => s.narration !== undefined)).toBe(true)
    expect(state.music).toBeDefined()
    expect(state.final?.hasSound).toBe(true)
    // 先說接好了、正在加聲音，最後才說加好
    expect(noticesOf(h)).toEqual(['成品接好了，正在加旁白與配樂…', '旁白與配樂也加好了'])
  })

  it('沒勾的不加：只勾配樂就只有配樂，沒有任何旁白', async () => {
    const { h } = await storyboarded({ native: false, narration: false, music: true })
    const plan = h.canvas.runPlan({ keys: [], all: true })
    expect(plan.sound).toMatchObject({ narration: false, music: true })
    await h.canvas.run({ keys: [], all: true })
    await settled(h, '旁白與配樂也加好了')
    const state = h.sound.state()
    expect(state.music).toBeDefined()
    expect(state.shots.every((s) => s.narration === undefined)).toBe(true)
  })

  it('旁白與配樂都沒勾：不加聲音，還是只說成品接好了', async () => {
    const { h } = await storyboarded({ native: false, narration: false, music: false })
    expect(h.canvas.runPlan({ keys: [], all: true }).sound).toBeUndefined()
    await h.canvas.run({ keys: [], all: true })
    await settled(h, '成品接好了')
    expect(h.sound.state().music).toBeUndefined()
    expect(h.sound.state().final?.hasSound).toBe(false)
  })

  it('自己一步一步做的鏡頭（沒有一句話連著）：全部生成不自動加聲音', async () => {
    const h = await setup()
    h.shots.create({})
    const plan = h.canvas.runPlan({ keys: [], all: true })
    expect(plan.rejoin).toBe(true)
    expect(plan.sound).toBeUndefined()
  })

  it('已經有配樂就不再生一首：再補跑一次只補缺的旁白', async () => {
    const { h } = await storyboarded(ALL_ON)
    await h.canvas.run({ keys: [], all: true })
    await settled(h, '旁白與配樂也加好了')
    const firstMusic = h.sound.state().music?.id
    // 新增一個鏡頭、寫上台詞，再按全部生成
    const extra = h.shots.create({ sceneId: h.shots.list().shots[0]?.sceneId })
    h.shots.update(extra.id, { dialogue: '多出來的一鏡。' })
    const plan = h.canvas.runPlan({ keys: [], all: true })
    expect(plan.sound).toMatchObject({ narration: true, music: false })
    await h.canvas.run({ keys: [], all: true })
    // 第二輪的兩則通知也出現了（第一輪留下的「加好了」不能算）
    await vi.waitFor(
      () => {
        expect(noticesOf(h)).toHaveLength(4)
      },
      { timeout: 30_000, interval: 20 },
    )
    expect(noticesOf(h).at(-1)).toBe('旁白與配樂也加好了')
    expect(h.sound.state().music?.id).toBe(firstMusic)
    expect(h.sound.state().shots.every((s) => s.narration !== undefined)).toBe(true)
  })
})
