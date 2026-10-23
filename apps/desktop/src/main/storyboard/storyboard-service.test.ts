import {
  DEFAULT_STORYBOARD_GUIDE,
  ShotAngleSchema,
  ShotSizeSchema,
  type LlmRequest,
  type OutlineLocationView,
  type OutlineSceneView as Scene,
} from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []

const SHOTS = {
  shots: [
    {
      description: '阿鐵撐傘走進巷口',
      size: 'wide',
      angle: 'eye_level',
      cameraMove: 'push_in',
      durationSec: 4,
      characters: ['阿鐵'],
      dialogue: '',
      lighting: '昏黃路燈、潮濕反光',
    },
    {
      description: '紙箱裡的小貓抬頭',
      size: 'close_up',
      angle: 'high',
      cameraMove: null,
      durationSec: 3,
      characters: [],
      dialogue: '喵',
      lighting: null,
      mood: '溫柔',
    },
  ],
}

const setup = (mock?: (r: LlmRequest) => object | undefined): Harness => {
  const harness = createStudioHarness({
    mockLlm: mock ?? ((r) => (r.system?.includes('分鏡助手') ? SHOTS : undefined)),
  })
  open.push(harness)
  return harness
}
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

/** 兩幕各兩個場，第一個場有地點與時間。 */
function outlineOf(h: Harness): {
  scenes: [Scene, Scene, Scene, Scene]
  place: OutlineLocationView
} {
  h.outline.edit({ op: 'addAct' })
  h.outline.edit({ op: 'addAct' })
  const view = h.outline.edit({ op: 'addLocation' })
  const place = view.locations[0]
  const [a1, a2] = view.acts
  if (!place || !a1 || !a2) throw new Error('沒有大綱')
  h.outline.edit({ op: 'updateLocation', locationId: place.id, patch: { name: '舊街' } })
  h.outline.edit({ op: 'addScene', actId: a1.id })
  const full = h.outline.edit({ op: 'addScene', actId: a2.id })
  const scenes = full.acts.flatMap((a) => a.scenes)
  const [s1, s2, s3, s4] = scenes
  if (!s1 || !s2 || !s3 || !s4) throw new Error('場不夠')
  h.outline.edit({
    op: 'updateScene',
    sceneId: s1.id,
    patch: { title: '街角', summary: '阿鐵撿到小貓', locationId: place.id, timeOfDay: '深夜' },
  })
  return { scenes: [s1, s2, s3, s4], place }
}

describe('StoryboardService：AI 依場拆鏡頭', () => {
  it('提示文字裡的景別與角度說明涵蓋所有可用值（schema 加了新值時這裡會提醒）', async () => {
    let system = ''
    const h = setup((r) => {
      system = r.system ?? ''
      return SHOTS
    })
    const { scenes } = outlineOf(h)
    await h.storyboard.splitScene(scenes[0].id)
    for (const value of [...ShotSizeSchema.options, ...ShotAngleSchema.options]) {
      expect(system).toContain(value)
    }
  })

  it('場的內容不是中文：提示多一句「用故事的語言寫」（App 自己加的中文標籤不算）；中文的場沒有這一句', async () => {
    const systems: string[] = []
    const h = setup((r) => {
      systems.push(r.system ?? '')
      return SHOTS
    })
    const { scenes } = outlineOf(h)
    await h.storyboard.splitScene(scenes[0].id) // 街角：阿鐵撿到小貓（中文）
    // 這一幕的標題也是使用者寫的（App 預設的標題是「第 N 幕」，那種不算；這裡換成英文）
    const act = h.outline.get().acts.find((a) => a.scenes.some((s) => s.id === scenes[1].id))
    if (!act) throw new Error('找不到場所在的幕')
    h.outline.edit({ op: 'updateAct', actId: act.id, patch: { title: 'Act two' } })
    h.outline.edit({
      op: 'updateScene',
      sceneId: scenes[1].id,
      patch: { title: 'The bottle', summary: 'Mina finds a green bottle on the doorstep.' },
    })
    await h.storyboard.splitScene(scenes[1].id)
    expect(systems[0]).not.toContain('故事不是中文')
    expect(systems[1]).toContain('故事不是中文')
  })

  it('分鏡準則會帶進提示：沒自訂用內建預設，有自訂用自訂的，輸出格式的要求還在', async () => {
    let system = ''
    const h = setup((r) => {
      system = r.system ?? ''
      return SHOTS
    })
    const { scenes } = outlineOf(h)
    await h.storyboard.splitScene(scenes[0].id)
    expect(system).toContain(DEFAULT_STORYBOARD_GUIDE)
    expect(system.indexOf('只輸出 JSON')).toBeLessThan(system.indexOf(DEFAULT_STORYBOARD_GUIDE))

    h.settings.update({ storyboardGuide: '每個場一定要有一個遠景。' })
    await h.storyboard.splitScene(scenes[0].id)
    expect(system).toContain('每個場一定要有一個遠景。')
    expect(system).not.toContain(DEFAULT_STORYBOARD_GUIDE)
  })

  it('拆出鏡頭：欄位完整、沿用場的地點與時間，並依序編號', async () => {
    const h = setup()
    const { scenes, place } = outlineOf(h)
    expect(h.storyboard.splitCheck(scenes[0].id)).toMatchObject({
      ok: true,
      demoMode: true,
      existingShots: 0,
      generatedShots: 0,
    })

    const snapshot = await h.storyboard.splitScene(scenes[0].id)
    expect(snapshot.shots.map((s) => [s.number, s.description, s.sceneId])).toEqual([
      [1, '阿鐵撐傘走進巷口', scenes[0].id],
      [2, '紙箱裡的小貓抬頭', scenes[0].id],
    ])
    expect(snapshot.shots[0]).toMatchObject({
      size: 'wide',
      angle: 'eye_level',
      cameraMove: 'push_in',
      durationSec: 4,
      characters: ['阿鐵'],
      lighting: '昏黃路燈、潮濕反光',
      locationId: place.id,
      timeOfDay: '深夜',
    })
    expect(snapshot.shots[1]).toMatchObject({
      size: 'close_up',
      angle: 'high',
      dialogue: '喵',
      mood: '溫柔',
      locationId: place.id,
    })
  })

  it('鏡頭依場的順序排：後面的場拆完放後面，再拆前面的場會插在它前面', async () => {
    const h = setup()
    const { scenes } = outlineOf(h)
    await h.storyboard.splitScene(scenes[2].id)
    const snapshot = await h.storyboard.splitScene(scenes[0].id)
    expect(snapshot.shots.map((s) => [s.number, s.sceneId === scenes[0].id ? '一' : '三'])).toEqual(
      [
        [1, '一'],
        [2, '一'],
        [3, '三'],
        [4, '三'],
      ],
    )
    // 中間的場有人先拆：排在兩者之間
    const middle = await h.storyboard.splitScene(scenes[1].id)
    expect(middle.shots.map((s) => s.sceneId)).toEqual([
      scenes[0].id,
      scenes[0].id,
      scenes[1].id,
      scenes[1].id,
      scenes[2].id,
      scenes[2].id,
    ])
  })

  it('重新拆同一個場：原本的鏡頭換成新的，位置不變，其他場不受影響', async () => {
    const h = setup()
    const { scenes } = outlineOf(h)
    await h.storyboard.splitScene(scenes[0].id)
    await h.storyboard.splitScene(scenes[1].id)
    const before = h.shots.list().shots
    const secondSceneIds = before.filter((s) => s.sceneId === scenes[1].id).map((s) => s.id)

    expect(h.storyboard.splitCheck(scenes[0].id)).toMatchObject({ existingShots: 2 })
    const after = await h.storyboard.splitScene(scenes[0].id)
    expect(after.shots.map((s) => s.sceneId)).toEqual([
      scenes[0].id,
      scenes[0].id,
      scenes[1].id,
      scenes[1].id,
    ])
    expect(after.shots.slice(2).map((s) => s.id)).toEqual(secondSceneIds)
    expect(after.shots.slice(0, 2).every((s) => !before.some((b) => b.id === s.id))).toBe(true)
  })

  it('已經生成過畫面的鏡頭會算進「換掉就沒了」的數字', async () => {
    const h = setup()
    const { scenes } = outlineOf(h)
    await h.storyboard.splitScene(scenes[0].id)
    const [first] = h.shots.list().shots
    if (!first) throw new Error('沒有鏡頭')
    await h.shots.regenerate(first.id, 'all')
    await h.idle(first.id)
    expect(h.storyboard.splitCheck(scenes[0].id)).toMatchObject({
      existingShots: 2,
      generatedShots: 1,
    })
  })

  it('花費記進帳本；找不到場、AI 格式不對時不動原本的鏡頭', async () => {
    const h = setup()
    const { scenes } = outlineOf(h)
    await h.storyboard.splitScene(scenes[0].id)
    expect(() => h.storyboard.splitCheck('nope')).not.toThrow()
    expect(h.storyboard.splitCheck('nope')).toMatchObject({ ok: false })
    await expect(h.storyboard.splitScene('nope')).rejects.toThrow()

    const broken = setup(() => ({ shots: [] }))
    const o = outlineOf(broken)
    await expect(broken.storyboard.splitScene(o.scenes[0].id)).rejects.toThrow()
    expect(broken.shots.list().shots).toEqual([])
  })

  it('AI 給的運鏡不在預設清單裡 → 被擋下重問，不會存進專案', async () => {
    const h = setup(() => ({
      shots: [{ description: '一個鏡頭', cameraMove: '亂編的運鏡' }],
    }))
    const { scenes } = outlineOf(h)
    await expect(h.storyboard.splitScene(scenes[0].id)).rejects.toThrow()
    expect(h.shots.list().shots).toEqual([])
  })
})
