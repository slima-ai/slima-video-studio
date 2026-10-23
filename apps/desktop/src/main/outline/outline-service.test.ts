import type { LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []

const SPLIT = {
  acts: [
    {
      title: '雨夜相遇',
      summary: '阿鐵在街角遇到小貓',
      scenes: [
        { title: '街角', summary: '阿鐵撐傘走過', location: '舊街', timeOfDay: '夜', mood: '安靜' },
        { title: '紙箱', summary: '發現小貓', location: '舊街', timeOfDay: '夜', mood: null },
      ],
    },
    {
      title: '回家',
      summary: '',
      scenes: [{ title: '公寓', summary: '把貓帶回家', location: '不存在的地點' }],
    },
  ],
  characters: [
    {
      name: '阿鐵',
      age: '28',
      appearance: '短黑髮',
      outfit: '深藍雨衣',
      personality: '嘴硬心軟',
      anchor: '28 歲男性、短黑髮、深藍雨衣',
    },
    { name: '小貓', appearance: '', anchor: '' },
  ],
  locations: [{ name: '舊街', description: '濕漉漉的石板路' }],
}

const mockSplit = (request: LlmRequest): object | undefined =>
  request.system?.includes('編劇助手') ? SPLIT : undefined

const setup = (extra: Parameters<typeof createStudioHarness>[0] = {}): Harness => {
  const harness = createStudioHarness({ mockLlm: mockSplit, ...extra })
  open.push(harness)
  return harness
}
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

describe('OutlineService：編輯', () => {
  it('還沒有專案時是空的；新增第一幕會自動建立專案，並附一個空的場', () => {
    const h = setup()
    expect(h.outline.get()).toEqual({ acts: [], locations: [] })
    expect(h.projects.current()).toBeUndefined()

    const view = h.outline.edit({ op: 'addAct' })
    expect(h.projects.current()).toBeDefined()
    expect(view.acts).toHaveLength(1)
    expect(view.acts[0]?.title).toBe('第 1 幕')
    expect(view.acts[0]?.scenes.map((s) => s.title)).toEqual(['新的場'])
  })

  it('新增、修改、搬動、刪除：幕、場、地點', () => {
    const h = setup()
    h.outline.edit({ op: 'addAct' })
    let view = h.outline.edit({ op: 'addAct' })
    const [a1, a2] = view.acts
    if (!a1 || !a2) throw new Error('沒有幕')

    view = h.outline.edit({
      op: 'updateAct',
      actId: a1.id,
      patch: { title: '開場', summary: '雨' },
    })
    expect(view.acts[0]).toMatchObject({ title: '開場', summary: '雨' })

    view = h.outline.edit({ op: 'addLocation' })
    const place = view.locations[0]
    if (!place) throw new Error('沒有地點')
    view = h.outline.edit({
      op: 'updateLocation',
      locationId: place.id,
      patch: { name: '海邊', description: '黃昏' },
    })
    expect(view.locations[0]).toMatchObject({ name: '海邊', description: '黃昏' })

    view = h.outline.edit({ op: 'addScene', actId: a1.id })
    const scene = view.acts[0]?.scenes[1]
    if (!scene) throw new Error('沒有場')
    view = h.outline.edit({
      op: 'updateScene',
      sceneId: scene.id,
      patch: { title: '沙灘', locationId: place.id, timeOfDay: '黃昏', mood: '平靜' },
    })
    expect(view.acts[0]?.scenes[1]).toMatchObject({
      title: '沙灘',
      locationId: place.id,
      timeOfDay: '黃昏',
      mood: '平靜',
    })

    view = h.outline.edit({ op: 'moveScene', sceneId: scene.id, direction: 'up' })
    expect(view.acts[0]?.scenes.map((s) => s.title)).toEqual(['沙灘', '新的場'])
    view = h.outline.edit({ op: 'moveAct', actId: a2.id, direction: 'up' })
    expect(view.acts.map((a) => a.id)).toEqual([a2.id, a1.id])

    view = h.outline.edit({ op: 'deleteLocation', locationId: place.id })
    expect(view.locations).toEqual([])
    expect(view.acts[1]?.scenes[0]?.locationId).toBeUndefined()
    view = h.outline.edit({ op: 'deleteScene', sceneId: scene.id })
    expect(view.acts[1]?.scenes.map((s) => s.title)).toEqual(['新的場'])
    view = h.outline.edit({ op: 'deleteAct', actId: a1.id })
    expect(view.acts.map((a) => a.id)).toEqual([a2.id])
  })

  it('沒有專案時修改回報白話錯誤；格式不對的動作被擋下', () => {
    const h = setup()
    expect(() => h.outline.edit({ op: 'deleteAct', actId: 'x' })).toThrow('還沒有開啟專案')
    expect(() => h.outline.edit({ op: 'nope' } as never)).toThrow()
  })
})

describe('OutlineService：AI 拆成分場', () => {
  it('檢查：示範模式可以拆；沒有文字模型時說明原因', () => {
    const h = setup()
    expect(h.outline.splitCheck('一個故事')).toMatchObject({
      ok: true,
      demoMode: true,
      replacesExisting: false,
    })
  })

  it('故事不是中文：提示多一句「用故事的語言寫、名字照原文」；中文故事沒有這一句', async () => {
    const systems: string[] = []
    const h = setup({
      mockLlm: (request) => {
        systems.push(request.system ?? '')
        return mockSplit(request)
      },
    })
    await h.outline.split('雨夜，阿鐵在舊街撿到一隻小貓，帶回家。')
    await h.outline.split('Mina finds a green bottle on the doorstep of her lighthouse.')
    await h.outline.split('ミナは灯台の扉の前で緑色の瓶を見つけました。')
    expect(systems).toHaveLength(3)
    expect(systems[0]).not.toContain('故事不是中文')
    expect(systems[1]).toContain('故事不是中文')
    expect(systems[2]).toContain('故事不是中文')
  })

  it('拆成幕與場、新增地點，並把角色建成草稿（已有的角色不重複建立）', async () => {
    const h = setup()
    const existing = h.characters.create('小貓')
    const result = await h.outline.split('雨夜，阿鐵在舊街撿到一隻小貓，帶回家。')

    expect(result.outline.acts.map((a) => [a.title, a.scenes.map((s) => s.title)])).toEqual([
      ['雨夜相遇', ['街角', '紙箱']],
      ['回家', ['公寓']],
    ])
    // 地點：名字對得上的場帶上地點，對不上的就沒有
    const street = result.outline.locations.find((l) => l.name === '舊街')
    expect(result.newLocations).toEqual(['舊街'])
    expect(result.outline.acts[0]?.scenes.map((s) => s.locationId)).toEqual([
      street?.id,
      street?.id,
    ])
    expect(result.outline.acts[1]?.scenes[0]?.locationId).toBeUndefined()
    expect(result.outline.acts[0]?.scenes[0]).toMatchObject({ timeOfDay: '夜', mood: '安靜' })

    // 角色：只新增沒出現過的；固定外觀描述是草稿，還沒鎖定
    expect(result.newCharacters).toEqual(['阿鐵'])
    const people = h.characters.list()
    expect(people.map((c) => c.name).sort()).toEqual(['小貓', '阿鐵'])
    const tie = people.find((c) => c.name === '阿鐵')
    expect(tie).toMatchObject({
      age: '28',
      appearance: '短黑髮',
      outfit: '深藍雨衣',
      personality: '嘴硬心軟',
      anchorText: '28 歲男性、短黑髮、深藍雨衣',
      anchorStatus: 'draft',
    })
    expect(people.find((c) => c.id === existing.id)?.anchorStatus).toBe('none')
  })

  it('已經有大綱：拆完整份換掉；地點沿用同名的、不重複建立', async () => {
    const h = setup()
    h.outline.edit({ op: 'addAct' })
    expect(h.outline.splitCheck('故事').replacesExisting).toBe(true)

    await h.outline.split('第一次')
    const again = await h.outline.split('第二次')
    expect(again.newLocations).toEqual([])
    expect(again.newCharacters).toEqual([])
    expect(again.outline.acts).toHaveLength(2)
    expect(again.outline.locations).toHaveLength(1)
    expect(h.characters.list()).toHaveLength(2)
  })

  it('花費記進帳本；已建好的角色名字會告訴 AI', async () => {
    const h = setup({ mockCostUsd: () => 0.01 })
    h.characters.create('阿鐵')
    await h.outline.split('故事')
    const handle = h.projects.current()
    if (!handle) throw new Error('沒有專案')
    expect(handle.repos.costs.totalUsd(handle.projectId)).toBeCloseTo(0.01)
    const llmJob = handle.repos.jobs.list().find((j) => j.kind === 'llm')
    expect(JSON.stringify(llmJob?.input)).toContain('已經建好的角色有：阿鐵')
  })

  it('文字是空的被擋下；AI 回傳的格式不對時保留原本的大綱', async () => {
    const h = setup({ mockLlm: () => ({ acts: [] }) })
    h.outline.edit({ op: 'addAct' })
    await expect(h.outline.split('   ')).rejects.toThrow('請先貼上')
    await expect(h.outline.split('故事')).rejects.toThrow()
    expect(h.outline.get().acts).toHaveLength(1)
    expect(h.characters.list()).toEqual([])
  })
})
