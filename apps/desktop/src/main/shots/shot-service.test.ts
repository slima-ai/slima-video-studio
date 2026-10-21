import { cameraMoveById, type Take } from '@svs/schema'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runAsAi } from '../history/ai-origin'
import { generatedNodeKeys, nextVariations } from './shot-service'
import { createStudioHarness, type HarnessOptions } from './test-harness'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

function setup(options: HarnessOptions = {}) {
  const harness = createStudioHarness(options)
  cleanups.push(harness.cleanup)
  return harness
}

const take = (version: number, seed: number | undefined, adopted = false): Take => ({
  id: `t${String(version)}`,
  shotId: 's1',
  kind: 'video',
  version,
  assetHash: 'a'.repeat(64),
  adopted,
  modelId: 'mock/video',
  ...(seed === undefined ? {} : { seed }),
  createdAt: '2026-10-12T00:00:00.000Z',
})

describe('nextVariations', () => {
  const frames = [take(1, 0), take(2, 1, true)]
  const videos = [take(1, 0), take(2, 3, true), take(3, 2)]

  it('apply：兩邊都沿用目前採用的版本', () => {
    expect(nextVariations('apply', frames, videos)).toEqual({
      imageVariation: 1,
      videoVariation: 3,
    })
  })

  it('video：首幀沿用，影片取已用過的最大值加一', () => {
    expect(nextVariations('video', frames, videos)).toEqual({
      imageVariation: 1,
      videoVariation: 4,
    })
  })

  it('all：兩邊都換新的', () => {
    expect(nextVariations('all', frames, videos)).toEqual({ imageVariation: 2, videoVariation: 4 })
  })

  it('還沒有任何版本：從 0 開始（換新的從 0 之後算起）', () => {
    expect(nextVariations('apply', [], [])).toEqual({ imageVariation: 0, videoVariation: 0 })
    expect(nextVariations('all', [], [])).toEqual({ imageVariation: 0, videoVariation: 0 })
  })
})

// 這些測試每個都先跑一次示範的快速開始（用 FFmpeg 產生假影片），單獨跑約 2～3 秒；
// 全套平行跑時 CPU 被分走，會超過預設的 5 秒，所以和下面的「採用與接片」一樣給 30 秒
describe('快速開始之後的鏡頭資料', { timeout: 30_000 }, () => {
  it('每個鏡頭存進專案：描述、一張首幀圖、一支影片，都是採用中', async () => {
    const { shots, runQuickStart, events } = setup()
    expect(shots.list()).toEqual({ shots: [] })

    const done = await runQuickStart()
    const snapshot = shots.list()
    expect(snapshot.shots).toHaveLength(3)
    expect(snapshot.finalVideoHash).toBe(done.finalVideoHash)
    snapshot.shots.forEach((shot, index) => {
      expect(shot.number).toBe(index + 1)
      expect(shot.description).not.toBe('')
      expect(shot.status).toBe('done')
      expect(shot.activity).toBeUndefined()
      expect(shot.firstFrames).toHaveLength(1)
      expect(shot.videos).toHaveLength(1)
      expect(shot.firstFrames[0]).toMatchObject({ version: 1, adopted: true, seed: 0 })
      expect(shot.videos[0]).toMatchObject({ version: 1, adopted: true, seed: 0 })
      expect(shot.videos[0]?.assetHash).toBe(done.shots[index]?.videoHash)
      expect(shot.autoPrompt).toContain(shot.description)
    })
    expect(events.some((e) => e.name === 'shots.changed')).toBe(true)
  })

  it('再跑一次相同內容：鏡頭整批換成新的，每個鏡頭仍然只有一個版本', async () => {
    const { shots, runQuickStart } = setup()
    await runQuickStart()
    const firstIds = shots.list().shots.map((s) => s.id)
    await runQuickStart()
    const second = shots.list().shots
    expect(second).toHaveLength(3)
    expect(second.map((s) => s.id)).not.toEqual(firstIds)
    expect(second.every((s) => s.videos.length === 1 && s.firstFrames.length === 1)).toBe(true)
  })
})

describe('shots.update', { timeout: 30_000 }, () => {
  it('改描述、運鏡、秒數；Prompt 改過會優先使用，清空就回到自動組出的內容', async () => {
    const { shots, runQuickStart } = setup()
    await runQuickStart()
    const [first] = shots.list().shots
    if (!first) throw new Error('沒有鏡頭')

    const edited = shots.update(first.id, {
      description: '  貓跳上窗台  ',
      cameraMove: 'push_in',
      durationSec: 5,
    })
    expect(edited).toMatchObject({
      description: '貓跳上窗台',
      cameraMove: 'push_in',
      durationSec: 5,
    })
    expect(edited.autoPrompt).toContain('貓跳上窗台')
    expect(edited.prompt).toBeUndefined()

    const custom = shots.update(first.id, { prompt: '  a cat jumping  ' })
    expect(custom.prompt).toBe('a cat jumping')
    expect(custom.autoPrompt).toContain('貓跳上窗台')

    expect(shots.update(first.id, { prompt: null }).prompt).toBeUndefined()
    expect(shots.update(first.id, { prompt: '   ' }).prompt).toBeUndefined()
    expect(shots.update(first.id, { cameraMove: '' }).cameraMove).toBeNull()
  })

  it('找不到鏡頭 → 白話錯誤', async () => {
    const { shots, runQuickStart } = setup()
    await runQuickStart()
    expect(() => shots.update('nope', { description: 'x' })).toThrow(/找不到這個鏡頭/)
  })

  it('沒有開啟專案 → 請先建立專案', () => {
    const { shots } = setup()
    expect(() => shots.update('x', { description: 'x' })).toThrow(/請先開啟或建立一個專案/)
  })
})

describe('shots.regenerate', { timeout: 30_000 }, () => {
  it('只換影片：多一個影片版本並自動採用，首幀圖與其他鏡頭都不動', async () => {
    const { shots, runQuickStart, idle } = setup()
    await runQuickStart()
    const before = shots.list().shots
    const target = before[1]
    if (!target) throw new Error('沒有鏡頭')

    await shots.regenerate(target.id, 'video')
    await idle(target.id)

    const after = shots.list().shots
    expect(after[1]?.firstFrames).toEqual(target.firstFrames)
    expect(after[1]?.videos).toHaveLength(2)
    expect(after[1]?.videos[1]).toMatchObject({ version: 2, adopted: true, seed: 1 })
    expect(after[1]?.videos[0]).toMatchObject({ version: 1, adopted: false })
    expect(after[1]?.videos[1]?.assetHash).not.toBe(target.videos[0]?.assetHash)
    expect(after[1]?.status).toBe('done')
    expect(after[0]).toEqual(before[0])
    expect(after[2]).toEqual(before[2])
  })

  it('選了「環繞」→ 送給影片模型的請求裡有環繞的 Prompt 片段；改成固定就換成固定的片段', async () => {
    const { shots, runQuickStart, idle, projects } = setup()
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')
    const videoPrompts = (): string[] =>
      (projects.current()?.repos.jobs.list() ?? [])
        .filter((job) => job.kind === 'video')
        .map((job) => (job.input as { prompt: string }).prompt)

    // 第一次生成時沒有指定運鏡，Prompt 裡沒有任何運鏡描述
    expect(videoPrompts().some((p) => p.includes('環繞') || p.includes('固定'))).toBe(false)

    shots.update(target.id, { cameraMove: 'orbit' })
    await shots.regenerate(target.id, 'apply')
    await idle(target.id)
    const orbit = cameraMoveById('orbit')?.prompt.zh ?? ''
    expect(orbit).not.toBe('')
    expect(videoPrompts().filter((p) => p.endsWith(`，${orbit}`))).toHaveLength(1)
    expect(shots.list().shots[0]?.videos).toHaveLength(2)

    // 不同的運鏡 → 不同的結果（沒有沿用舊快取）；請求裡也留著選的是哪個預設
    shots.update(target.id, { cameraMove: 'static' })
    await shots.regenerate(target.id, 'apply')
    await idle(target.id)
    expect(
      videoPrompts().some((p) => p.endsWith(`，${cameraMoveById('static')?.prompt.zh ?? ''}`)),
    ).toBe(true)
    const inputs = (projects.current()?.repos.jobs.list() ?? [])
      .filter((job) => job.kind === 'video')
      .map((job) => (job.input as { cameraMove?: string }).cameraMove)
    expect(inputs).toEqual(expect.arrayContaining(['orbit', 'static']))
    expect(shots.list().shots[0]?.videos).toHaveLength(3)
  })

  it('整個重做：首幀圖和影片都多一個新版本', async () => {
    const { shots, runQuickStart, idle } = setup()
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')
    await shots.regenerate(target.id, 'all')
    await idle(target.id)
    const after = shots.list().shots[0]
    expect(after?.firstFrames).toHaveLength(2)
    expect(after?.videos).toHaveLength(2)
    expect(after?.firstFrames[1]).toMatchObject({ adopted: true, seed: 1 })
    expect(after?.videos[1]).toMatchObject({ adopted: true, seed: 1 })
  })

  it('套用修改：改了描述才會做新的；沒改就全部沿用，不多出版本', async () => {
    const { shots, runQuickStart, idle } = setup()
    await runQuickStart()
    const target = shots.list().shots[2]
    if (!target) throw new Error('沒有鏡頭')

    await shots.regenerate(target.id, 'apply')
    await idle(target.id)
    expect(shots.list().shots[2]?.videos).toHaveLength(1)
    expect(shots.list().shots[2]?.firstFrames).toHaveLength(1)

    shots.update(target.id, { description: '貓在屋頂上看月亮' })
    await shots.regenerate(target.id, 'apply')
    await idle(target.id)
    const after = shots.list().shots[2]
    expect(after?.firstFrames).toHaveLength(2)
    expect(after?.videos).toHaveLength(2)
    expect(after?.videos[1]?.adopted).toBe(true)
  })

  it('過程中看得到進行到哪一步，結束後清掉', async () => {
    const { shots, runQuickStart, events, idle } = setup()
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')
    events.length = 0

    await shots.regenerate(target.id, 'all')
    await idle(target.id)
    const steps = events
      .filter((e) => e.name === 'shots.changed')
      .map((e) => {
        const snapshot = e.payload as ReturnType<typeof shots.list>
        return snapshot.shots[0]?.activity?.step
      })
    expect(steps).toEqual(expect.arrayContaining(['prompt', 'image', 'video']))
    expect(steps.at(-1)).toBeUndefined()
  })

  it('AI 叫的生成在背景做完，通知畫面標「AI 剛改」（只標有新結果的格子）；使用者自己按的不通知', async () => {
    const { shots, runQuickStart, events, idle } = setup()
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')
    const aiEvents = () => events.filter((e) => e.name === 'canvas.aiChanged')

    // 使用者自己按（畫面來的呼叫）：不通知
    events.length = 0
    await shots.regenerate(target.id, 'video')
    await idle(target.id)
    expect(aiEvents()).toEqual([])

    // AI 工具（MCP）叫的：還沒做完時不通知，做完才通知，而且只有影片那一格
    events.length = 0
    await runAsAi(() => shots.regenerate(target.id, 'video'))
    expect(aiEvents()).toEqual([])
    await idle(target.id)
    expect(aiEvents()).toHaveLength(1)
    expect(aiEvents()[0]?.payload).toMatchObject({
      channel: 'generation.done',
      changed: [`shot:${target.id}:video`],
      added: [],
      removed: [],
    })
    // 通知在鏡頭資料更新之後（畫面重新讀到新結果才標）
    const names = events.map((e) => e.name)
    expect(names.lastIndexOf('shots.changed')).toBeLessThan(names.indexOf('canvas.aiChanged'))

    // 整個鏡頭重新生成：圖與影片兩格都標
    events.length = 0
    await runAsAi(() => shots.regenerate(target.id, 'all'))
    await idle(target.id)
    expect(aiEvents()[0]?.payload).toMatchObject({
      changed: [`shot:${target.id}:image`, `shot:${target.id}:video`],
    })
  }, 30_000)

  it('AI 叫的生成被取消：不通知', async () => {
    const { shots, runQuickStart, events, idle } = setup()
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')
    events.length = 0
    await runAsAi(() => shots.regenerate(target.id, 'all'))
    shots.cancel(target.id)
    await idle(target.id)
    expect(events.filter((e) => e.name === 'canvas.aiChanged')).toEqual([])
  }, 30_000)

  it('AI 叫的生成有節點失敗：不通知（engine.run 失敗是正常回傳，不會丟錯），畫面照樣顯示錯誤', async () => {
    const { shots, runQuickStart, events, idle } = setup({ mockRejectText: '【拒絕】' })
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')
    shots.update(target.id, { description: '【拒絕】這一鏡會被拒絕' })
    events.length = 0

    await runAsAi(() => shots.regenerate(target.id, 'frame'))
    await idle(target.id)
    // 真的失敗了：鏡頭上有錯誤
    expect(shots.list().shots.find((s) => s.id === target.id)?.error).toBeTruthy()
    expect(events.filter((e) => e.name === 'canvas.aiChanged')).toEqual([])
  }, 30_000)

  it('同一個鏡頭正在重新生成時不能再按；整支影片生成中也不行', async () => {
    const { shots, quickstart, runQuickStart, idle } = setup()
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')

    await shots.regenerate(target.id, 'all')
    await expect(shots.regenerate(target.id, 'video')).rejects.toThrow(/正在重新生成/)
    await idle(target.id)

    await quickstart.run({
      story: '另一個故事',
      style: 'anime',
      shotCount: 3,
      durationSec: 3,
      aspectRatio: '16:9',
      variation: 0,
    })
    const other = shots.list().shots[0]
    await expect(shots.regenerate(other?.id ?? 'x', 'video')).rejects.toThrow(/整支影片正在生成/)
    quickstart.cancel()
  })

  it('可以取消：不會多出新版本，鏡頭維持原狀', async () => {
    const { shots, runQuickStart, idle } = setup()
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')
    await shots.regenerate(target.id, 'all')
    shots.cancel(target.id)
    await idle(target.id)
    const after = shots.list().shots[0]
    expect(after?.error).toBeUndefined()
    expect(after?.videos.every((v) => v.version === 1 || v.adopted)).toBe(true)
    expect(after?.status).toBe('done')
  })

  it('預估花費超過單次上限 → 直接回報白話錯誤，鏡頭沒有被鎖住', async () => {
    const { shots, settings, runQuickStart, idle } = setup()
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')

    settings.update({ budget: { perRunLimitUsd: 0.0001 } })
    await expect(shots.regenerate(target.id, 'all')).rejects.toThrow(/超過「單次花費上限」/)
    expect(shots.list().shots[0]?.videos).toHaveLength(1)

    settings.update({ budget: { perRunLimitUsd: 5 } })
    await shots.regenerate(target.id, 'all')
    await idle(target.id)
    expect(shots.list().shots[0]?.videos).toHaveLength(2)
  })

  it('找不到鏡頭 → 白話錯誤', async () => {
    const { shots, runQuickStart } = setup()
    await runQuickStart()
    await expect(shots.regenerate('nope', 'video')).rejects.toThrow(/找不到這個鏡頭/)
  })
})

// 這一組每個測試都跑好幾次真的 FFmpeg 接片（單跑約 4 秒），全套並行、加上 coverage 時會超過預設的 5 秒
describe('shots.adopt 與 shots.rejoin', { timeout: 30_000 }, () => {
  it('換回舊版本後重新接片，用的是舊版本的影片', async () => {
    const { shots, runQuickStart, idle, projects } = setup()
    const done = await runQuickStart()
    const original = done.finalVideoHash
    const target = shots.list().shots[1]
    if (!target) throw new Error('沒有鏡頭')

    await shots.regenerate(target.id, 'video')
    await idle(target.id)
    const regenerated = await shots.rejoin()
    expect(regenerated.videoHash).not.toBe(original)
    expect(shots.list().finalVideoHash).toBe(regenerated.videoHash)

    const [oldVideo, newVideo] = shots.list().shots[1]?.videos ?? []
    expect(newVideo?.adopted).toBe(true)
    const adopted = shots.adopt(oldVideo?.id ?? 'x')
    expect(adopted.videos.map((v) => v.adopted)).toEqual([true, false])
    const handle = projects.current()
    expect(handle?.repos.shots.get(target.id)?.activeTakeId).toBe(oldVideo?.id)

    const back = await shots.rejoin()
    expect(back.videoHash).not.toBe(regenerated.videoHash)
    expect(back.videoHash).toBe(original)
    expect(handle?.assets.has(back.videoHash)).toBe(true)
  })

  it('接片後快速開始的預覽與匯出也改用新接好的影片', async () => {
    const { shots, quickstart, runQuickStart, idle, progress } = setup()
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')
    await shots.regenerate(target.id, 'video')
    await idle(target.id)
    const { videoHash } = await shots.rejoin()
    expect(quickstart.state()?.finalVideoHash).toBe(videoHash)
    expect(progress().at(-1)?.finalVideoHash).toBe(videoHash)
    expect((await quickstart.export()).path).toMatch(/\.mp4$/)
  })

  it('有鏡頭還沒有影片 → 說清楚是第幾鏡', async () => {
    const { shots, runQuickStart, projects } = setup()
    await runQuickStart()
    const handle = projects.current()
    const created = handle?.repos.shots.create({ description: '還沒生成的一鏡' })
    expect(created?.number).toBe(4)
    await expect(shots.rejoin()).rejects.toThrow(/第 4 鏡還沒有可用的影片/)
  })

  it('沒有鏡頭可以接 → 白話錯誤', async () => {
    const { shots, quickstart, projects, root } = setup()
    projects.create(join(root, 'empty.svsproj'), '空專案')
    await expect(shots.rejoin()).rejects.toThrow(/還沒有鏡頭可以接/)
    expect(quickstart.state()).toBeNull()
  })
})

describe('重新開啟專案', { timeout: 30_000 }, () => {
  it('鏡頭與各個版本都還在（資料存在專案資料夾裡）', async () => {
    const { shots, runQuickStart, idle, projects } = setup()
    await runQuickStart()
    const target = shots.list().shots[0]
    if (!target) throw new Error('沒有鏡頭')
    await shots.regenerate(target.id, 'video')
    await idle(target.id)
    const before = shots.list().shots
    const info = projects.info()
    if (!info) throw new Error('沒有專案')

    projects.close()
    expect(shots.list()).toEqual({ shots: [] })
    projects.open(info.dir)
    expect(shots.list().shots).toEqual(before)
  })
})

describe('鏡頭表：新增、刪除、排序與更多欄位', () => {
  function withShots() {
    const h = setup()
    h.outline.edit({ op: 'addAct' })
    const view = h.outline.edit({ op: 'addLocation' })
    const act = view.acts[0]
    const place = view.locations[0]
    const scene = act?.scenes[0]
    if (!act || !place || !scene) throw new Error('沒有大綱')
    const a = h.shots.create({ sceneId: scene.id })
    const b = h.shots.create({})
    const c = h.shots.create({ afterShotId: a.id })
    return { h, a, b, c, scene, place }
  }

  it('新增：預設放最後；指定 afterShotId 放在它後面；鏡號跟著順序', () => {
    const { h, a, b, c, scene } = withShots()
    expect(a).toMatchObject({
      description: '新的鏡頭',
      size: 'medium',
      angle: 'eye_level',
      sceneId: scene.id,
    })
    expect(h.shots.list().shots.map((s) => [s.id, s.number])).toEqual([
      [a.id, 1],
      [c.id, 2],
      [b.id, 3],
    ])
    expect(() => h.shots.create({ afterShotId: 'nope' })).toThrow('找不到這個鏡頭')
    expect(() => h.shots.create({ sceneId: 'nope' })).toThrow('找不到這個場')
  })

  it('新增鏡頭沒指定場：專案沒有場就先建一個；有場就放前一個鏡頭的場、再不然最後一個場——鏡頭不會沒有場', () => {
    const h = setup()
    const scenes = () => h.outline.get().acts.flatMap((act) => act.scenes)
    // 專案裡一個場都沒有：連幕帶場先建好，鏡頭放進去
    expect(scenes()).toHaveLength(0)
    const first = h.shots.create({})
    expect(scenes()).toHaveLength(1)
    expect(first.sceneId).toBe(scenes()[0]?.id)
    // 再新增：進同一個場，不會每次多建一個
    expect(h.shots.create({}).sceneId).toBe(first.sceneId)
    expect(scenes()).toHaveLength(1)
    // 加第二個場：沒指定放最後一個場；指定 afterShotId 跟著那個鏡頭的場；明確指定場照指定
    const act = h.outline.get().acts[0]
    if (!act) throw new Error('沒有幕')
    h.outline.edit({ op: 'addScene', actId: act.id })
    const [one, two] = scenes()
    if (!one || !two) throw new Error('場不夠')
    expect(h.shots.create({}).sceneId).toBe(two.id)
    expect(h.shots.create({ afterShotId: first.id }).sceneId).toBe(one.id)
    expect(h.shots.create({ sceneId: one.id }).sceneId).toBe(one.id)
    expect(h.shots.list().shots.every((shot) => shot.sceneId !== undefined)).toBe(true)
  })

  it('歸進場：刪掉場之後留下沒歸場的鏡頭，一鍵歸進最後一個場；一個場都沒有就先建一個', () => {
    const h = setup()
    const a = h.shots.create({})
    const b = h.shots.create({})
    const scenes = () => h.outline.get().acts.flatMap((act) => act.scenes)
    const old = a.sceneId
    if (old === undefined) throw new Error('鏡頭沒有場')
    h.outline.edit({ op: 'deleteScene', sceneId: old })
    expect(h.shots.list().shots.map((s) => s.sceneId)).toEqual([undefined, undefined])
    expect(scenes()).toHaveLength(0)
    // 一個場都沒有：先建一個，兩個鏡頭一起歸進去
    const snapshot = h.shots.assignScene([a.id, b.id])
    expect(scenes()).toHaveLength(1)
    expect(snapshot.shots.map((s) => s.sceneId)).toEqual([scenes()[0]?.id, scenes()[0]?.id])
    // 已經有場：沒指定就放最後一個場，不再多建
    h.outline.edit({ op: 'addScene', actId: h.outline.get().acts[0]?.id ?? '' })
    const [, second] = scenes()
    h.outline.edit({ op: 'deleteScene', sceneId: scenes()[0]?.id ?? '' })
    expect(h.shots.list().shots.every((s) => s.sceneId === undefined)).toBe(true)
    expect(h.shots.assignScene([a.id]).shots.find((s) => s.id === a.id)?.sceneId).toBe(second?.id)
    expect(scenes()).toHaveLength(1)
    expect(() => h.shots.assignScene(['nope'])).toThrow('找不到這個鏡頭')
    expect(() => h.shots.assignScene([a.id], 'nope')).toThrow('找不到這個場')
  })

  it('排序：必須包含所有鏡頭；排完重新編號', () => {
    const { h, a, b, c } = withShots()
    const snapshot = h.shots.reorder([b.id, c.id, a.id])
    expect(snapshot.shots.map((s) => [s.id, s.number])).toEqual([
      [b.id, 1],
      [c.id, 2],
      [a.id, 3],
    ])
    expect(() => h.shots.reorder([a.id])).toThrow('所有鏡頭')
  })

  it('刪除一個或多個：剩下的重新編號，沒有的 id 忽略', () => {
    const { h, a, b, c } = withShots()
    const snapshot = h.shots.remove([c.id, 'nope'])
    expect(snapshot.shots.map((s) => [s.id, s.number])).toEqual([
      [a.id, 1],
      [b.id, 2],
    ])
    expect(h.shots.remove([a.id, b.id]).shots).toEqual([])
  })

  it('編輯更多欄位：景別、角度、台詞、角色、場、地點、光線、時段、氣氛；null 或空白代表清掉', () => {
    const { h, a, scene, place } = withShots()
    const edited = h.shots.update(a.id, {
      size: 'close_up',
      angle: 'side',
      dialogue: ' 你好 ',
      characters: ['阿鐵', '小花'],
      locationId: place.id,
      lighting: '逆光',
      timeOfDay: '黃昏',
      mood: '安靜',
    })
    expect(edited).toMatchObject({
      size: 'close_up',
      angle: 'side',
      dialogue: '你好',
      characters: ['阿鐵', '小花'],
      sceneId: scene.id,
      locationId: place.id,
      lighting: '逆光',
      timeOfDay: '黃昏',
      mood: '安靜',
    })
    const cleared = h.shots.update(a.id, {
      sceneId: null,
      locationId: null,
      lighting: ' ',
      timeOfDay: null,
      mood: null,
      characters: [],
    })
    expect(cleared.sceneId).toBeUndefined()
    expect(cleared.locationId).toBeUndefined()
    expect(cleared.lighting).toBeUndefined()
    expect(cleared.timeOfDay).toBeUndefined()
    expect(cleared.mood).toBeUndefined()
    expect(cleared.characters).toEqual([])
    expect(() => h.shots.update(a.id, { sceneId: 'nope' })).toThrow('找不到這個場')
    expect(() => h.shots.update(a.id, { locationId: 'nope' })).toThrow('找不到這個地點')
  })

  it('整支影片生成中不能新增、刪除、調整順序', () => {
    const { h, a } = withShots()
    h.shots.beginQuickStart({
      style: 'realistic',
      aspectRatio: '16:9',
      variation: 0,
      models: { image: 'mock/image', video: 'mock/video' },
    })
    expect(() => h.shots.create({})).toThrow('正在生成')
    expect(() => h.shots.remove([a.id])).toThrow('正在生成')
    expect(() => h.shots.reorder([a.id])).toThrow('正在生成')
  })
})

describe('shots.batchCheck / generateBatch', { timeout: 30_000 }, () => {
  /** 快速開始做出 3 個鏡頭，再加 2 個還沒生成的新鏡頭。 */
  async function withFiveShots() {
    const ctx = setup()
    await ctx.runQuickStart()
    ctx.shots.create({})
    ctx.shots.create({})
    const all = ctx.shots.list().shots
    expect(all).toHaveLength(5)
    return { ...ctx, all }
  }

  it('檢查：略過已生成過的，只算真的要做的；示範模式不花錢', async () => {
    const { shots, all } = await withFiveShots()
    const ids = all.map((s) => s.id)

    const skip = shots.batchCheck({ shotIds: ids, skipGenerated: true })
    expect(skip).toMatchObject({ ok: true, willGenerate: 2, skippedGenerated: 3, skippedBusy: 0 })
    expect(skip.demoMode).toBe(true)

    const redo = shots.batchCheck({ shotIds: ids, skipGenerated: false })
    expect(redo).toMatchObject({ ok: true, willGenerate: 5, skippedGenerated: 0 })
  })

  it('檢查：全部都生成過 → 說明原因；找不到鏡頭；整批預估超過上限', async () => {
    const { shots, settings, all } = await withFiveShots()
    const generated = all.slice(0, 3).map((s) => s.id)
    const none = shots.batchCheck({ shotIds: generated, skipGenerated: true })
    expect(none.ok).toBe(false)
    expect(none.issue).toContain('都已經生成過')

    expect(shots.batchCheck({ shotIds: ['nope'], skipGenerated: false })).toMatchObject({
      ok: false,
      issue: '找不到選取的鏡頭。',
    })

    settings.update({ budget: { perRunLimitUsd: 0.0001 } })
    const over = shots.batchCheck({ shotIds: all.map((s) => s.id), skipGenerated: false })
    expect(over.ok).toBe(false)
    expect(over.issue).toMatch(/超過「單次花費上限」/)
  })

  it('批次生成：每個鏡頭各自開始，完成後都有新版本；已生成過的依選項略過', async () => {
    const { shots, idle, all } = await withFiveShots()
    const result = await shots.generateBatch({
      shotIds: all.map((s) => s.id),
      skipGenerated: true,
    })
    expect(result).toEqual({ started: 2, skippedGenerated: 3, skippedBusy: 0, failed: [] })
    for (const shot of all.slice(3)) await idle(shot.id)

    const after = shots.list().shots
    expect(after.slice(0, 3).every((s) => s.videos.length === 1)).toBe(true)
    expect(after.slice(3).every((s) => s.videos.length === 1 && s.status === 'done')).toBe(true)
  })

  it('其中一個鏡頭沒辦法開始：記在 failed 裡，其他鏡頭照常生成', async () => {
    const { shots, idle, all } = await withFiveShots()
    const [first, second] = all.slice(3)
    if (!first || !second) throw new Error('沒有鏡頭')
    // 第一個先佔住（正在重新生成），批次時不重複開始它
    await shots.regenerate(first.id, 'all')
    const result = await shots.generateBatch({
      shotIds: [first.id, second.id],
      skipGenerated: false,
    })
    expect(result).toMatchObject({ started: 1, skippedBusy: 1, failed: [] })
    await idle(first.id)
    await idle(second.id)
    expect(shots.list().shots.find((s) => s.id === second.id)?.status).toBe('done')
  })

  it('整批不能開始時直接說明原因（沒有鏡頭可做）', async () => {
    const { shots, all } = await withFiveShots()
    await expect(
      shots.generateBatch({ shotIds: all.slice(0, 3).map((s) => s.id), skipGenerated: true }),
    ).rejects.toThrow(/都已經生成過/)
  })
})

describe('shots.batchCheck 先出草稿', { timeout: 30_000 }, () => {
  it('打勾就整批用經濟組的模型估價；沒打勾照設定的', async () => {
    const h = setup()
    await h.runQuickStart()
    h.settings.update({ demoMode: false })
    h.keys.set('fal', 'fal-test-key-1234567890')
    const ids = h.shots.list().shots.map((s) => s.id)
    const normal = h.shots.batchCheck({ shotIds: ids, skipGenerated: false })
    const draft = h.shots.batchCheck({ shotIds: ids, skipGenerated: false, draft: true })
    expect(normal.models.video).toBe('Kling 3.0 Standard')
    expect(draft.models.image).toBe('Seedream 5.0 Lite')
    // 經濟組比較便宜（影片換成經濟組的；fal 上的 Veo 下架後退回設定的，至少圖片便宜）
    expect(draft.estimatedUsd).toBeLessThan(normal.estimatedUsd)
  })
})

describe('批次生成的階段：只生首幀圖／只生影片', { timeout: 60_000 }, () => {
  /** 快速開始做出 3 個鏡頭（都有首幀與影片），再加 2 個還沒生成的新鏡頭。 */
  async function withFiveShots() {
    const ctx = setup()
    await ctx.runQuickStart()
    ctx.shots.create({})
    ctx.shots.create({})
    const all = ctx.shots.list().shots
    expect(all).toHaveLength(5)
    const jobs = (kind: string): number =>
      (ctx.projects.current()?.repos.jobs.list() ?? []).filter((j) => j.kind === kind).length
    return { ...ctx, all, jobs }
  }

  it('只生首幀圖：新鏡頭有了首幀、沒有影片（也沒有送出任何影片任務）；已經有首幀的略過', async () => {
    const { shots, idle, all, jobs } = await withFiveShots()
    const ids = all.map((s) => s.id)
    const videoJobsBefore = jobs('video')
    const check = shots.batchCheck({ shotIds: ids, skipGenerated: true, stage: 'frame' })
    expect(check).toMatchObject({ ok: true, willGenerate: 2, skippedGenerated: 3 })

    const result = await shots.generateBatch({ shotIds: ids, skipGenerated: true, stage: 'frame' })
    expect(result).toMatchObject({ started: 2, skippedGenerated: 3, failed: [] })
    for (const shot of all.slice(3)) await idle(shot.id)

    const after = shots.list().shots
    for (const shot of after.slice(3)) {
      expect(shot.firstFrames).toHaveLength(1)
      expect(shot.firstFrames[0]?.adopted).toBe(true)
      expect(shot.videos).toHaveLength(0)
      expect(shot.status).not.toBe('done')
    }
    expect(jobs('video')).toBe(videoJobsBefore) // 一個影片任務都沒有
    expect(after.slice(0, 3).every((s) => s.videos.length === 1)).toBe(true)
  })

  it('只生影片：用現有的首幀圖生影片，不再生新的首幀；沒有首幀的鏡頭略過，全都沒有時說明原因', async () => {
    const { shots, idle, all, jobs } = await withFiveShots()
    const ids = all.map((s) => s.id)
    // 沒有首幀的兩個鏡頭：只生影片被略過，而且說明原因
    const noFrames = shots.batchCheck({
      shotIds: ids.slice(3),
      skipGenerated: true,
      stage: 'video',
    })
    expect(noFrames.ok).toBe(false)
    expect(noFrames.issue).toContain('還沒有首幀圖')
    const mixed = shots.batchCheck({ shotIds: ids, skipGenerated: false, stage: 'video' })
    expect(mixed).toMatchObject({ ok: true, willGenerate: 3, skippedNoFrame: 2 })

    // 先生首幀，再生影片
    await shots.generateBatch({ shotIds: ids, skipGenerated: true, stage: 'frame' })
    for (const shot of all.slice(3)) await idle(shot.id)
    const imageJobs = jobs('image')
    const check = shots.batchCheck({ shotIds: ids, skipGenerated: true, stage: 'video' })
    expect(check).toMatchObject({
      ok: true,
      willGenerate: 2,
      skippedGenerated: 3,
      skippedNoFrame: 0,
    })
    const result = await shots.generateBatch({ shotIds: ids, skipGenerated: true, stage: 'video' })
    expect(result).toMatchObject({ started: 2, failed: [] })
    for (const shot of all.slice(3)) await idle(shot.id)

    for (const shot of shots.list().shots.slice(3)) {
      expect(shot.firstFrames).toHaveLength(1) // 首幀沒有被重生
      expect(shot.videos).toHaveLength(1)
      expect(shot.status).toBe('done')
    }
    expect(jobs('image')).toBe(imageJobs) // 沒有再送出任何圖片任務
  })

  it('重做首幀（不略過）：換一張新的首幀、影片不動；regenerate 的 frame 模式一樣', async () => {
    const { shots, idle, all } = await withFiveShots()
    const first = all[0]
    if (!first) throw new Error('沒有鏡頭')
    const before = shots.list().shots[0]
    expect(before?.firstFrames).toHaveLength(1)
    expect(before?.videos).toHaveLength(1)
    await shots.generateBatch({ shotIds: [first.id], skipGenerated: false, stage: 'frame' })
    await idle(first.id)
    let now = shots.list().shots[0]
    expect(now?.firstFrames).toHaveLength(2)
    expect(now?.videos).toHaveLength(1)
    await shots.regenerate(first.id, 'frame')
    await idle(first.id)
    now = shots.list().shots[0]
    expect(now?.firstFrames).toHaveLength(3)
    expect(now?.videos).toHaveLength(1)
  })

  it('只生首幀的預估比整個鏡頭便宜；沒有影片模型也能生首幀', async () => {
    const { shots, all } = await withFiveShots()
    const ids = all.slice(3).map((s) => s.id)
    const frame = shots.batchCheck({ shotIds: ids, skipGenerated: false, stage: 'frame' })
    const full = shots.batchCheck({ shotIds: ids, skipGenerated: false, stage: 'full' })
    expect(frame.estimatedUsd).toBeGreaterThan(0)
    expect(frame.estimatedUsd).toBeLessThan(full.estimatedUsd)
  })
})

describe('generatedNodeKeys', () => {
  it('首幀圖只標圖那一格、影片只標影片那一格，其他（整個鏡頭）兩格都標', () => {
    expect(generatedNodeKeys('s1', 'frame')).toEqual(['shot:s1:image'])
    expect(generatedNodeKeys('s1', 'video')).toEqual(['shot:s1:video'])
    expect(generatedNodeKeys('s1', 'all')).toEqual(['shot:s1:image', 'shot:s1:video'])
    expect(generatedNodeKeys('s1', 'apply')).toEqual(['shot:s1:image', 'shot:s1:video'])
  })
})
