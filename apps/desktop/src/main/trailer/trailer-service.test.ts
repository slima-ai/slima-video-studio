import { demoTrailerScript } from '@svs/providers'
import {
  beatMinFrames,
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
  (sec = 30, kind: 'story' | 'teaser' | 'idea' = 'story') =>
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
      // 會動的格至少 1.5 秒（更短的是不動的畫面）
      beatKind: i % 2 === 0 && durationSec >= 1.5 ? 'video' : 'still',
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
      ['escalate', 0.75],
      ['suspense', 4.85],
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
    // 畫面（預告片頁的腳本條、畫布卡片）看到的鏡頭也帶著段落；沒有段落就沒有這個欄位
    expect(shotsOf(h).map((s) => s.segment)).toEqual(
      script.beats.map((b) => (b.segment === '' ? undefined : b.segment)),
    )
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

describe('trailer.plan：語錄體（示範模式與模型寫錯金句）', () => {
  const QUOTES_TEXT =
    '寵辱不驚，閒看庭前花開花落。去留無意，漫隨天外雲卷雲舒。得意時毋忘失意。有生趣的是活潑。三思而後行。靜坐常思己過。讀書不忘本分。'
  const flat = (text: string): string => text.replace(/[\s\p{P}]/gu, '')

  it('30 秒：金句是原文裡的短句，疊在不動的畫面上；原文存進設定，沒有 error、沒有修正', async () => {
    const h = setup()
    const result = await h.trailer.plan({ text: QUOTES_TEXT, kind: 'idea' })
    expect(result.errors).toEqual([])
    expect(result.fixes).toEqual([])
    expect(result.settings.sourceText).toBe(QUOTES_TEXT)
    const stored = h.projects.current()?.repos.shots.list() ?? []
    const quotes = stored.filter((s) => s.segment === 'quote')
    expect(quotes.length).toBeGreaterThanOrEqual(3)
    for (const shot of quotes) {
      expect(shot.beatKind).toBe('still')
      expect(flat(QUOTES_TEXT)).toContain(flat(shot.overlay?.text ?? '（沒有疊字）'))
    }
  })

  it('模型兩次都把金句寫錯一個字：換成原文裡最像的那一句，存進鏡頭，白話說明在 fixes', async () => {
    const wrong = () => {
      const script = demoTrailerScript({
        capability: 'llm',
        modelId: 'mock/llm',
        messages: [
          {
            role: 'user',
            content: `故事：\n${QUOTES_TEXT}\n\n請寫預告片腳本。類型：idea。目標總長：30 秒。旁白：開。`,
          },
        ],
      }) as { beats: { segment: string; overlayText: string; dialogue: string }[] }
      const quote = script.beats.find((b) => b.segment === 'quote')
      if (quote) {
        quote.overlayText = `${quote.overlayText}了`
        quote.dialogue = quote.overlayText
      }
      return script
    }
    const llm = scripted(wrong)
    const h = setup({ mockLlm: llm.llm })
    const result = await h.trailer.plan({ text: QUOTES_TEXT, kind: 'idea' })
    expect(llm.calls).toHaveLength(2)
    expect(result.errors).toEqual([])
    expect(result.fixes.length).toBeGreaterThan(0)
    const stored = h.projects.current()?.repos.shots.list() ?? []
    for (const shot of stored.filter((s) => s.segment === 'quote')) {
      expect(flat(QUOTES_TEXT)).toContain(flat(shot.overlay?.text ?? '（沒有疊字）'))
    }
  })
})

describe('trailer.plan：觀點型（示範模式）', () => {
  const IDEA_TEXT =
    '這本書說：越忙越沒進度，是因為優先順序錯了。先做最重要的一件事，把待辦清單砍掉一半。'

  it('30 秒：類型存成 idea；腳本加總剛好、沒有 error；5 句話疊在不動的畫面上（沒有黑底字卡）', async () => {
    const h = setup()
    const result = await h.trailer.plan({ text: IDEA_TEXT, kind: 'idea' })
    expect(result.settings.kind).toBe('idea')
    expect(result.matches).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.retried).toBe(false)
    const shots = shotsOf(h)
    expect(shots.filter((s) => s.beatKind === 'card')).toHaveLength(0)
    expect(shots.filter((s) => s.overlay !== undefined)).toHaveLength(5)
    expect(shots.filter((s) => s.overlay !== undefined).every((s) => s.beatKind === 'still')).toBe(
      true,
    )
    expect(shots.at(-1)?.beatKind).toBe('title')
    // 段落存進鏡頭：觀點型的六段裡，示範用到 hook、claim、gains、title
    const stored = h.projects.current()?.repos.shots.list() ?? []
    expect(new Set(stored.map((s) => s.segment))).toEqual(
      new Set(['hook', 'claim', 'gains', 'title']),
    )
  })

  it('沒有角色卡；3 個主視覺用場景卡（草稿，有地方的外觀說明）；畫面的格子都掛著主視覺', async () => {
    const h = setup()
    await h.trailer.plan({ text: IDEA_TEXT, kind: 'idea' })
    expect(h.characters.list()).toEqual([])
    const places = h.outline.get().locations
    expect(places).toHaveLength(3)
    expect(places.every((l) => l.description !== '')).toBe(true)
    const shots = shotsOf(h)
    const pictures = shots.filter((s) => s.beatKind === 'video' || s.beatKind === 'still')
    expect(pictures.every((s) => s.characters.length === 0)).toBe(true)
    expect(pictures.every((s) => s.locationId !== undefined)).toBe(true)
    expect(new Set(pictures.map((s) => s.locationId)).size).toBe(3)
  })

  it('模型照劇情型的習慣寫了角色：觀點型不建角色卡、鏡頭也不掛角色', async () => {
    const idea = scripted(() => {
      const script = good(30, 'idea')() as Script
      script.beats[0] = { ...script.beats[0], characters: ['阿鐵'] }
      return script
    })
    const h = setup({ mockLlm: idea.llm })
    await h.trailer.plan({ text: IDEA_TEXT, kind: 'idea' })
    expect(h.characters.list()).toEqual([])
    expect(shotsOf(h).every((s) => s.characters.length === 0)).toBe(true)
  })

  it('存進專案之後 trailer.status 也數主視覺：只有 2 個地點，寫的當下與存進去之後都只提醒、不擋', async () => {
    const twoPlaces = scripted(() => {
      const script = good(30, 'idea')() as Script & { places: { name: string; look: string }[] }
      const names = ['甲', '乙']
      let n = 0
      script.beats = script.beats.map((b) =>
        b.beatKind === 'video' || b.beatKind === 'still' ? { ...b, location: names[n++ % 2] } : b,
      )
      script.places = names.map((name) => ({ name, look: '一個地方' }))
      return script
    })
    const h = setup({ mockLlm: twoPlaces.llm })
    const result = await h.trailer.plan({ text: IDEA_TEXT, kind: 'idea' })
    expect(result.errors).toEqual([])
    expect(result.warnings.map((w) => w.code)).toContain('few_visuals')
    expect(h.trailer.status().warnings.map((w) => w.code)).toContain('few_visuals')
  })

  it('主視覺用了 6 個：退回重寫，第二次合併成 3 個就過（只花兩次文字費）', async () => {
    const six = () => {
      const script = good(30, 'idea')() as Script & { places: unknown[] }
      let n = 0
      script.beats = script.beats.map((b) =>
        b.beatKind === 'video' || b.beatKind === 'still'
          ? { ...b, location: `地方${String(n++ % 6)}` }
          : b,
      )
      return script
    }
    const llm = scripted(six, good(30, 'idea'))
    const h = setup({ mockLlm: llm.llm })
    const result = await h.trailer.plan({ text: IDEA_TEXT, kind: 'idea' })
    expect(llm.calls).toHaveLength(2)
    expect(result.retried).toBe(true)
    expect(result.errors).toEqual([])
    expect(h.outline.get().locations).toHaveLength(3)
  })
})

describe('trailer.plan：腳本裡的外觀寫進草稿卡（角色與場景卡）', () => {
  interface PeopleScript extends Script {
    people: { name: string; look: string; outfit: string }[]
    places: { name: string; look: string }[]
  }
  const withPeople = (edit: (script: PeopleScript) => void) => () => {
    const script = good(30)() as PeopleScript
    edit(script)
    return script
  }
  const cardOf = (h: ReturnType<typeof setup>, name: string) => {
    const card = h.characters.list().find((c) => c.name === name)
    if (!card) throw new Error(`沒有角色 ${name}`)
    return card
  }

  it('示範腳本：新建的草稿角色卡有長相、服裝、固定外觀描述（草稿，沒有自動鎖定）', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    for (const name of ['小葉', '老鐘']) {
      const card = cardOf(h, name)
      expect(card.appearance, name).not.toBe('')
      expect(card.outfit, name).not.toBe('')
      expect(card.anchorText, name).toBe(`${card.appearance}，${card.outfit}`)
      expect(card.anchorStatus, name).toBe('draft')
    }
  })

  it('people 沒寫某個角色：那張卡照舊是空的（沒有固定外觀描述）', async () => {
    const llm = scripted(
      withPeople((script) => {
        script.people = script.people.filter((p) => p.name === '小葉')
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    await h.trailer.plan({ text: STORY })
    expect(cardOf(h, '小葉').anchorText).not.toBe('')
    const empty = cardOf(h, '老鐘')
    expect(empty).toMatchObject({ appearance: '', outfit: '', anchorText: '' })
  })

  it('只有長相、沒有服裝：固定外觀描述只放長相；兩個都空：空草稿卡', async () => {
    const llm = scripted(
      withPeople((script) => {
        script.people = [
          { name: '小葉', look: '短髮的少女', outfit: '' },
          { name: '老鐘', look: '', outfit: '' },
        ]
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    await h.trailer.plan({ text: STORY })
    expect(cardOf(h, '小葉')).toMatchObject({ appearance: '短髮的少女', anchorText: '短髮的少女' })
    expect(cardOf(h, '老鐘').anchorText).toBe('')
  })

  it('已經有卡的角色不動（使用者可能改過）；people 裡有、但沒有任何一格用到的名字不建卡', async () => {
    const llm = scripted(
      withPeople((script) => {
        script.people = [
          ...script.people,
          { name: '路人甲', look: '戴帽子的男人', outfit: '灰外套' },
        ]
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    h.shots.create({})
    const mine = h.characters.create('小葉')
    h.characters.update(mine.id, { appearance: '我自己寫的長相' })
    await h.trailer.plan({ text: STORY })
    const kept = cardOf(h, '小葉')
    expect(kept.appearance).toBe('我自己寫的長相')
    expect(kept.outfit).toBe('')
    expect(kept.anchorText).toBe('')
    expect(h.characters.list().map((c) => c.name)).not.toContain('路人甲')
  })

  it('名字比對不分大小寫、去頭尾空白；長相與服裝各截到 300 字', async () => {
    const llm = scripted(
      withPeople((script) => {
        script.people = [
          { name: ' 小葉 ', look: '長'.repeat(500), outfit: '衣'.repeat(500) },
          { name: '老鐘', look: '瘦長的老人', outfit: '褐色長袍' },
        ]
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    await h.trailer.plan({ text: STORY })
    const card = cardOf(h, '小葉')
    expect(card.appearance).toHaveLength(300)
    expect(card.outfit).toHaveLength(300)
    expect(card.anchorStatus).toBe('draft')
  })

  it('復原一次：角色卡連同外觀、固定外觀描述一起退回，沒有殘留', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    expect(cardOf(h, '小葉').anchorText).not.toBe('')
    h.history.undo()
    expect(h.characters.list()).toEqual([])
    h.history.redo()
    expect(cardOf(h, '小葉').anchorText).not.toBe('')
  })

  it('場景卡：腳本的地點外觀也存成固定描述（草稿，不自動鎖定）；故事裡的說明照舊也有', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const cards = h.projects.current()?.repos.locationCards.list() ?? []
    expect(cards.map((c) => c.name).sort()).toEqual(['斷橋', '河岸'])
    for (const card of cards) {
      expect(card.anchorText, card.name).not.toBe('')
      expect(card.anchorText, card.name).toBe(card.description)
      expect(card.status, card.name).toBe('draft')
    }
  })

  it('場景卡：已經有的卡不動（說明與固定描述都不蓋）', async () => {
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
    await h.trailer.plan({ text: STORY })
    const mine = h.projects
      .current()
      ?.repos.locationCards.list()
      .find((c) => c.name === '斷橋')
    expect(mine?.description).toBe('我自己的斷橋')
    expect(mine?.anchorText).toBe('')
    const fresh = h.projects
      .current()
      ?.repos.locationCards.list()
      .find((c) => c.name === '河岸')
    expect(fresh?.anchorText).not.toBe('')
  })

  it('場景卡：外觀裡有角色名字（被當成沒寫）就兩邊都不存；沒寫外觀也是空的', async () => {
    const llm = scripted(
      withPeople((script) => {
        script.places = [
          { name: '斷橋', look: '小葉站在橋上守著燈' },
          { name: '河岸', look: '' },
        ]
      }),
    )
    const h = setup({ mockLlm: llm.llm })
    await h.trailer.plan({ text: STORY })
    const cards = h.projects.current()?.repos.locationCards.list() ?? []
    expect(cards.map((c) => [c.name, c.description, c.anchorText])).toEqual(
      expect.arrayContaining([
        ['斷橋', '', ''],
        ['河岸', '', ''],
      ]) as unknown,
    )
  })

  it('復原：場景卡的固定描述跟著退回', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    h.history.undo()
    expect(h.projects.current()?.repos.locationCards.list()).toEqual([])
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

    it('還沒有專案、沒填書名、寫成功：專案名取腳本的片名（不是「預告片」或「我的短片」）；已經開著的專案不改名', async () => {
      const h = setup()
      h.projects.close()
      const result = await h.trailer.plan({ text: STORY })
      expect(result.settings.title).not.toBe('')
      expect(h.projects.current()?.repos.projects.get().name).toBe(result.settings.title)
      // 同一個專案再寫一次：不是這次建的，名字不動
      h.projects.rename('我改過的名字')
      await h.trailer.plan({ text: STORY })
      expect(h.projects.current()?.repos.projects.get().name).toBe('我改過的名字')
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

  it('照新長度重排之後，被壓到比 1.5 秒短的會動格自動改成不動；復原連種類一起回來', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY, targetSec: 60 })
    // 會動的格子存的是沒有種類（空值），這裡統一寫成 video
    const kinds = () =>
      h.shots.list().shots.map((s) => [s.beatKind ?? 'video', s.durationSec] as const)
    const before = kinds()
    h.trailer.update({ patch: { targetSec: 26 }, refit: true })
    const after = kinds()
    // 沒有任何一格是「會動、卻短於 1.5 秒」
    expect(after.filter(([kind, sec]) => kind === 'video' && sec < 1.5 - 1e-9)).toEqual([])
    // 而且真的有格子被壓得很短（改成了不動），不是剛好沒碰到
    expect(after.some(([kind, sec]) => kind === 'still' && sec < 1.5)).toBe(true)
    // 每一格至少 0.75 秒
    expect(after.every(([, sec]) => sec >= 0.75 - 1e-9)).toBe(true)
    h.history.undo()
    // 復原：回到重排之前（60 秒那一版沒有被壓短的會動格）
    expect(kinds().filter(([, sec]) => sec < 1.5)).toEqual(before.filter(([, sec]) => sec < 1.5))
    expect(kinds()).toEqual(before)
    expect(h.trailer.status().targetSec).toBe(60)
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

describe('trailer.setBeatSeconds：改一格的秒數，其他格讓時間，總長不變', () => {
  it('這一格變成指定的秒數，其餘重排，加總仍是 30；一步復原回到原樣', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const before = shotsOf(h).map((s) => [s.id, s.durationSec] as const)
    const pick = shotsOf(h).find((s) => s.number === 2)
    if (!pick) throw new Error('沒有第 2 格')
    const wanted = Math.round((pick.durationSec + 0.5) * 24) / 24
    const status = h.trailer.setBeatSeconds({ shotId: pick.id, durationSec: wanted })
    expect(status.scriptSec).toBeCloseTo(30, 6)
    expect(status.matches).toBe(true)
    const after = shotsOf(h)
    expect(after.find((s) => s.id === pick.id)?.durationSec).toBeCloseTo(wanted, 6)
    expect(after.reduce((sum, s) => sum + s.durationSec, 0)).toBeCloseTo(30, 6)
    h.history.undo()
    expect(shotsOf(h).map((s) => [s.id, s.durationSec])).toEqual(before.map((b) => [...b]))
  })

  it('其他格已經是最短：白話錯誤，什麼都不改', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    // 目標縮到「每一格的最短秒數加起來再多一秒」：每一格都壓到差不多最短，這時把第 2 格拉長，其他格就放不下了
    const minSec =
      shotsOf(h).reduce(
        (sum, s) =>
          sum +
          beatMinFrames(
            { beatKind: s.beatKind ?? 'video', ...(s.card ? { card: s.card } : {}) },
            24,
          ),
        0,
      ) / 24
    const target = Math.ceil(minSec) + 1
    h.trailer.update({ patch: { targetSec: target }, refit: true })
    const before = shotsOf(h).map((s) => s.durationSec)
    const pick = shotsOf(h).find((s) => s.number === 2)
    if (!pick) throw new Error('沒有第 2 格')
    expect(() =>
      h.trailer.setBeatSeconds({ shotId: pick.id, durationSec: Math.min(15, target - 1) }),
    ).toThrow(/已經是最短了，這一格最多只能到 [\d.]+ 秒/)
    expect(shotsOf(h).map((s) => s.durationSec)).toEqual(before)
  })

  it('第一格最長 4 秒；不在腳本裡的格子、還沒有腳本，都是白話錯誤', async () => {
    const h = setup()
    const blank = h.shots.create({})
    expect(() => h.trailer.setBeatSeconds({ shotId: 'x', durationSec: 2 })).toThrow(
      /還沒有預告片腳本/,
    )
    await h.trailer.plan({ text: STORY })
    // 寫腳本之前手動建的那一格不在腳本裡：第一格是腳本裡的第一個鏡頭
    const first = shotsOf(h).find((s) => s.id !== blank.id)
    if (!first) throw new Error('沒有第 1 格')
    expect(() => h.trailer.setBeatSeconds({ shotId: first.id, durationSec: 5 })).toThrow(
      /第一格最長 4 秒/,
    )
    expect(() => h.trailer.setBeatSeconds({ shotId: 'nope', durationSec: 2 })).toThrow(
      /不在預告片腳本裡/,
    )
  })

  it('改長到讓第一格被擠超過 4 秒時，第一格固定在 4 秒，其餘照排', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const shots = shotsOf(h)
    const last = shots.at(-2)
    if (!last) throw new Error('沒有倒數第 2 格')
    h.trailer.setBeatSeconds({ shotId: last.id, durationSec: Math.max(0.25, last.durationSec - 1) })
    expect(shotsOf(h).find((s) => s.number === 1)?.durationSec ?? 99).toBeLessThanOrEqual(4 + 1e-9)
    expect(h.trailer.status().matches).toBe(true)
  })

  it('shots.update 可以改段落；空字串清掉；畫面看到的格子跟著變', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const second = shotsOf(h).find((s) => s.number === 2)
    if (!second) throw new Error('沒有第 2 格')
    expect(h.shots.update(second.id, { segment: 'turn' }).segment).toBe('turn')
    expect(h.shots.update(second.id, { segment: '' }).segment).toBeUndefined()
  })
})

describe('懸念短版的長度：後端也擋（跟畫面的選單一致）', () => {
  it('寫腳本：懸念短版超過 30 秒，白話錯誤，文字模型一次都沒呼叫', async () => {
    let called = 0
    const h = setup({
      mockLlm: () => {
        called++
        return undefined
      },
    })
    await expect(
      h.trailer.plan({ text: STORY, kind: 'teaser', targetSec: 60 }),
    ).rejects.toMatchObject({
      userMessage: expect.stringContaining('懸念短版最長 30 秒') as unknown,
    })
    expect(called).toBe(0)
    // 15、30 秒可以
    await expect(
      h.trailer.plan({ text: STORY, kind: 'teaser', targetSec: 15 }),
    ).resolves.toBeDefined()
  })

  it('改設定：把懸念短版改成 60 秒、或把 60 秒的專案改成懸念短版，都擋；劇情型 60 秒不受影響；舊的 60 秒懸念短版改書名照常', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY, targetSec: 60 })
    expect(() => h.trailer.update({ patch: { kind: 'teaser' } })).toThrow(/懸念短版最長 30 秒/)
    expect(h.trailer.status().settings.kind).toBe('story')
    h.trailer.update({ patch: { targetSec: 30 }, refit: true })
    h.trailer.update({ patch: { kind: 'teaser' } })
    expect(() => h.trailer.update({ patch: { targetSec: 60 } })).toThrow(/懸念短版最長 30 秒/)
    // 直接寫進專案的舊資料（60 秒的懸念短版）：只改書名不被擋
    h.projects.current()?.repos.trailer.update({ targetSec: 60 })
    expect(h.trailer.update({ patch: { title: '新書名' } }).settings.title).toBe('新書名')
  })
})

describe('trailer.plan：金句型的疊字', () => {
  const overlayBeat = (extra: Record<string, unknown>) => ({
    segment: '',
    beatKind: 'video',
    durationSec: 3,
    description: '凌晨還亮著燈的辦公室',
    action: '',
    size: 'medium',
    angle: 'eye_level',
    cameraMove: null,
    characters: [],
    location: '深夜辦公室',
    dialogue: '',
    cardText: '',
    cardSubtext: '',
    overlayText: '',
    overlaySubtext: '',
    ...extra,
  })
  const ideaScript = () => ({
    title: '專注力',
    music: '單一樂器，穩定推進',
    places: [{ name: '深夜辦公室', look: '凌晨還亮著一盞燈的辦公桌' }],
    people: [],
    beats: [
      overlayBeat({
        segment: 'hook',
        beatKind: 'still',
        durationSec: 4,
        overlayText: '先做最重要的事',
        overlaySubtext: '《專注力》',
        dialogue: '先做最重要的事',
      }),
      overlayBeat({ segment: 'claim', durationSec: 3 }),
      overlayBeat({
        segment: 'title',
        beatKind: 'title',
        durationSec: 3,
        description: '',
        location: '',
      }),
    ],
  })

  it('金句型：腳本的疊字寫進不動的格子（主文字、小字），旁白念同一句；其他格沒有；檢查器沒有錯誤；復原一步全退回', async () => {
    const llm = scripted(ideaScript)
    const h = setup({ mockLlm: llm.llm })
    const status = await h.trailer.plan({ text: STORY, kind: 'idea', targetSec: 10 })
    expect(status.errors).toEqual([])
    const [first, second] = h.shots.list().shots
    expect(first?.beatKind).toBe('still')
    expect(first?.overlay).toEqual({ text: '先做最重要的事', subtext: '《專注力》' })
    expect(first?.dialogue).toBe('先做最重要的事')
    expect(second?.overlay).toBeUndefined()
    h.history.undo()
    expect(h.shots.list().shots).toHaveLength(0)
  })

  it('重新檢查（trailer.status）也看得到疊字：存進去之後把疊字改太長，檢查器擋下', async () => {
    const llm = scripted(ideaScript)
    const h = setup({ mockLlm: llm.llm })
    await h.trailer.plan({ text: STORY, kind: 'idea', targetSec: 10 })
    const first = h.shots.list().shots[0]
    if (!first) throw new Error('沒有格子')
    h.shots.update(first.id, { overlay: { text: '字'.repeat(30), subtext: '' } })
    expect(h.trailer.status().errors.map((e) => e.code)).toContain('overlay_too_long')
  })

  it('劇情型：模型寫了疊字也當沒寫，鏡頭上沒有 overlay', async () => {
    const llm = scripted(ideaScript)
    const h = setup({ mockLlm: llm.llm })
    await h.trailer.plan({ text: STORY, kind: 'story', targetSec: 10 })
    expect(h.shots.list().shots.every((s) => s.overlay === undefined)).toBe(true)
  })
})
