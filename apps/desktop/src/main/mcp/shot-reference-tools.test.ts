import type { LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { dataOf, startRealMcp, textOf } from './test-support'

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
})

const SPLIT = {
  acts: [
    { title: '裂谷', summary: '', scenes: [{ title: '追逐', summary: '', location: '裂谷' }] },
  ],
  characters: [{ name: '小饅頭', appearance: '奶油黃圓頂', anchor: '奶油黃色圓頂史萊姆' }],
  locations: [{ name: '裂谷', description: '黑色裂谷' }],
}
const mockLlm = (r: LlmRequest): object | undefined =>
  r.system?.includes('編劇助手') ? SPLIT : undefined

const Item = z.object({
  assetHash: z.string(),
  ownerKind: z.enum(['character', 'location']),
  ownerName: z.string(),
  purpose: z.string(),
  label: z.string(),
})
const State = z.looseObject({
  mode: z.enum(['auto', 'pinned']),
  limit: z.number(),
  picked: z.array(Item),
  candidates: z.array(Item).optional(),
})
const Character = z.looseObject({ id: z.string(), name: z.string() })
const Shots = z.object({ shots: z.array(z.looseObject({ id: z.string() })) })
const Waited = z.looseObject({ finished: z.boolean() })

describe('鏡頭的參考圖：get_shot_references／set_shot_references（示範模式）', () => {
  it('看得到會帶哪些圖和可以挑哪些；指定後只帶指定的；挑不在清單裡的會說明；空陣列回到自動', async () => {
    const r = await startRealMcp({ mockLlm })
    running.push(r)
    const { call } = r
    await call('create_project', { name: 'x' })
    await call('split_story_into_scenes', { story: '故事' })
    const bun = z
      .object({ characters: z.array(Character) })
      .parse(JSON.parse(textOf(await call('list_characters')))).characters[0]
    if (!bun) throw new Error('沒有角色')
    // 生成概念圖、挑主圖、鎖定
    await call('generate_character_images', { characterId: bun.id })
    let waited = dataOf(Waited, await call('wait_for_generation', { maxSeconds: 30 }))
    for (let i = 0; i < 3 && !waited.finished; i++)
      waited = dataOf(Waited, await call('wait_for_generation', { maxSeconds: 30 }))
    const viewed = JSON.parse(
      textOf(await call('view_character_images', { characterId: bun.id })),
    ) as {
      imagesInOrder: { conceptId: string }[]
    }
    await call('pick_character_image', {
      characterId: bun.id,
      conceptId: viewed.imagesInOrder[0]?.conceptId ?? '',
    })
    await call('lock_character', { characterId: bun.id })

    await call('create_shot', {})
    const [shot] = dataOf(Shots, await call('list_shots')).shots
    if (!shot) throw new Error('沒有鏡頭')
    await call('update_shot', { shotId: shot.id, characters: ['小饅頭'] })

    const before = dataOf(State, await call('get_shot_references', { shotId: shot.id }))
    expect(before.mode).toBe('auto')
    expect(before.limit).toBeGreaterThan(0)
    const hero = before.candidates?.find((c) => c.ownerName === '小饅頭' && c.purpose === '主圖')
    if (!hero) throw new Error('清單裡沒有小饅頭的主圖')
    expect(before.picked.map((c) => c.assetHash)).toEqual([hero.assetHash])

    const pinned = dataOf(
      State,
      await call('set_shot_references', { shotId: shot.id, assetHashes: [hero.assetHash] }),
    )
    expect(pinned.mode).toBe('pinned')
    expect(pinned.picked.map((c) => c.assetHash)).toEqual([hero.assetHash])

    const bad = await call('set_shot_references', {
      shotId: shot.id,
      assetHashes: ['f'.repeat(64)],
    })
    expect(bad.isError).toBe(true)
    expect(textOf(bad)).toContain('不在這一鏡可以挑的參考圖裡')

    const reset = dataOf(
      State,
      await call('set_shot_references', { shotId: shot.id, assetHashes: [] }),
    )
    expect(reset.mode).toBe('auto')
    // 不認得的鏡頭：白話說明
    const missing = await call('get_shot_references', { shotId: 'nope' })
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toContain('找不到這個鏡頭')
  })
})
