import type { LlmRequest } from '@svs/schema'
import { FAKE_OPENROUTER_KEY, startFakeOpenRouter } from '@svs/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { dataOf, startRealMcp, textOf } from './test-support'

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
  for (const c of closers.splice(0)) await c()
})

const SPLIT = {
  acts: [
    {
      title: '裂谷',
      summary: '',
      scenes: [{ title: '追逐', summary: '追種子', location: '裂谷' }],
    },
  ],
  characters: [
    { name: '小饅頭', appearance: '奶油黃圓頂', anchor: '奶油黃色圓頂史萊姆、大白眼睛、沒有嘴' },
  ],
  locations: [{ name: '裂谷', description: '黑色裂谷' }],
}
const mockLlm = (r: LlmRequest): object | undefined =>
  r.system?.includes('編劇助手') ? SPLIT : undefined

const Character = z.looseObject({
  id: z.string(),
  name: z.string(),
  anchor: z.object({ status: z.string(), text: z.string() }),
  hasHeroImage: z.boolean(),
})
const Characters = z.object({ characters: z.array(Character) })
const Waited = z.looseObject({ finished: z.boolean(), busy: z.boolean() })

async function start(options: Parameters<typeof startRealMcp>[0] = {}): Promise<Running> {
  const r = await startRealMcp({ mockLlm, ...options })
  running.push(r)
  return r
}

const imageBlocks = (result: unknown): { data: string; mimeType: string }[] =>
  ((result as { content?: { type: string; data?: string; mimeType?: string }[] }).content ?? [])
    .filter((c) => c.type === 'image')
    .map((c) => ({ data: c.data ?? '', mimeType: c.mimeType ?? '' }))

describe('角色的「不要出現的特徵」（avoid）', () => {
  it('說明講清楚用途；建立與修改都能寫、list_characters 看得到、可以清掉', async () => {
    const r = await start()
    const { tools } = await r.client.listTools()
    for (const name of ['create_character', 'update_character']) {
      const description = tools.find((t) => t.name === name)?.description ?? ''
      expect(description, name).toContain('avoid (English, comma separated')
      expect(description, name).toContain('negative prompt')
      // 提醒 Claude：同一鏡所有角色的清單會一起用，別列別的角色有的特徵
      expect(description, name).toContain('combined as written')
    }
    expect(tools.find((t) => t.name === 'list_characters')?.description).toContain('avoid')

    await r.call('create_project', { name: 'x' })
    const made = dataOf(
      Character,
      await r.call('create_character', { name: '小饅頭', avoid: 'mouth, eyebrows' }),
    )
    const readAvoid = async (): Promise<unknown> => {
      const { characters } = JSON.parse(textOf(await r.call('list_characters'))) as {
        characters: { id: string; avoid: unknown }[]
      }
      return characters.find((c) => c.id === made.id)?.avoid
    }
    expect(await readAvoid()).toBe('mouth, eyebrows')
    await r.call('update_character', { characterId: made.id, avoid: 'mouth, eyebrows, arms, legs' })
    expect(await readAvoid()).toBe('mouth, eyebrows, arms, legs')
    await r.call('update_character', { characterId: made.id, avoid: '' })
    expect(await readAvoid()).toBe('')
  })
})

describe('角色：建立、寫外觀、生成概念圖、看圖、挑主圖、鎖定（示範模式）', () => {
  it('拆故事帶出角色草稿；建立與修改；固定外觀；生成 → 等 → 看圖（真的 JPEG）→ 挑 → 鎖定', async () => {
    const { call } = await start()
    await call('create_project', { name: 'x' })
    await call('split_story_into_scenes', { story: '故事' })
    const drafts = dataOf(Characters, await call('list_characters')).characters
    expect(drafts.map((c) => c.name)).toEqual(['小饅頭'])
    const bun = drafts[0]
    if (!bun) throw new Error('沒有角色')

    const orc = dataOf(
      Character,
      await call('create_character', {
        name: '獸人',
        appearance: '綠色矮圓頂、頭上有骨頭',
        outfit: '',
      }),
    )
    expect(orc.name).toBe('獸人')
    const renamed = dataOf(
      Character,
      await call('update_character', { characterId: orc.id, personality: '外表兇、其實會幫忙' }),
    )
    expect(renamed.id).toBe(orc.id)
    const suggested = JSON.parse(
      textOf(await call('suggest_character_anchor', { characterId: bun.id })),
    ) as { suggestion: string }
    expect(typeof suggested.suggestion).toBe('string')
    const anchored = dataOf(
      Character,
      await call('set_character_anchor', {
        characterId: bun.id,
        text: '奶油黃色圓頂小史萊姆，兩顆白色大眼睛，沒有嘴、沒有手腳',
      }),
    )
    expect(anchored.anchor).toMatchObject({ status: 'draft' })

    // 生成 4 張概念圖（背景執行）→ 等 → 看
    const started = JSON.parse(
      textOf(await call('generate_character_images', { characterId: bun.id })),
    ) as { started: boolean; images: number; demoMode: boolean }
    expect(started).toMatchObject({ started: true, images: 4, demoMode: true })
    let waited = dataOf(Waited, await call('wait_for_generation', { maxSeconds: 30 }))
    for (let i = 0; i < 3 && !waited.finished; i++)
      waited = dataOf(Waited, await call('wait_for_generation', { maxSeconds: 30 }))
    expect(waited.finished).toBe(true)

    const viewed = await call('view_character_images', { characterId: bun.id })
    const images = imageBlocks(viewed)
    expect(images).toHaveLength(4)
    for (const image of images) {
      expect(image.mimeType).toBe('image/jpeg')
      const bytes = Buffer.from(image.data, 'base64')
      expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8') // JPEG 檔頭
      expect(bytes.length).toBeGreaterThan(200)
    }
    const info = JSON.parse(textOf(viewed)) as {
      imagesInOrder: { conceptId: string }[]
      generating: unknown
    }
    expect(info.imagesInOrder).toHaveLength(4)
    expect(info.generating).toBeNull()
    const conceptId = info.imagesInOrder[1]?.conceptId ?? ''

    const picked = dataOf(
      Character,
      await call('pick_character_image', { characterId: bun.id, conceptId }),
    )
    expect(picked.hasHeroImage).toBe(true)
    // 主圖也會出現在 view（第一張）
    expect(
      imageBlocks(await call('view_character_images', { characterId: bun.id, maxImages: 1 })),
    ).toHaveLength(2)
    const locked = dataOf(Character, await call('lock_character', { characterId: bun.id }))
    expect(locked.anchor.status).toBe('locked')
  })

  it('參考圖：列出專案裡的圖（不帶電腦上的路徑）→ 加成有用途的參考圖 → 下一輪照參考圖畫；不在專案裡的圖被擋下', async () => {
    const { call } = await start()
    await call('create_project', { name: 'x' })
    await call('split_story_into_scenes', { story: '故事' })
    const bun = dataOf(Characters, await call('list_characters')).characters[0]
    if (!bun) throw new Error('沒有角色')
    const waitDone = async (): Promise<void> => {
      let waited = dataOf(Waited, await call('wait_for_generation', { maxSeconds: 30 }))
      for (let i = 0; i < 3 && !waited.finished; i++)
        waited = dataOf(Waited, await call('wait_for_generation', { maxSeconds: 30 }))
      expect(waited.finished).toBe(true)
    }
    await call('generate_character_images', { characterId: bun.id })
    await waitDone()

    // 專案裡有哪些圖：只有雜湊、尺寸、用途，沒有檔案路徑
    const listed = JSON.parse(textOf(await call('list_project_images', {}))) as {
      images: Record<string, unknown>[]
      total: number
    }
    expect(listed.total).toBeGreaterThanOrEqual(4)
    for (const image of listed.images) {
      expect(Object.keys(image).sort()).toEqual(['assetHash', 'height', 'usedBy', 'width'])
    }
    expect(JSON.stringify(listed)).not.toMatch(/\.svsproj|\/Users\/|\/tmp\/|\\\\/)
    const [first, second] = listed.images.map((i) => String(i.assetHash))

    // 加成有用途的參考圖：角色清單看得到；沒標用途就是 general
    const Refs = z.object({
      references: z.array(
        z.looseObject({ referenceId: z.string(), purpose: z.string(), label: z.string() }),
      ),
    })
    const added = dataOf(
      Refs,
      await call('add_character_reference', {
        characterId: bun.id,
        assetHash: first,
        purpose: 'face',
        label: '原版設定圖',
      }),
    )
    expect(added.references).toMatchObject([{ purpose: 'face', label: '原版設定圖' }])
    const two = dataOf(
      Refs,
      await call('add_character_reference', { characterId: bun.id, assetHash: second }),
    )
    expect(two.references.map((r) => r.purpose)).toEqual(['face', 'general'])
    const after = dataOf(
      z.object({ characters: z.array(z.looseObject({ references: Refs.shape.references })) }),
      await call('list_characters'),
    )
    expect(after.characters[0]?.references).toHaveLength(2)

    // 看得到參考圖（含用途）
    const viewed = await call('view_character_images', {
      characterId: bun.id,
      includeReferences: true,
      includeHero: false,
      maxImages: 1,
    })
    expect(imageBlocks(viewed)).toHaveLength(3)
    const info = JSON.parse(textOf(viewed)) as { imagesInOrder: { purpose?: string }[] }
    expect(info.imagesInOrder.slice(0, 2).map((o) => o.purpose)).toEqual(['face', 'general'])

    // 下一輪照參考圖畫：回傳說用了幾張參考圖
    const started = JSON.parse(
      textOf(await call('generate_character_images', { characterId: bun.id })),
    ) as { started: boolean; referencePictures: number }
    expect(started).toMatchObject({ started: true, referencePictures: 2 })
    await waitDone()

    // 移除一張
    const removed = dataOf(
      Refs,
      await call('remove_character_reference', {
        characterId: bun.id,
        referenceId: String(added.references[0]?.referenceId),
      }),
    )
    expect(removed.references.map((r) => r.purpose)).toEqual(['general'])

    // 不在專案裡的圖、不存在的角色、不存在的用途：白話錯誤
    const missing = await call('add_character_reference', {
      characterId: bun.id,
      assetHash: 'f'.repeat(64),
    })
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toContain('專案裡找不到這張圖片')
    expect(textOf(missing)).not.toMatch(/undefined|\.ts:|at .*\(/)
    expect(
      (await call('add_character_reference', { characterId: 'nope', assetHash: first })).isError,
    ).toBe(true)
    expect(
      (
        await call('add_character_reference', {
          characterId: bun.id,
          assetHash: first,
          purpose: 'x',
        })
      ).isError,
    ).toBe(true)
  })

  it('看不存在的素材、不存在的角色：白話錯誤，不是例外', async () => {
    const { call } = await start()
    await call('create_project', { name: 'x' })
    const missing = await call('view_character_images', { characterId: 'nope' })
    expect(missing.isError).not.toBe(true) // 沒有概念圖就是空的清單
    const bad = await call('pick_character_image', { characterId: 'nope', conceptId: 'nope' })
    expect(bad.isError).toBe(true)
    expect(textOf(bad)).not.toMatch(/undefined|\.ts:|at .*\(/)
  })
})

describe('角色的花錢步驟（真實模式、假的 OpenRouter）', () => {
  const startReal = async () => {
    const fake = await startFakeOpenRouter()
    closers.push(() => fake.close())
    const r = await start({ demoMode: false, openrouterBaseUrl: fake.url })
    r.h.keys.set('openrouter', FAKE_OPENROUTER_KEY)
    return { r, fake }
  }

  it('額度 0：生成概念圖與請 AI 整理外觀都被擋下，白話訊息；沒有任何生成任務、沒有預留', async () => {
    const { r, fake } = await startReal()
    await r.call('create_project', { name: 'x' })
    const made = dataOf(
      Character,
      await r.call('create_character', { name: '小饅頭', appearance: '奶油黃圓頂' }),
    )
    const refusedImages = await r.call('generate_character_images', { characterId: made.id })
    expect(refusedImages.isError).toBe(true)
    expect(textOf(refusedImages)).toContain('only US$0.00 is left')
    expect(textOf(refusedImages)).toContain('設定 → AI 工具連線')
    const refusedSuggest = await r.call('suggest_character_anchor', { characterId: made.id })
    expect(refusedSuggest.isError).toBe(true)
    expect(textOf(refusedSuggest)).toContain('is left of the AI tools allowance')
    expect(fake.requests.filter((q) => q.path !== '/models')).toHaveLength(0)
    expect(r.controller.allowance.status().committedUsd).toBe(0)
    const status = JSON.parse(textOf(await r.call('get_generation_status'))) as {
      busy: boolean
      recent: unknown[]
    }
    expect(status).toMatchObject({ busy: false, recent: [] })
  })

  it('人調高額度後生成概念圖：預留的是預估 × 1.25；這些步驟的回傳與錯誤都不含金鑰', async () => {
    const { r } = await startReal()
    await r.call('create_project', { name: 'x' })
    const made = dataOf(Character, await r.call('create_character', { name: FAKE_OPENROUTER_KEY }))
    r.h.settings.update({ mcp: { allowanceUsd: 5 } })
    const out = await r.call('generate_character_images', { characterId: made.id })
    const parsed = JSON.parse(textOf(out)) as {
      spending: { estimatedUsd: number; reservedUsd: number }
    }
    expect(parsed.spending.reservedUsd).toBeCloseTo(parsed.spending.estimatedUsd * 1.25)
    expect(r.controller.allowance.status().committedUsd).toBeCloseTo(parsed.spending.reservedUsd)
    for (const result of [
      out,
      await r.call('list_characters'),
      await r.call('view_character_images', { characterId: made.id }),
      await r.call('lock_character', { characterId: made.id }),
    ]) {
      expect(textOf(result)).not.toContain(FAKE_OPENROUTER_KEY)
      expect(textOf(result)).not.toContain(r.token)
    }
  })
})
