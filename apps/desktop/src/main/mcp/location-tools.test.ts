import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { dataOf, startRealMcp, textOf } from './test-support'

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
})

async function start(): Promise<Running> {
  const r = await startRealMcp()
  running.push(r)
  return r
}

const Location = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  anchor: z.object({ status: z.string(), text: z.string() }),
  hasMainPicture: z.boolean(),
  otherAngles: z.object({ reverse: z.boolean(), wide: z.boolean() }),
})
const Locations = z.object({ locations: z.array(Location) })
const Waited = z.looseObject({ finished: z.boolean(), busy: z.boolean() })
const Viewed = z.looseObject({
  generating: z.unknown(),
  imagesInOrder: z.array(z.looseObject({})),
})

const imageBlocks = (result: unknown): { data: string; mimeType: string }[] =>
  ((result as { content?: { type: string; data?: string; mimeType?: string }[] }).content ?? [])
    .filter((c) => c.type === 'image')
    .map((c) => ({ data: c.data ?? '', mimeType: c.mimeType ?? '' }))

const PLACES = [
  { name: '斷橋', anchor: '一座爬滿黑藤的舊石橋，橋面潮濕，只有一盞燈，沒有人' },
  { name: '河對岸', anchor: '霧很重的河岸，蘆葦與碎石灘，遠處有微弱的燈火，沒有人' },
  { name: '守燈人的屋子', anchor: '小木屋內部，一張舊桌子與一盞油燈，牆上有裂縫，沒有人' },
]

async function waitDone(r: Running): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const waited = dataOf(Waited, await r.call('wait_for_generation', { maxSeconds: 30 }))
    if (waited.finished) return
  }
  throw new Error('生成一直沒結束')
}

describe('場景卡工具（示範模式）', () => {
  it('替三個地點建場景卡並鎖定：建立 → 概念圖 → 看 → 挑主圖 → 鎖定；清單看得到三張、都已鎖定', async () => {
    const r = await start()
    await r.call('create_project', { name: '場景卡' })
    expect(dataOf(Locations, await r.call('list_locations')).locations).toEqual([])

    for (const place of PLACES) {
      const made = dataOf(
        Location,
        await r.call('create_location', {
          name: place.name,
          description: `故事裡的${place.name}`,
          anchor: place.anchor,
        }),
      )
      expect(made).toMatchObject({
        name: place.name,
        description: `故事裡的${place.name}`,
        anchor: { status: 'draft', text: place.anchor },
        hasMainPicture: false,
      })

      const started = JSON.parse(
        textOf(await r.call('generate_location_images', { locationId: made.id })),
      ) as { started: boolean; kind: string; images: number; demoMode: boolean }
      expect(started).toMatchObject({ started: true, kind: 'concepts', images: 4, demoMode: true })
      await waitDone(r)

      const viewed = await r.call('view_location_images', { locationId: made.id })
      const images = imageBlocks(viewed)
      expect(images).toHaveLength(4)
      for (const image of images) {
        expect(image.mimeType).toBe('image/jpeg')
        expect(Buffer.from(image.data, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8')
      }
      const info = dataOf(Viewed, viewed)
      expect(info.generating).toBeNull()
      const conceptId = (info.imagesInOrder[1] as { conceptId: string }).conceptId

      const picked = dataOf(
        Location,
        await r.call('pick_location_image', { locationId: made.id, conceptId }),
      )
      expect(picked.hasMainPicture).toBe(true)
      const locked = dataOf(Location, await r.call('lock_location', { locationId: made.id }))
      expect(locked.anchor.status).toBe('locked')
    }

    const listed = dataOf(Locations, await r.call('list_locations')).locations
    expect(listed.map((l) => l.name)).toEqual(PLACES.map((p) => p.name))
    expect(listed.every((l) => l.anchor.status === 'locked' && l.hasMainPicture)).toBe(true)
    // 大綱裡也有這三個地點（場景卡就是地點的視覺設定）
    const outline = JSON.parse(textOf(await r.call('get_outline'))) as {
      locations: { name: string }[]
    }
    expect(outline.locations.map((l) => l.name)).toEqual(PLACES.map((p) => p.name))
  }, 120_000)

  it('改名字、說明與固定描述；已鎖定的不能改，白話說明怎麼辦；沒傳任何欄位被擋下', async () => {
    const r = await start()
    await r.call('create_project', { name: 'x' })
    const made = dataOf(Location, await r.call('create_location', { name: '斷橋' }))
    expect(made.anchor).toEqual({ status: 'none', text: '' })
    // 鎖定要有固定描述（主圖不是必要的）：還沒寫就先說清楚少什麼
    const noText = await r.call('lock_location', { locationId: made.id })
    expect((noText as { isError?: boolean }).isError).toBe(true)

    const renamed = dataOf(
      Location,
      await r.call('update_location', {
        locationId: made.id,
        name: '黑藤斷橋',
        description: '她守燈的地方',
        anchor: '爬滿黑藤的舊石橋，沒有人',
      }),
    )
    expect(renamed).toMatchObject({
      name: '黑藤斷橋',
      description: '她守燈的地方',
      anchor: { status: 'draft', text: '爬滿黑藤的舊石橋，沒有人' },
    })

    const nothing = await r.call('update_location', { locationId: made.id })
    expect(textOf(nothing)).toContain('at least one')

    await r.call('generate_location_images', { locationId: made.id })
    await waitDone(r)
    const info = dataOf(Viewed, await r.call('view_location_images', { locationId: made.id }))
    const conceptId = (info.imagesInOrder[0] as { conceptId: string }).conceptId
    await r.call('pick_location_image', { locationId: made.id, conceptId })
    await r.call('lock_location', { locationId: made.id })

    const refused = await r.call('update_location', { locationId: made.id, name: '改名' })
    expect((refused as { isError?: boolean }).isError).toBe(true)
    expect(textOf(refused)).toContain('鎖定')
    const refusedGenerate = await r.call('generate_location_images', { locationId: made.id })
    expect((refusedGenerate as { isError?: boolean }).isError).toBe(true)
    // 名字沒被改
    expect(dataOf(Locations, await r.call('list_locations')).locations[0]?.name).toBe('黑藤斷橋')
  }, 60_000)

  it('另外兩個角度：沒挑主圖不能生；挑了主圖之後生出反方向與拉遠全景，看得到', async () => {
    const r = await start()
    await r.call('create_project', { name: 'x' })
    const made = dataOf(
      Location,
      await r.call('create_location', { name: '河對岸', anchor: '霧很重的河岸，沒有人' }),
    )
    const early = await r.call('generate_location_images', { locationId: made.id, kind: 'angles' })
    expect((early as { isError?: boolean }).isError).toBe(true)
    expect(textOf(early)).toContain('主場景圖')

    await r.call('generate_location_images', { locationId: made.id })
    await waitDone(r)
    const info = dataOf(Viewed, await r.call('view_location_images', { locationId: made.id }))
    await r.call('pick_location_image', {
      locationId: made.id,
      conceptId: (info.imagesInOrder[0] as { conceptId: string }).conceptId,
    })
    const started = JSON.parse(
      textOf(await r.call('generate_location_images', { locationId: made.id, kind: 'angles' })),
    ) as { kind: string; images: number }
    expect(started).toMatchObject({ kind: 'angles', images: 2 })
    await waitDone(r)
    const card = dataOf(Locations, await r.call('list_locations')).locations[0]
    expect(card?.otherAngles).toEqual({ reverse: true, wide: true })
    // 看圖：主圖 ＋ 兩個角度 ＋ 概念圖
    const viewed = await r.call('view_location_images', { locationId: made.id, maxImages: 2 })
    expect(imageBlocks(viewed)).toHaveLength(1 + 2 + 2)
  }, 90_000)

  it('建立是一步復原；找不到的場景卡說白話', async () => {
    const r = await start()
    await r.call('create_project', { name: 'x' })
    await r.call('create_location', { name: '斷橋' })
    expect(dataOf(Locations, await r.call('list_locations')).locations).toHaveLength(1)
    await r.call('undo')
    expect(dataOf(Locations, await r.call('list_locations')).locations).toHaveLength(0)

    for (const [name, input] of [
      ['lock_location', { locationId: 'nope' }],
      ['pick_location_image', { locationId: 'nope', conceptId: 'nope' }],
      ['update_location', { locationId: 'nope', name: 'x' }],
    ] as const) {
      const out = await r.call(name, input)
      expect((out as { isError?: boolean }).isError, name).toBe(true)
      expect(textOf(out), name).not.toContain('SqliteError')
    }
  }, 60_000)
})
