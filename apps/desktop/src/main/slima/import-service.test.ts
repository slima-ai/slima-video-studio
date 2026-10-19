import { createRequire } from 'node:module'
import { join } from 'node:path'

import type { LlmRequest } from '@svs/schema'
import { FAKE_SLIMA_TOKEN } from '@svs/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryVault } from '../keys/key-vault'
import { createStudioHarness } from '../shots/test-harness'
import { createSlimaImportService, IMPORT_ACT_TITLE } from './import-service'
import { createSlimaService, type SlimaService } from './slima-service'

// 每個測試都會真的啟動一個假 slima-mcp 子行程
vi.setConfig({ testTimeout: 60_000 })

const FAKE_SERVER = createRequire(import.meta.url).resolve('@svs/test-utils/fake-slima-server')

const SPLIT = {
  acts: [
    {
      title: '雨夜',
      summary: '阿鐵撿到貓',
      scenes: [{ title: '街角', summary: '下雨', location: '舊街' }],
    },
  ],
  characters: [{ name: '阿鐵', appearance: '短黑髮', anchor: '短黑髮、深藍雨衣' }],
  locations: [{ name: '舊街', description: '濕漉漉的石板路' }],
}
const mockSplit = (request: LlmRequest): object | undefined =>
  request.system?.includes('編劇助手') ? SPLIT : undefined

type Harness = ReturnType<typeof createStudioHarness>
const harnesses: Harness[] = []
const services: SlimaService[] = []
afterEach(async () => {
  for (const s of services.splice(0)) await s.stop()
  for (const h of harnesses.splice(0)) h.cleanup()
})

async function setup(connect = true) {
  const harness = createStudioHarness({ mockLlm: mockSplit })
  harnesses.push(harness)
  const slima = createSlimaService({
    keys: new MemoryVault(),
    broadcast: () => undefined,
    log: { info: vi.fn(), warn: vi.fn() },
    launch: (token) => ({
      command: process.execPath,
      args: [FAKE_SERVER],
      env: { SLIMA_API_TOKEN: token },
    }),
  })
  services.push(slima)
  if (connect) await slima.connect(FAKE_SLIMA_TOKEN)
  const service = createSlimaImportService({
    reader: slima.reader,
    projects: harness.projects,
    projectsDir: join(harness.root, 'projects'),
    outline: harness.outline,
    demoMode: () => true,
  })
  return { h: harness, service, slima }
}

describe('SlimaImportService.tree', () => {
  it('小說：列出可匯入的檔案與預設用途；圖片不列出', async () => {
    const { service } = await setup()
    const tree = await service.tree('bk_novel1')
    expect(tree.book).toMatchObject({ token: 'bk_novel1', title: '雨夜的貓', kind: 'writing' })
    expect(tree.files.map((f) => [f.path, f.suggestedUse])).toEqual([
      ['chapter-01.md', 'story'],
      ['chapter-02.md', 'story'],
      ['characters/阿鐵.md', 'character'],
      ['world/舊倉庫.md', 'location'],
    ])
  })

  it('劇本：角色、地點、場的結構化檔案；series.json 不列出', async () => {
    const { service } = await setup()
    const tree = await service.tree('bk_script1')
    expect(tree.book.kind).toBe('script')
    expect(tree.files.map((f) => f.suggestedUse)).toEqual([
      'character',
      'character',
      'location',
      'scene',
    ])
    expect(tree.files[0]?.path).toBe('.script_studio/characters/hero.character')
  })

  it('沒有連線時說明要先連線', async () => {
    const { service } = await setup(false)
    await expect(service.tree('bk_novel1')).rejects.toMatchObject({ code: 'slima_unavailable' })
  })
})

describe('SlimaImportService：小說', () => {
  const items = [
    { path: 'chapter-01.md', use: 'story' as const },
    { path: 'chapter-02.md', use: 'story' as const },
    { path: 'characters/阿鐵.md', use: 'character' as const },
    { path: 'world/舊倉庫.md', use: 'location' as const },
  ]

  it('檢查：章節要拆成分場（示範模式不花錢），列出會建立的角色與地點', async () => {
    const { service } = await setup()
    const check = await service.check({ bookToken: 'bk_novel1', items })
    expect(check).toMatchObject({
      ok: true,
      storyFiles: 2,
      characters: ['阿鐵'],
      locations: ['舊倉庫'],
      scenes: [],
      replacesOutline: false,
      demoMode: true,
    })
    expect(check.storyChars).toBeGreaterThan(20)
  })

  it('匯入：章節拆成大綱；同名的角色不重複建立；地點存成場景卡描述；每個檔案都記下來源', async () => {
    const { h, service } = await setup()
    const result = await service.import({ bookToken: 'bk_novel1', items })
    expect(result.actsFromStory).toBe(1)
    // 拆大綱時 AI 已經建了「阿鐵」，所以檔案裡的阿鐵略過
    expect(result.characters).toEqual([])
    expect(result.skipped).toEqual([
      { path: 'characters/阿鐵.md', reason: '已經有同名的角色「阿鐵」' },
    ])
    expect(result.locations).toEqual(['舊倉庫'])

    const outline = h.outline.get()
    expect(outline.acts.map((a) => a.title)).toEqual(['雨夜'])
    const place = outline.locations.find((l) => l.name === '舊倉庫')
    expect(place?.description).toContain('潮濕的磚牆倉庫')
    expect(h.projects.current()?.repos.locationCards.get(place?.id ?? '')?.anchorText).toContain(
      '潮濕的磚牆倉庫',
    )

    const links = h.projects.current()?.repos.slimaLinks.list() ?? []
    expect(links.map((l) => [l.entityType, l.path]).sort()).toEqual(
      [
        ['location', 'world/舊倉庫.md'],
        ['outline', 'chapter-01.md'],
        ['outline', 'chapter-02.md'],
      ].sort(),
    )
    expect(links.every((l) => l.bookToken === 'bk_novel1' && l.remoteVersion?.length === 16)).toBe(
      true,
    )
  })

  it('已經有大綱時，檢查會提醒「拆成分場會換掉」', async () => {
    const { h, service } = await setup()
    h.outline.edit({ op: 'addAct' })
    const check = await service.check({ bookToken: 'bk_novel1', items: items.slice(0, 1) })
    expect(check.replacesOutline).toBe(true)
  })
})

describe('SlimaImportService：劇本', () => {
  const items = [
    { path: '.script_studio/characters/hero.character', use: 'character' as const },
    { path: '.script_studio/characters/tin.character', use: 'character' as const },
    { path: '.script_studio/locations/yard.location', use: 'location' as const },
    { path: '.script_studio/seasons/s1/scenes/scene-01.scene', use: 'scene' as const },
  ]

  it('匯入：角色卡（描述放外觀）、地點、場（放在「從 Slima 匯入」那一幕）', async () => {
    const { h, service } = await setup()
    const result = await service.import({ bookToken: 'bk_script1', items })
    expect(result).toEqual({
      actsFromStory: 0,
      characters: ['小花', '阿鐵'],
      locations: ['廢料場'],
      scenes: ['雨中相遇'],
      skipped: [],
    })
    expect(h.characters.list().map((c) => [c.name, c.appearance])).toEqual([
      ['小花', '紮馬尾的少女，愛笑'],
      ['阿鐵', '沉默的修理工'],
    ])
    const outline = h.outline.get()
    expect(outline.acts.map((a) => [a.title, a.scenes.map((s) => s.title)])).toEqual([
      [IMPORT_ACT_TITLE, ['雨中相遇']],
    ])
    expect(outline.acts[0]?.scenes[0]?.summary).toBe('小花在廢料場遇見阿鐵。')
    expect(outline.locations.map((l) => l.name)).toEqual(['廢料場'])
    expect(h.projects.current()?.repos.slimaLinks.list()).toHaveLength(4)
  })

  it('再匯入一次：同名的全部略過，說明原因；沒有新東西時不能匯入', async () => {
    const { h, service } = await setup()
    await service.import({ bookToken: 'bk_script1', items })
    const check = await service.check({ bookToken: 'bk_script1', items })
    expect(check.ok).toBe(false)
    expect(check.issue).toBe('沒有可以匯入的內容。')
    expect(check.skipped.map((s) => s.reason)).toEqual([
      '已經有同名的角色「小花」',
      '已經有同名的角色「阿鐵」',
      '已經有同名的地點「廢料場」',
      '已經有同名的場「雨中相遇」',
    ])
    await expect(service.import({ bookToken: 'bk_script1', items })).rejects.toMatchObject({
      code: 'invalid_request',
    })
    expect(h.characters.list()).toHaveLength(2)
  })
})

describe('SlimaImportService：邊界', () => {
  it('沒選檔案、檔案不存在：說明原因而不是整批失敗', async () => {
    const { service } = await setup()
    await expect(service.check({ bookToken: 'bk_novel1', items: [] })).rejects.toMatchObject({
      code: 'invalid_request',
    })
    const check = await service.check({
      bookToken: 'bk_novel1',
      items: [
        { path: 'nope.md', use: 'story' },
        { path: 'characters/阿鐵.md', use: 'character' },
      ],
    })
    expect(check.ok).toBe(true)
    expect(check.skipped).toEqual([{ path: 'nope.md', reason: '讀不到這個檔案' }])
    expect(check.characters).toEqual(['阿鐵'])
  })

  it('選的文字超過拆大綱的上限：擋下並說明', async () => {
    const harness = createStudioHarness({ mockLlm: mockSplit })
    harnesses.push(harness)
    const service = createSlimaImportService({
      reader: {
        getBook: () => Promise.resolve({ token: 'b', title: '長篇', kind: 'writing', words: 1 }),
        listFiles: () => Promise.resolve([]),
        readFile: (_book, path) =>
          Promise.resolve({ name: path, path, words: 1, content: '很長的內容'.repeat(20_000) }),
      },
      projects: harness.projects,
      projectsDir: join(harness.root, 'projects'),
      outline: harness.outline,
      demoMode: () => true,
    })
    const check = await service.check({ bookToken: 'b', items: [{ path: 'a.md', use: 'story' }] })
    expect(check.ok).toBe(false)
    expect(check.issue).toContain('太長')
    await expect(
      service.import({ bookToken: 'b', items: [{ path: 'a.md', use: 'story' }] }),
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })
})
