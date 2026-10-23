import type { LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'
import { lockedAnchors } from './anchors'

// 每個測試都要跑好幾次完整生成，電腦忙的時候超過預設的 5 秒
vi.setConfig({ testTimeout: 60_000 })

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []

/** 假拆鏡：3 個鏡頭，前兩個有阿鐵出場，第三個沒有角色。 */
const breakdown = (request: LlmRequest): object | undefined =>
  request.system?.includes('分鏡助手')
    ? {
        title: '雨天的貓',
        shots: [
          { description: '阿鐵走進雨裡', size: 'wide', cameraMove: null, characters: ['阿鐵'] },
          { description: '阿鐵撿起小貓', size: 'close_up', cameraMove: null, characters: ['阿鐵'] },
          { description: '雨停了', size: 'wide', cameraMove: null, characters: [] },
        ],
      }
    : undefined

const setup = (extra: Parameters<typeof createStudioHarness>[0] = {}): Harness => {
  const harness = createStudioHarness({ mockLlm: breakdown, ...extra })
  open.push(harness)
  return harness
}
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

const DEMO_NAME = '阿鐵'

const promptsOf = (h: Harness, kind: 'image' | 'video'): string[] =>
  (h.projects.current()?.repos.jobs.list() ?? [])
    .filter((job) => job.kind === kind)
    .map((job) => (job.input as { prompt: string }).prompt)

describe('固定外觀描述 → 生成請求', () => {
  it('鎖定後，快速開始送出的圖片與影片 Prompt 都原封不動包含描述；沒鎖定的草稿不會帶入', async () => {
    const h = setup()
    const hero = h.characters.create(DEMO_NAME)
    h.characters.setAnchor(hero.id, '短黑髮、琥珀色眼睛、左臉小疤')
    await h.runQuickStart()
    // 只是草稿：沒有帶入
    expect(promptsOf(h, 'image').some((p) => p.includes('琥珀色眼睛'))).toBe(false)

    h.characters.lock(hero.id)
    await h.runQuickStart({ variation: 1 })
    for (const kind of ['image', 'video'] as const) {
      const withAnchor = promptsOf(h, kind).filter((p) =>
        p.includes('短黑髮、琥珀色眼睛、左臉小疤'),
      )
      // 第一鏡出場的角色是這位；其他鏡頭的假角色名字不同，不會被帶入
      expect(withAnchor.length).toBeGreaterThan(0)
    }
  })

  it('拆鏡時會把已建好的角色名字告訴 LLM', async () => {
    const h = setup()
    h.characters.create('小雨')
    await h.runQuickStart()
    const llmJobs = (h.projects.current()?.repos.jobs.list() ?? []).filter((j) => j.kind === 'llm')
    expect(JSON.stringify(llmJobs[0]?.input)).toContain('已經建好的角色有：小雨')
  })

  it('單一鏡頭重新生成也帶入；畫面上顯示的 Prompt 跟實際送出的一樣', async () => {
    const h = setup()
    const hero = h.characters.create(DEMO_NAME)
    h.characters.setAnchor(hero.id, '白色短毛、藍色項圈')
    h.characters.lock(hero.id)
    await h.runQuickStart()

    const first = h.shots.list().shots[0]
    if (!first) throw new Error('沒有鏡頭')
    expect(first.autoPrompt).toContain('白色短毛、藍色項圈')
    await h.shots.regenerate(first.id, 'all')
    await h.idle(first.id)
    expect(promptsOf(h, 'video')).toContain(first.autoPrompt)
  })

  it('描述改了、重新鎖定 → 新的內容生效，舊內容不再出現在新的請求裡', async () => {
    const h = setup()
    const hero = h.characters.create(DEMO_NAME)
    h.characters.setAnchor(hero.id, '短黑髮')
    h.characters.lock(hero.id)
    await h.runQuickStart()
    const before = promptsOf(h, 'image').length

    h.characters.setAnchor(hero.id, '銀色長髮')
    h.characters.lock(hero.id)
    await h.runQuickStart()
    const added = promptsOf(h, 'image').slice(before)
    expect(added.some((p) => p.includes('銀色長髮'))).toBe(true)
    expect(added.some((p) => p.includes('短黑髮'))).toBe(false)
  })

  it('lockedAnchors 只列出已鎖定、描述不是空的角色', () => {
    const h = setup()
    const a = h.characters.create('甲')
    const b = h.characters.create('乙')
    h.characters.create('丙')
    h.characters.setAnchor(a.id, '短髮')
    h.characters.lock(a.id)
    h.characters.setAnchor(b.id, '長髮')
    const handle = h.projects.current()
    if (!handle) throw new Error('沒有專案')
    expect(lockedAnchors(handle)).toEqual([{ name: '甲', text: '短髮', version: 1 }])
  })
})

/** 建好角色、挑主圖、採用三視圖並鎖定。 */
async function lockedWithImages(h: Harness): Promise<{ hero: string; front: string }> {
  const created = h.characters.create(DEMO_NAME)
  h.characters.update(created.id, { appearance: '短黑髮', outfit: '深藍工作服' })
  h.concepts.generate(created.id)
  await vi.waitFor(
    () => {
      expect(h.concepts.state(created.id).concepts).toHaveLength(4)
      expect(h.concepts.state(created.id).generating).toBeUndefined()
    },
    { timeout: 30_000, interval: 20 },
  )
  const concept = h.concepts.state(created.id).concepts[0]
  if (!concept) throw new Error('沒有概念圖')
  h.characters.pickHero(created.id, concept.id)
  h.turnarounds.generate(created.id)
  await vi.waitFor(
    () => {
      expect(h.turnarounds.state(created.id).turnarounds).toHaveLength(4)
      expect(h.turnarounds.state(created.id).generating).toBeUndefined()
    },
    { timeout: 30_000, interval: 20 },
  )
  const sheet = h.turnarounds.state(created.id).turnarounds[0]
  if (!sheet) throw new Error('沒有三視圖')
  h.characters.adoptTurnaround(created.id, sheet.id)
  h.characters.setAnchor(created.id, '短黑髮、深藍工作服')
  h.characters.lock(created.id)
  return { hero: concept.assetHash, front: sheet.frontHash }
}

describe('已鎖定角色 → 自動挑參考圖', () => {
  const imageInputs = (h: Harness) =>
    (h.projects.current()?.repos.jobs.list() ?? [])
      .map(
        (job) => job.input as { capability?: string; prompt?: string; referenceAssets?: string[] },
      )
      .filter((input) => input.capability === 'edit' || input.capability === 't2i')

  it('出場的鏡頭改用圖片編輯並帶參考圖（一般鏡頭主圖＋正面、近景只有主圖）；沒角色的鏡頭照舊文生圖', async () => {
    const h = setup()
    const { hero, front } = await lockedWithImages(h)
    const before = imageInputs(h).length
    await h.runQuickStart()
    const added = imageInputs(h).slice(before)

    const walk = added.find((i) => i.prompt?.includes('阿鐵走進雨裡'))
    const grab = added.find((i) => i.prompt?.includes('阿鐵撿起小貓'))
    const empty = added.find((i) => i.prompt?.includes('雨停了'))
    expect(walk).toMatchObject({ capability: 'edit', referenceAssets: [hero, front] })
    expect(grab).toMatchObject({ capability: 'edit', referenceAssets: [hero] })
    expect(empty).toMatchObject({ capability: 't2i', referenceAssets: [] })

    // 鏡頭卡片上標出用了哪個角色的哪一版
    const shots = h.shots.list().shots
    expect(shots[0]?.lockedCharacters).toEqual([{ name: DEMO_NAME, version: 1 }])
    expect(shots[2]?.lockedCharacters).toBeUndefined()
  })

  it('單一鏡頭重新生成同樣帶參考圖；角色只是草稿時完全不帶', async () => {
    const h = setup()
    const { hero } = await lockedWithImages(h)
    await h.runQuickStart()
    const first = h.shots.list().shots[0]
    if (!first) throw new Error('沒有鏡頭')
    const count = () =>
      imageInputs(h).filter((i) => i.prompt?.includes('阿鐵走進雨裡') && i.capability === 'edit')
        .length
    const beforeRegen = count()
    await h.shots.regenerate(first.id, 'all')
    await h.idle(first.id)
    expect(count()).toBe(beforeRegen + 1)

    // 改了長相 → 退回草稿 → 不再帶任何參考圖
    const [character] = h.characters.list()
    if (!character) throw new Error('沒有角色')
    h.characters.update(character.id, { appearance: '平頭' })
    const before = imageInputs(h).length
    await h.runQuickStart({ variation: 1 })
    const added = imageInputs(h).slice(before)
    expect(added.every((i) => i.capability === 't2i')).toBe(true)
    expect(added.some((i) => i.referenceAssets?.includes(hero))).toBe(false)
  })
})

describe('尾幀：用首幀改圖時帶出場角色的主圖', () => {
  it('參考圖依序是首幀、出場且已鎖定角色的主圖（check 與實際送出的一樣）；沒出場的鏡頭只有首幀；角色只是草稿不帶', async () => {
    const h = setup()
    const { hero } = await lockedWithImages(h)
    await h.runQuickStart()
    const [withHero, without] = h.shots.list().shots
    const [third] = h.shots.list().shots.slice(2)
    if (!withHero || !without || !third) throw new Error('鏡頭不夠')
    const edits = () =>
      (h.projects.current()?.repos.jobs.list() ?? [])
        .map(
          (job) =>
            job.input as { capability?: string; prompt?: string; referenceAssets?: string[] },
        )
        .filter(
          (input) =>
            input.capability === 'edit' && input.prompt?.includes('Image 1 is the current picture'),
        )

    h.shots.update(withHero.id, { endDescription: 'the hero walks off to the right' })
    h.shots.update(third.id, { endDescription: 'the rain has stopped' })
    expect(h.shots.endFrameCheck(withHero.id).references).toEqual(['first frame', DEMO_NAME])
    expect(h.shots.endFrameCheck(third.id).references).toEqual(['first frame'])

    await h.shots.generateEndFrame(withHero.id)
    await h.idle(withHero.id)
    await h.shots.generateEndFrame(third.id)
    await h.idle(third.id)
    const [one, two] = edits()
    expect(one?.referenceAssets).toEqual([withHero.firstFrames[0]?.assetHash, hero])
    expect(one?.prompt).toContain(`Image 2 is the design sheet of "${DEMO_NAME}"`)
    expect(two?.referenceAssets).toEqual([third.firstFrames[0]?.assetHash])

    // 改了長相 → 退回草稿 → 只帶首幀
    const [character] = h.characters.list()
    if (!character) throw new Error('沒有角色')
    h.characters.update(character.id, { appearance: '平頭' })
    expect(h.shots.endFrameCheck(withHero.id).references).toEqual(['first frame'])
  })
})

describe('CharacterService：固定外觀描述', () => {
  it('畫面用的資料有描述、狀態與版本；改長相後退回草稿', () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    expect(hero).toMatchObject({ anchorText: '', anchorStatus: 'none', version: 0 })

    expect(h.characters.setAnchor(hero.id, '短黑髮')).toMatchObject({
      anchorText: '短黑髮',
      anchorStatus: 'draft',
      version: 1,
    })
    expect(h.characters.lock(hero.id)).toMatchObject({ anchorStatus: 'locked', version: 1 })
    expect(h.characters.update(hero.id, { appearance: '剪成平頭' })).toMatchObject({
      anchorText: '短黑髮',
      anchorStatus: 'draft',
      version: 2,
    })
    expect(h.characters.list()[0]).toMatchObject({ anchorStatus: 'draft', version: 2 })
  })

  it('空的描述不能鎖定，錯誤訊息是白話', () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    expect(() => h.characters.lock(hero.id)).toThrow('還沒有固定外觀描述')
  })

  it('AI 整理：把長相與服裝交給文字模型，回傳建議（不會自動存起來）', async () => {
    const h = setup({ mockCostUsd: () => 0.002 })
    const hero = h.characters.create('阿鐵')
    h.characters.update(hero.id, { appearance: '短黑髮、琥珀色眼睛', outfit: '深藍工作服' })

    const text = await h.characters.suggestAnchor(hero.id)
    expect(text.length).toBeGreaterThan(0)
    expect(h.characters.list()[0]?.anchorStatus).toBe('none')

    const llm = (h.projects.current()?.repos.jobs.list() ?? []).find((j) => j.kind === 'llm')
    const input = JSON.stringify(llm?.input)
    expect(input).toContain('短黑髮、琥珀色眼睛')
    expect(input).toContain('深藍工作服')
    expect(input).toContain('固定外觀描述')

    // 花費有記進帳本
    const handle = h.projects.current()
    const ledger = handle ? handle.repos.costs.list(handle.projectId) : []
    expect(ledger.filter((entry) => entry.modelId === 'mock/llm')).toMatchObject([
      { amountUsd: 0.002, estimated: false },
    ])
  })

  it('長相和服裝都沒寫時，請使用者先寫', async () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    await expect(h.characters.suggestAnchor(hero.id)).rejects.toThrow('請先寫一點長相或服裝')
  })
})
