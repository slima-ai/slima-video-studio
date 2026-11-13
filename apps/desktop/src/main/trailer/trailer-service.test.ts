import { demoTrailerScript } from '@svs/providers'
import {
  checkTrailerScript,
  TrailerScriptSchema,
  TrailerSettingsSchema,
  type LlmRequest,
} from '@svs/schema'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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

describe('trailer.plan：真的呼叫只要花了錢就記帳（成功、被擋下、亂碼、重寫都一樣）', () => {
  /** 第一格是字卡、程式也修不了：寫的、退回重寫的兩次都過不了檢查。 */
  const rejected = () =>
    scripted(
      withBeats((script) => {
        script.beats[0] = {
          ...script.beats[0],
          beatKind: 'card',
          cardText: '開場字卡',
          dialogue: '',
        }
      }),
    )
  const COST = 0.37
  const total = (h: ReturnType<typeof setup>): number => {
    const handle = h.projects.current()
    return handle ? handle.repos.costs.totalUsd(handle.projectId) : 0
  }

  it('寫成功：這次的文字費記在專案帳本上，一次（不重複記）', async () => {
    const h = setup({ mockCostUsd: () => COST })
    await h.trailer.plan({ text: STORY })
    expect(total(h)).toBeCloseTo(COST, 9)
    expect(h.ledger.totalUsd()).toBe(0)
  })

  it('沒有專案、被檢查器擋下：兩次呼叫的錢記進 App 層的帳，空專案刪掉後還在；之後開的專案「已花」與額度算得到', async () => {
    const llm = rejected()
    const h = setup({ mockLlm: llm.llm, mockCostUsd: () => COST })
    await expect(h.trailer.plan({ text: STORY })).rejects.toMatchObject({
      userMessage: expect.stringContaining('專案沒有被改') as unknown,
    })
    expect(llm.calls).toHaveLength(2)
    // 空專案不留；錢也沒消失
    expect(h.projects.current()).toBeUndefined()
    expect(h.ledger.totalUsd()).toBeCloseTo(2 * COST, 9)
    expect(h.ledger.list()).toHaveLength(2)
    expect(h.ledger.list()[0]).toMatchObject({
      provider: 'mock',
      modelId: expect.any(String) as unknown,
    })
    // 之後建出來的第一個專案：把這筆移進自己的帳本，算一次「已花」；第二個專案是 0
    h.shots.create({})
    const first = h.projects.current()
    expect(total(h)).toBeCloseTo(2 * COST, 9)
    expect(first?.repos.costs.list(first.projectId)).toHaveLength(2)
    expect(h.ledger.totalUsd()).toBe(0)
    expect(h.ledger.list().every((e) => e.movedToProjectId === first?.projectId)).toBe(true)
    h.projects.create(join(h.root, 'projects', '第二個.svsproj'), '第二個')
    expect(total(h)).toBe(0)
  })

  it('沒有專案、模型回亂碼（格式不對重試一次還是不對）：兩次呼叫的錢一樣記進 App 層', async () => {
    const h = setup({
      mockCostUsd: () => COST,
      mockLlm: (r) =>
        r.messages.some((m) => m.content.includes('請寫預告片腳本')) ? '不是 JSON' : undefined,
    })
    await expect(h.trailer.plan({ text: STORY })).rejects.toBeDefined()
    expect(h.projects.current()).toBeUndefined()
    expect(h.ledger.totalUsd()).toBeCloseTo(2 * COST, 9)
  })

  it('已經開著專案、被擋下：錢記在這個專案的帳本上（專案還在，不用另外記）', async () => {
    const llm = rejected()
    const h = setup({ mockLlm: llm.llm, mockCostUsd: () => COST })
    h.shots.create({})
    await expect(h.trailer.plan({ text: STORY })).rejects.toBeDefined()
    expect(total(h)).toBeCloseTo(2 * COST, 9)
    expect(h.ledger.totalUsd()).toBe(0)
    const handle = h.projects.current()
    expect(handle?.repos.costs.list(handle.projectId)).toHaveLength(2)
  })

  it('重寫腳本被擋下：舊腳本不動，那一次的錢記在專案上', async () => {
    const h = setup({ mockCostUsd: () => COST })
    await h.trailer.plan({ text: STORY })
    const before = h.shots.list().shots.map((s) => s.id)
    expect(total(h)).toBeCloseTo(COST, 9)
    await expect(h.trailer.plan({ text: `${STORY}【腳本不合格】` })).rejects.toBeDefined()
    expect(h.shots.list().shots.map((s) => s.id)).toEqual(before)
    // 示範的壞腳本標記：寫的、退回重寫的各一次
    expect(total(h)).toBeCloseTo(3 * COST, 9)
  })

  it('花費上限：移進第一個新專案的錢照算它的額度（預估前就擋）；第二個專案不受影響', async () => {
    const llm = rejected()
    const h = setup({ mockLlm: llm.llm, mockCostUsd: () => COST })
    await expect(h.trailer.plan({ text: STORY })).rejects.toBeDefined()
    h.settings.update({ budget: { perRunLimitUsd: 5, projectLimitUsd: 0.5 } })
    h.shots.create({})
    const blocked = h.trailer.check(STORY)
    expect(blocked.ok).toBe(false)
    expect(blocked.issue).toContain('專案')
    h.projects.create(join(h.root, 'projects', '第二個.svsproj'), '第二個')
    expect(h.trailer.check(STORY).ok).toBe(true)
  })

  it('又失敗在一個剛建的專案裡：那個專案刪掉時，它帶進去的舊帳也放回 App 層，錢一分都不會少', async () => {
    const llm = rejected()
    const h = setup({ mockLlm: llm.llm, mockCostUsd: () => COST })
    await expect(h.trailer.plan({ text: STORY })).rejects.toBeDefined()
    expect(h.ledger.totalUsd()).toBeCloseTo(2 * COST, 9)
    // 第二次：新專案先領了上一次的 0.74，這次又擋下、專案刪掉
    await expect(h.trailer.plan({ text: STORY })).rejects.toBeDefined()
    expect(h.projects.current()).toBeUndefined()
    expect(h.ledger.totalUsd()).toBeCloseTo(4 * COST, 9)
    // 之後第一個建出來的專案一次領走全部（只算一次）
    h.shots.create({})
    expect(total(h)).toBeCloseTo(4 * COST, 9)
    expect(h.ledger.totalUsd()).toBe(0)
  })
})

describe('trailer.status：跟寫腳本當下用同一套節奏檢查（段落存進專案）', () => {
  /** 後面一格比一格短，只有「懸念」那一格留得很久：寫的當下（「懸念」不算）沒有節奏提醒；
   *  如果存進專案之後不認得「懸念」，最後三分之一的平均會被它拉高，冒出節奏提醒。 */
  const suspenseScript = () => {
    const pic = (segment: string, durationSec: number, i: number) => ({
      segment,
      beatKind: i % 2 === 0 ? 'video' : 'still',
      durationSec,
      description: `畫面 ${String(i)}`,
      action: '',
      size: 'medium',
      angle: 'eye_level',
      cameraMove: null,
      characters: [],
      location: '',
      dialogue: '',
      cardText: '',
      cardSubtext: '',
    })
    const lengths: [string, number][] = [
      ['hook', 3],
      ['world', 3],
      ['world', 3],
      ['turn', 3.5],
      ['turn', 3.5],
      ['escalate', 1.5],
      ['escalate', 1.2],
      ['escalate', 1],
      ['escalate', 0.8],
      ['escalate', 0.6],
      ['suspense', 5],
    ]
    const beats: Record<string, unknown>[] = lengths.map(([segment, sec], i) =>
      pic(segment, sec, i),
    )
    const used = lengths.reduce((sum, [, sec]) => sum + sec, 0)
    beats.push({
      ...pic('title', 30 - used, 99),
      beatKind: 'title',
      description: '',
    })
    return { title: '斷橋', music: '', places: [], beats }
  }

  it('同一份腳本：寫的當下檢查、存進專案後 trailer.status 檢查，錯誤與提醒一模一樣（也沒有節奏提醒）', async () => {
    const llm = scripted(suspenseScript)
    const h = setup({ mockLlm: llm.llm })
    const script = TrailerScriptSchema.parse(suspenseScript())
    const settings = TrailerSettingsSchema.parse({ kind: 'story', targetSec: 30, title: '斷橋' })
    const writing = checkTrailerScript(
      script.beats.map((b) => ({
        beatKind: b.beatKind,
        durationSec: b.durationSec,
        segment: b.segment,
        ...(b.beatKind === 'card' ? { card: { text: b.cardText, subtext: b.cardSubtext } } : {}),
      })),
      settings,
      24,
    )
    expect(writing.warnings.map((w) => w.code)).not.toContain('no_escalation')

    await h.trailer.plan({ text: STORY, title: '斷橋' })
    const stored = h.trailer.status()
    expect(stored.errors.map((e) => e.code)).toEqual(writing.errors.map((e) => e.code))
    // 存進去以後的提醒（片尾那行、片名沒有行動資訊這類，跟段落無關）跟寫的當下一模一樣；尤其不能多出節奏提醒
    expect(stored.warnings.map((w) => w.code)).toEqual(writing.warnings.map((w) => w.code))
    expect(stored.warnings.map((w) => w.code)).not.toContain('no_escalation')
    // 段落真的存進了每個鏡頭
    expect(
      h.projects
        .current()
        ?.repos.shots.list()
        .map((s) => s.segment),
    ).toEqual(script.beats.map((b) => (b.segment === '' ? undefined : b.segment)))
  })
})

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

describe('trailer.plan：角色與地點的草稿卡', () => {
  it('建角色與地點草稿卡，鏡頭掛上地點與角色名字；字卡與片名卡沒有地點', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const places = h.outline.get().locations
    expect(places.map((l) => l.name).sort()).toEqual(['斷橋', '河岸'])
    expect(
      h.characters
        .list()
        .map((c) => c.name)
        .sort(),
    ).toEqual(['小葉', '老鐘'])
    const shots = h.shots.list().shots
    const pictures = shots.filter(
      (s) => (s.beatKind ?? 'video') === 'video' || s.beatKind === 'still',
    )
    expect(pictures.every((s) => s.characters.length >= 1)).toBe(true)
    expect(pictures.every((s) => s.locationId !== undefined)).toBe(true)
    expect(
      shots
        .filter((s) => s.beatKind === 'card' || s.beatKind === 'title')
        .every((s) => s.locationId === undefined),
    ).toBe(true)
  })

  it('名字跟既有的場景卡一樣：用既有的那張，不重複建（再寫一次也不會越建越多）', async () => {
    const h = setup()
    h.shots.create({})
    h.outline.edit({ op: 'addLocation' })
    const created = h.outline.get().locations[0]
    if (!created) throw new Error('沒有建出地點')
    h.outline.edit({
      op: 'updateLocation',
      locationId: created.id,
      patch: { name: '斷橋', description: '我自己的斷橋' },
    })
    const before = h.outline.get().locations.find((l) => l.name === '斷橋')
    await h.trailer.plan({ text: STORY })
    await h.trailer.plan({ text: STORY })
    const places = h.outline.get().locations
    expect(places.filter((l) => l.name === '斷橋')).toHaveLength(1)
    expect(places.find((l) => l.name === '斷橋')?.description).toBe('我自己的斷橋')
    expect(places.map((l) => l.name).sort()).toEqual(['斷橋', '河岸'])
    const onBridge = h.shots.list().shots.filter((s) => s.locationId === before?.id)
    expect(onBridge.length).toBeGreaterThan(0)
  })

  it('地點草稿卡的說明只寫地方本身：不出現任何角色名字，也不等於任何一格的畫面描述', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const names = h.characters.list().map((c) => c.name)
    const descriptions = new Set(h.shots.list().shots.map((s) => s.description))
    const places = h.outline.get().locations
    expect(places).toHaveLength(2)
    for (const place of places) {
      expect(place.description).not.toBe('')
      expect(descriptions.has(place.description)).toBe(false)
      for (const name of names) expect(place.description).not.toContain(name)
    }
    expect(places.find((p) => p.name === '斷橋')?.description).toContain('橋')
  })

  it('腳本沒寫地點外觀：說明留空（不拿畫面描述來填）', async () => {
    const llm = scripted(
      withBeats((script) => {
        ;(script as unknown as { places: unknown[] }).places = []
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    await h.trailer.plan({ text: STORY })
    expect(h.outline.get().locations.map((l) => l.description)).toEqual(['', ''])
  })

  it('模型把人與動作寫進地點外觀（有角色名字、或抄了某一格的畫面描述）：當作沒寫，說明留空', async () => {
    const llm = scripted(
      withBeats((script) => {
        const beats = script.beats
        const first = beats.find((b) => b.beatKind === 'video')
        ;(script as unknown as { places: unknown[] }).places = [
          { name: '斷橋', look: '小葉站在橋上守著燈' },
          { name: '河岸', look: typeof first?.description === 'string' ? first.description : '' },
        ]
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    await h.trailer.plan({ text: STORY })
    expect(h.outline.get().locations.map((l) => l.description)).toEqual(['', ''])
  })

  it('復原：地點與角色草稿卡一起退回', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    h.history.undo()
    expect(h.outline.get().locations).toEqual([])
    expect(h.characters.list()).toEqual([])
  })

  it('寫腳本的提示帶著既有的場景卡名字（要求沿用）', async () => {
    const llm = scripted(good(30))
    const h = setup({ mockLlm: llm.llm })
    h.shots.create({})
    h.outline.edit({ op: 'addLocation' })
    const made = h.outline.get().locations[0]
    if (!made) throw new Error('沒有建出地點')
    h.outline.edit({ op: 'updateLocation', locationId: made.id, patch: { name: '舊車站' } })
    await h.trailer.plan({ text: STORY })
    expect(llm.calls[0]?.system).toContain('舊車站')
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

  describe('寫腳本失敗：不留下這次自己建的空專案', () => {
    const projectDirs = (h: ReturnType<typeof setup>): string[] => {
      const folder = join(h.root, 'projects')
      return existsSync(folder) ? readdirSync(folder) : []
    }

    it('還沒有專案、被檢查器擋下：沒有專案、專案資料夾裡也沒有多東西', async () => {
      const h = setup()
      h.projects.close()
      expect(projectDirs(h)).toEqual([])
      await expect(h.trailer.plan({ text: `${STORY}【腳本不合格】` })).rejects.toMatchObject({
        userMessage: expect.stringContaining('專案沒有被改') as unknown,
      })
      expect(h.projects.current()).toBeUndefined()
      expect(projectDirs(h)).toEqual([])
    })

    it('還沒有專案、模型回亂碼：一樣不留', async () => {
      const h = setup({
        mockLlm: (r) =>
          r.messages.some((m) => m.content.includes('請寫預告片腳本')) ? '不是 JSON' : undefined,
      })
      h.projects.close()
      await expect(h.trailer.plan({ text: STORY })).rejects.toBeDefined()
      expect(h.projects.current()).toBeUndefined()
      expect(projectDirs(h)).toEqual([])
    })

    it('已經開著專案、被擋下：專案原樣還在（不是這次建的，不能動）', async () => {
      const h = setup()
      h.shots.create({})
      const dir = h.projects.current()?.dir
      await expect(h.trailer.plan({ text: `${STORY}【腳本不合格】` })).rejects.toBeDefined()
      expect(h.projects.current()?.dir).toBe(dir)
      expect(h.shots.list().shots).toHaveLength(1)
    })

    it('還沒有專案、寫成功：專案留下，名字取書名', async () => {
      const h = setup()
      h.projects.close()
      await h.trailer.plan({ text: STORY, title: '斷橋' })
      expect(h.projects.current()?.repos.projects.get().name).toBe('斷橋')
      expect(projectDirs(h)).toHaveLength(1)
    })
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
    // 這次自己建的空專案不留下（「專案沒有被改」＝連專案都沒多一個）
    expect(h.projects.current()).toBeUndefined()
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

describe('trailer.plan：錯誤訊息與重寫用的資料', () => {
  it('腳本沒過檢查、文本不長：訊息只說檢查的問題，不叫人縮短文本', async () => {
    const h = setup()
    h.shots.create({})
    const error = await h.trailer.plan({ text: `${STORY}【腳本不合格】` }).catch((e: unknown) => e)
    const message = (error as { userMessage?: string }).userMessage ?? ''
    expect(message).toContain('第一格必須是畫面')
    expect(message).not.toContain('縮短')
  })

  it('腳本沒過檢查、文本很長（超過 12,000 字）：才多一句建議縮短', async () => {
    const h = setup()
    h.shots.create({})
    const long = `${STORY}${'她守著燈。'.repeat(2600)}【腳本不合格】`
    const error = await h.trailer.plan({ text: long }).catch((e: unknown) => e)
    const message = (error as { userMessage?: string }).userMessage ?? ''
    expect(message).toContain('第一格必須是畫面')
    expect(message).toContain('縮短')
  })

  it('寫腳本用的文本存在設定裡（重寫腳本再用一次）；重寫會清掉「聲音加過了」', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    expect(h.trailer.get().settings.sourceText).toBe(STORY)
    expect(h.trailer.get().settings.soundAutoAddedAt).toBeUndefined()
  })

  it('「生成空的」的確認視窗：預告片設定有旁白與配樂，生成完會自動加；關掉就不加', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const on = h.canvas.runPlan({ keys: [], all: true })
    expect(on.sound).toMatchObject({ narration: true, music: true })
    expect(on.sound?.narrationShots).toBeGreaterThan(0)
    h.trailer.update({ patch: { narration: false, music: false } })
    expect(h.canvas.runPlan({ keys: [], all: true }).sound).toBeUndefined()
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
    // 面板看到的是短版（不帶「請調整各格的秒數…」這種給模型的指示句）
    const length = status.errors.find((e) => e.code === 'length')
    expect(length?.message).toMatch(/^總長 30\.0 秒，目標 20 秒，差 10\.0 秒。$/)
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
