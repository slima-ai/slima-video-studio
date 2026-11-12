import { demoTrailerScript } from '@svs/providers'
import type { LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness, type HarnessOptions } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})
const setup = (options: HarnessOptions = {}) => {
  const h = createStudioHarness(options)
  harnesses.push(h)
  return h
}

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

/** 假模型：第一次回 first、之後回 next（沒給 next 就一直回 first）。 */
const scripted = (first: () => unknown, next?: () => unknown) => {
  const calls: LlmRequest[] = []
  const llm = (request: LlmRequest): string | object | undefined => {
    if (!request.messages.some((m) => m.content.includes('請寫預告片腳本'))) return undefined
    calls.push(request)
    return (calls.length === 1 || next === undefined ? first : next)() as object
  }
  return { llm, calls }
}

/** 示範模式的正確腳本。 */
const good =
  (sec = 30, kind: 'story' | 'teaser' = 'story') =>
  () =>
    demoTrailerScript({
      capability: 'llm',
      modelId: 'mock/llm',
      messages: [
        {
          role: 'user',
          content: `故事：\n${STORY}\n\n請寫預告片腳本。類型：${kind}。目標總長：${String(sec)} 秒。旁白：開。`,
        },
      ],
    })

interface Script {
  title: string
  music: string
  beats: Record<string, unknown>[]
}
const withBeats =
  (edit: (script: Script) => void, sec = 30) =>
  () => {
    const script = good(sec)() as Script
    edit(script)
    return script
  }

const shotsOf = (h: ReturnType<typeof setup>) => h.shots.list().shots

describe('trailer.plan：示範模式（假腳本）', () => {
  it('預設 30 秒、劇情型：建預告片設定、一個「預告片」場與底下的鏡頭；腳本加總 30.0／目標 30', async () => {
    const h = setup()
    const result = await h.trailer.plan({ text: STORY })
    expect(result.exists).toBe(true)
    expect(result.settings).toMatchObject({ kind: 'story', targetSec: 30, narration: true })
    expect(result.settings.musicBrief).not.toBe('')
    expect(result.targetSec).toBe(30)
    expect(result.scriptSec).toBeCloseTo(30, 6)
    expect(result.matches).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.retried).toBe(false)
    const scenes = h.outline.get().acts.flatMap((a) => a.scenes)
    expect(scenes.map((s) => s.title)).toEqual(['預告片'])
    expect(shotsOf(h).every((s) => s.sceneId === scenes[0]?.id)).toBe(true)
    const shots = h.shots.list().shots
    expect(shots.length).toBe(result.beatCount)
    expect(['video', 'still']).toContain(shots[0]?.beatKind ?? 'video')
    expect(shots.at(-1)?.beatKind).toBe('title')
    expect(shots.some((s) => s.beatKind === 'card' && (s.card?.text ?? '') !== '')).toBe(true)
    expect(shots.reduce((sum, s) => sum + s.durationSec, 0)).toBeCloseTo(30, 6)
    // 書名：使用者沒給，取文本
    expect(result.settings.title).not.toBe('')
  })

  for (const [sec, kind] of [
    [15, 'teaser'],
    [30, 'story'],
    [60, 'story'],
  ] as const) {
    it(`${kind}、${String(sec)} 秒：加總相差 0、有片名卡、第一格不是字卡`, async () => {
      const h = setup()
      const result = await h.trailer.plan({ text: STORY, kind, targetSec: sec })
      expect(result.scriptSec).toBeCloseTo(sec, 6)
      expect(result.matches).toBe(true)
      const shots = h.shots.list().shots
      expect(shots.some((s) => s.beatKind === 'title')).toBe(true)
      expect(shots[0]?.beatKind).not.toBe('card')
    })
  }

  it('再寫一次是「取代」：同一個場、鏡頭換成新的；專案裡其他鏡頭不動', async () => {
    const h = setup()
    const other = h.shots.create({})
    await h.trailer.plan({ text: STORY })
    const sceneId = h.trailer.get().settings.sceneId
    const firstCount = h.shots.list().shots.length
    await h.trailer.plan({ text: STORY, targetSec: 20 })
    expect(h.trailer.get().settings.sceneId).toBe(sceneId)
    expect(
      h.outline
        .get()
        .acts.flatMap((a) => a.scenes)
        .filter((x) => x.title === '預告片'),
    ).toHaveLength(1)
    const shots = h.shots.list().shots
    expect(shots.some((s) => s.id === other.id)).toBe(true)
    expect(
      shots.filter((s) => s.id !== other.id).reduce((sum, s) => sum + s.durationSec, 0),
    ).toBeCloseTo(20, 6)
    expect(firstCount).toBeGreaterThan(5)
    expect(h.trailer.status().scriptSec).toBeCloseTo(20, 6)
  })

  it('整個 plan 算一步復原：復原後沒有預告片設定、場、鏡頭；重做回來', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    expect(h.history.state().canUndo).toBe(true)
    h.history.undo()
    expect(h.trailer.get().exists).toBe(false)
    expect(h.shots.list().shots).toEqual([])
    expect(h.outline.get().acts.flatMap((a) => a.scenes)).toEqual([])
    h.history.redo()
    expect(h.trailer.get().exists).toBe(true)
    expect(h.trailer.status().matches).toBe(true)
  })

  it('使用者填的標語一個字不改地出現在字卡上；沒填推薦語就沒有推薦語那一格', async () => {
    const h = setup()
    await h.trailer.plan({
      text: STORY,
      tagline: '有些光，要守著',
      endLine: '12 月 5 日・各大書店',
    })
    const cards = h.shots.list().shots.filter((s) => s.beatKind === 'card')
    expect(cards.map((c) => c.card?.text)).toContain('有些光，要守著')
    expect(h.trailer.get().settings.endLine).toBe('12 月 5 日・各大書店')
    expect(h.trailer.get().settings.claims).toEqual([])
  })

  it('不要旁白：每一格的旁白都是空的', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY, narration: false })
    expect(h.shots.list().shots.every((s) => s.dialogue === '')).toBe(true)
  })

  it('腳本裡的角色：建草稿角色卡', async () => {
    const llm = scripted(
      withBeats((script) => {
        script.beats[0] = { ...script.beats[0], characters: ['阿鐵'] }
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    await h.trailer.plan({ text: STORY })
    expect(h.characters.list().map((c) => c.name)).toContain('阿鐵')
  })

  it('check：示範模式可以寫、預估不花錢；寫過之後說明已有幾格會被取代', async () => {
    const h = setup()
    h.shots.create({})
    const before = h.trailer.check(STORY)
    expect(before).toMatchObject({ ok: true, demoMode: true, existingBeats: 0, generatedBeats: 0 })
    await h.trailer.plan({ text: STORY })
    expect(h.trailer.check().existingBeats).toBe(h.shots.list().shots.length - 1)
  })
})

describe('trailer.plan：檢查器接在寫腳本後面', () => {
  it('加總差 2 秒：退回重寫一次（還是差）→ 程式修正，最後加總剛好', async () => {
    const llm = scripted(
      withBeats((script) => {
        script.beats[1] = {
          ...script.beats[1],
          durationSec: Number(script.beats[1]?.durationSec) + 2,
        }
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    const result = await h.trailer.plan({ text: STORY })
    expect(llm.calls).toHaveLength(2)
    // 第二次的請求帶著檢查器的白話錯誤
    expect(llm.calls[1]?.messages.at(-1)?.content).toContain('沒有通過檢查')
    expect(result.retried).toBe(true)
    expect(result.fixes.join('')).toContain('30')
    expect(result.scriptSec).toBeCloseTo(30, 6)
    expect(result.matches).toBe(true)
  })

  it('字卡太多：退回重寫，第二次寫對就用第二次的', async () => {
    const llm = scripted(
      withBeats((script) => {
        for (let i = 0; i < 6; i++) {
          script.beats[1 + i] = {
            ...script.beats[1 + i],
            beatKind: 'card',
            cardText: `字卡${String(i)}`,
            dialogue: '',
          }
        }
      }),
      good(30),
    )
    const h = setup({ mockLlm: llm.llm })
    const result = await h.trailer.plan({ text: STORY })
    expect(llm.calls).toHaveLength(2)
    expect(result.retried).toBe(true)
    expect(result.fixes).toEqual([])
    expect(h.shots.list().shots.filter((s) => s.beatKind === 'card').length).toBeLessThanOrEqual(4)
  })

  it('亂碼：白話錯誤，專案沒被改（沒有設定、沒有場、沒有鏡頭、沒有復原紀錄）', async () => {
    const h = setup({
      mockLlm: (r) =>
        r.messages.some((m) => m.content.includes('請寫預告片腳本'))
          ? '哈哈哈不是 JSON'
          : undefined,
    })
    h.shots.create({})
    const before = h.shots.list().shots.length
    const actsBefore = h.outline.get()
    await expect(h.trailer.plan({ text: STORY })).rejects.toMatchObject({
      userMessage: expect.stringContaining('') as unknown,
    })
    expect(h.trailer.get().exists).toBe(false)
    expect(h.outline.get()).toEqual(actsBefore)
    expect(h.shots.list().shots).toHaveLength(before)
    expect(h.history.state().canUndo).toBe(false)
  })

  it('示範模式的壞腳本記號：檢查器擋下，專案沒被改', async () => {
    const h = setup()
    h.shots.create({})
    const actsBefore = h.outline.get()
    await expect(h.trailer.plan({ text: `${STORY}【腳本不合格】` })).rejects.toMatchObject({
      userMessage: expect.stringContaining('專案沒有被改') as unknown,
    })
    expect(h.trailer.get().exists).toBe(false)
    expect(h.outline.get()).toEqual(actsBefore)
    expect(h.shots.list().shots).toHaveLength(1)
  })

  it('第一格是字卡、程式也修不了：白話錯誤，專案沒被改', async () => {
    const llm = scripted(
      withBeats((script) => {
        script.beats[0] = {
          ...script.beats[0],
          beatKind: 'card',
          cardText: '開場字卡',
          dialogue: '',
        }
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    await expect(h.trailer.plan({ text: STORY })).rejects.toMatchObject({
      userMessage: expect.stringContaining('專案沒有被改') as unknown,
    })
    expect(h.trailer.get().exists).toBe(false)
    expect(h.shots.list().shots).toEqual([])
  })

  it('字卡超過 12 個字、旁白念不完：程式截短（寫在 fixes 裡）', async () => {
    const llm = scripted(
      withBeats((script) => {
        const card = script.beats.findIndex((b) => b.beatKind === 'card')
        script.beats[card] = { ...script.beats[card], cardText: '這是一句非常非常非常長的字卡文字' }
        script.beats[1] = {
          ...script.beats[1],
          dialogue: '這句旁白太長了根本念不完，而且還有第二句。第二句也很長。',
        }
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    const result = await h.trailer.plan({ text: STORY })
    expect(result.fixes.length).toBeGreaterThan(0)
    expect(result.errors).toEqual([])
    const card = h.shots.list().shots.find((s) => s.beatKind === 'card')
    expect((card?.card?.text ?? '').length).toBeLessThanOrEqual(12)
  })
})

describe('trailer.update／status', () => {
  it('改目標秒數但不重排：加總對不上目標，status 說對不上（長度規則擋下）', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const status = h.trailer.update({ patch: { targetSec: 20 } })
    expect(status.targetSec).toBe(20)
    expect(status.scriptSec).toBeCloseTo(30, 6)
    expect(status.matches).toBe(false)
    expect(status.errors.map((e) => e.code)).toContain('length')
  })

  it('改目標秒數並「照新長度重排」：加總剛好等於新目標；復原回到 30', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const status = h.trailer.update({ patch: { targetSec: 20 }, refit: true })
    expect(status.scriptSec).toBeCloseTo(20, 6)
    expect(status.matches).toBe(true)
    h.history.undo()
    const back = h.trailer.status()
    expect(back.targetSec).toBe(30)
    expect(back.scriptSec).toBeCloseTo(30, 6)
  })

  it('目標短到字卡與片名卡的最短秒數都放不下：白話錯誤，什麼都不改', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    expect(() => h.trailer.update({ patch: { targetSec: 10 }, refit: true })).toThrow(/放不下/)
    expect(h.trailer.status().targetSec).toBe(30)
  })

  it('還沒寫過腳本就要重排：白話錯誤', () => {
    const h = setup()
    h.shots.create({})
    expect(() => h.trailer.update({ patch: { targetSec: 20 }, refit: true })).toThrow(
      /還沒有預告片腳本/,
    )
  })

  it('一般專案：status 說沒有預告片（exists 是 false）', () => {
    const h = setup()
    h.shots.create({})
    expect(h.trailer.status()).toMatchObject({ exists: false, beatCount: 0, matches: false })
  })
})
