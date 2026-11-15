import {
  TrailerScriptSchema,
  TrailerSettingsSchema,
  checkTrailerScript,
  type LlmRequest,
  type TrailerBeat,
} from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { capWeights, demoTrailerScript, parseTrailerRequest } from './demo-trailer'

const request = (
  story: string,
  kind: 'story' | 'teaser' | 'idea',
  sec: number,
  narration = true,
): LlmRequest => ({
  capability: 'llm',
  modelId: 'mock/llm',
  messages: [
    {
      role: 'user',
      content: `故事：\n${story}\n\n請寫預告片腳本。類型：${kind}。目標總長：${String(sec)} 秒。旁白：${narration ? '開' : '關'}。`,
    },
  ],
})

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

const beatsOf = (script: ReturnType<typeof TrailerScriptSchema.parse>): TrailerBeat[] =>
  script.beats.map((b) => ({
    beatKind: b.beatKind,
    durationSec: b.durationSec,
    ...(b.dialogue === '' ? {} : { dialogue: b.dialogue }),
    ...(b.beatKind === 'card' ? { card: { text: b.cardText, subtext: b.cardSubtext } } : {}),
    ...(b.overlayText === ''
      ? {}
      : { overlay: { text: b.overlayText, subtext: b.overlaySubtext } }),
    segment: b.segment,
    ...(b.location === '' ? {} : { location: b.location }),
  }))

describe('示範模式的假腳本', () => {
  it('不是寫腳本的請求就不處理（照原本的示範回覆）', () => {
    expect(
      demoTrailerScript({
        capability: 'llm',
        modelId: 'm',
        messages: [{ role: 'user', content: '你好' }],
      }),
    ).toBeUndefined()
  })

  it('讀得到 idea 類型', () => {
    expect(parseTrailerRequest(request(STORY, 'idea', 30))).toMatchObject({ kind: 'idea' })
  })

  it('讀得到類型、目標秒數、旁白開關', () => {
    expect(parseTrailerRequest(request(STORY, 'teaser', 15, false))).toMatchObject({
      kind: 'teaser',
      targetSec: 15,
      narration: false,
    })
  })

  for (const kind of ['story', 'teaser', 'idea'] as const) {
    for (const sec of [10, 15, 30, 60, 90, 120]) {
      it(`${kind}、${String(sec)} 秒：格式對、加總剛好、一定過檢查器（沒有 error）`, () => {
        const script = TrailerScriptSchema.parse(demoTrailerScript(request(STORY, kind, sec)))
        const settings = TrailerSettingsSchema.parse({ kind, targetSec: sec, title: script.title })
        const check = checkTrailerScript(beatsOf(script), settings, 24)
        expect(check.errors).toEqual([])
        expect(check.totalSec).toBeCloseTo(sec, 6)
        expect(script.beats[0]?.beatKind === 'card' || script.beats[0]?.beatKind === 'title').toBe(
          false,
        )
        expect(script.beats.at(-1)?.beatKind).toBe('title')
        expect(script.music).not.toBe('')
      })
    }
  }

  // 示範是讓人看「做好是什麼樣子」：要先過自己的準則——越到後面越短，不能有「後面三分之一沒比前面短」的節奏提醒
  // （片尾那一行的提醒可以留，那是在請使用者填）。
  // 兩種算法都要過：寫腳本當下（每格帶 segment，「懸念」那格不算）、以及腳本存進專案之後（資料庫不存 segment，
  // 畫面上的預告片狀態用這種算法，所有非片名卡的格子都算）。
  for (const withSegment of [true, false]) {
    it(`10～120 秒（每 1 秒一個）、兩種類型、旁白開關：示範腳本沒有節奏提醒（${withSegment ? '寫的當下' : '存進專案之後'}）`, () => {
      const bad: string[] = []
      for (const kind of ['story', 'teaser'] as const) {
        for (let sec = 10; sec <= 120; sec += 1) {
          for (const narration of [true, false]) {
            const script = TrailerScriptSchema.parse(
              demoTrailerScript(request(STORY, kind, sec, narration)),
            )
            const settings = TrailerSettingsSchema.parse({
              kind,
              targetSec: sec,
              title: script.title,
            })
            const beats = beatsOf(script).map((b) =>
              withSegment ? b : { ...b, segment: undefined },
            )
            const check = checkTrailerScript(beats, settings, 24)
            if (check.warnings.some((w) => w.code === 'no_escalation')) {
              bad.push(`${kind} ${String(sec)}s narration=${String(narration)}`)
            }
          }
        }
      }
      expect(bad).toEqual([])
    })
  }

  // 示範是讓人看「做好是什麼樣子」：字很少的字卡、片名卡、單一畫面都不能停太久（60、90 秒要多排幾格才不會每格都很長）
  it('15～120 秒、兩種類型、旁白開關：示範腳本沒有「停太久」的提醒；長片畫面格比較多', () => {
    const bad: string[] = []
    const pictures: Record<string, number> = {}
    for (const kind of ['story', 'teaser'] as const) {
      for (const sec of [15, 20, 30, 45, 60, 75, 90, 105, 120]) {
        for (const narration of [true, false]) {
          const script = TrailerScriptSchema.parse(
            demoTrailerScript(request(STORY, kind, sec, narration)),
          )
          const settings = TrailerSettingsSchema.parse({
            kind,
            targetSec: sec,
            title: script.title,
          })
          const check = checkTrailerScript(beatsOf(script), settings, 24)
          for (const w of check.warnings) {
            if (w.code.endsWith('_hold_too_long')) {
              bad.push(`${kind} ${String(sec)}s narration=${String(narration)} ${w.code}`)
            }
          }
          if (narration) {
            pictures[`${kind}${String(sec)}`] = script.beats.filter(
              (b) => b.beatKind === 'video' || b.beatKind === 'still',
            ).length
          }
        }
      }
    }
    expect(bad).toEqual([])
    // 60 秒以前最多 10 個畫面；60、90 秒要比 10 個多
    expect(pictures.story60).toBeGreaterThan(10)
    expect(pictures.story90).toBeGreaterThan(pictures.story60 ?? 0)
    expect(pictures.teaser90).toBeGreaterThan(10)
  })

  for (const [kind, sec] of [
    ['story', 30],
    ['story', 60],
    ['story', 120],
    ['teaser', 15],
    ['teaser', 30],
    ['teaser', 90],
    ['idea', 30],
    ['idea', 60],
    ['idea', 120],
  ] as const) {
    it(`${kind}、${String(sec)} 秒：每一格的畫面描述、旁白、字卡都不重複（看起來不像壞掉）`, () => {
      const script = TrailerScriptSchema.parse(demoTrailerScript(request(STORY, kind, sec)))
      const texts = (pick: (b: (typeof script.beats)[number]) => string) =>
        script.beats.map(pick).filter((x) => x !== '')
      for (const list of [
        texts((b) => b.description),
        texts((b) => b.dialogue),
        texts((b) => b.cardText),
      ]) {
        expect(new Set(list).size).toBe(list.length)
      }
      // 書名也不跟任何一格的描述一樣
      expect(texts((b) => b.description)).not.toContain(script.title)
    })
  }

  it('帶 1～2 個角色、1～2 個地點；字卡與片名卡沒有地點', () => {
    const script = TrailerScriptSchema.parse(demoTrailerScript(request(STORY, 'story', 30)))
    const pictures = script.beats.filter((b) => b.beatKind === 'video' || b.beatKind === 'still')
    const heroes = new Set(pictures.flatMap((b) => b.characters))
    const places = new Set(pictures.map((b) => b.location))
    expect(heroes.size).toBeGreaterThanOrEqual(1)
    expect(heroes.size).toBeLessThanOrEqual(2)
    expect(places.size).toBeGreaterThanOrEqual(1)
    expect(places.size).toBeLessThanOrEqual(2)
    expect(places.has('')).toBe(false)
    expect(
      script.beats
        .filter((b) => b.beatKind === 'card' || b.beatKind === 'title')
        .every((b) => b.location === ''),
    ).toBe(true)
  })

  it('不要旁白：每一格的旁白都是空的', () => {
    const script = TrailerScriptSchema.parse(demoTrailerScript(request(STORY, 'story', 30, false)))
    expect(script.beats.every((b) => b.dialogue === '')).toBe(true)
  })

  it('文本帶著「暢銷」「獲獎」這類字：示範的旁白與描述不會用它（規則 11）', () => {
    const script = TrailerScriptSchema.parse(
      demoTrailerScript(request('這本暢銷小說得獎無數。她守著燈。', 'story', 30)),
    )
    const text = script.beats.map((b) => `${b.description}${b.dialogue}${b.cardText}`).join('')
    expect(text).not.toMatch(/暢銷|得獎/)
    const settings = TrailerSettingsSchema.parse({ targetSec: 30, title: 'x' })
    expect(checkTrailerScript(beatsOf(script), settings, 24).errors).toEqual([])
  })

  it('文本帶著示範記號：故意寫壞（第一格是字卡），檢查器擋得下', () => {
    const script = TrailerScriptSchema.parse(
      demoTrailerScript(request(`${STORY}【腳本不合格】`, 'story', 30)),
    )
    expect(script.beats[0]?.beatKind).toBe('card')
    const settings = TrailerSettingsSchema.parse({ targetSec: 30, title: 'x' })
    expect(checkTrailerScript(beatsOf(script), settings, 24).errors.map((e) => e.code)).toContain(
      'first_beat_not_picture',
    )
  })

  it('同樣的輸入永遠得到同樣的腳本', () => {
    const a = JSON.stringify(demoTrailerScript(request(STORY, 'story', 30)))
    const b = JSON.stringify(demoTrailerScript(request(STORY, 'story', 30)))
    expect(a).toBe(b)
  })
})

describe('示範模式的假腳本：語錄體', () => {
  const QUOTES_TEXT =
    '寵辱不驚，閒看庭前花開花落。去留無意，漫隨天外雲卷雲舒。得意時毋忘失意。有生趣的是活潑。三思而後行。靜坐常思己過。讀書不忘本分。'
  const flat = (text: string): string => text.replace(/[\s\p{P}]/gu, '').toLowerCase()
  const scriptOf = (sec: number, narration = true, text = QUOTES_TEXT) =>
    TrailerScriptSchema.parse(demoTrailerScript(request(text, 'idea', sec, narration)))

  it('短句夠多的文本：form 是 quotes，3～5 句金句逐字取自原文，疊在不動的格子上；一定過檢查器（含原文檢查）', () => {
    const bad: string[] = []
    for (let sec = 20; sec <= 120; sec += 5) {
      for (const narration of [true, false]) {
        const script = scriptOf(sec, narration)
        // 金句之間夾的沒有字的畫面也屬於 quote 段，不算金句
        const quotes = script.beats.filter((b) => b.segment === 'quote' && b.overlayText !== '')
        const label = `${String(sec)}s narration=${String(narration)}`
        if (script.form !== 'quotes') bad.push(`${label}: form ${script.form}`)
        if (quotes.length < 3 || quotes.length > 5)
          bad.push(`${label}: ${String(quotes.length)} 句`)
        for (const q of quotes) {
          if (q.beatKind !== 'still') bad.push(`${label}: 金句不是 still`)
          if (!flat(QUOTES_TEXT).includes(flat(q.overlayText)))
            bad.push(`${label}: ${q.overlayText} 不在原文`)
        }
        const settings = TrailerSettingsSchema.parse({
          kind: 'idea',
          targetSec: sec,
          title: script.title,
          sourceText: QUOTES_TEXT,
        })
        const check = checkTrailerScript(beatsOf(script), settings, 24)
        const problems = [
          ...check.errors,
          ...check.warnings.filter((w) => w.code !== 'title_no_action'),
        ]
        if (problems.length > 0 || Math.abs(check.totalSec - sec) > 0.05) {
          bad.push(`${label}: ${problems.map((p) => p.code).join(',')}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('目標太短放不下（15 秒）、或文本不是一句一句的短句：照一般的觀點型（form 是 argument）', () => {
    expect(scriptOf(15).form).toBe('argument')
    const prose =
      '這本書說：越忙越沒進度，是因為優先順序錯了。先做最重要的一件事，把待辦清單砍掉一半。'
    expect(scriptOf(30, true, prose).form).toBe('argument')
  })

  it('主視覺 3 個以上、沒有角色與黑底字卡', () => {
    const script = scriptOf(60)
    const visuals = new Set(
      script.beats.filter((b) => b.beatKind !== 'title').map((b) => b.location),
    )
    expect(visuals.size).toBeGreaterThanOrEqual(3)
    expect(script.beats.every((b) => b.characters.length === 0)).toBe(true)
    expect(script.beats.filter((b) => b.beatKind === 'card')).toHaveLength(0)
  })
})

describe('示範模式的假腳本：觀點型', () => {
  const IDEA_TEXT =
    '這本書說：越忙越沒進度，是因為優先順序錯了。先做最重要的一件事，把待辦清單砍掉一半。'
  const scriptOf = (sec: number, narration = true) =>
    TrailerScriptSchema.parse(demoTrailerScript(request(IDEA_TEXT, 'idea', sec, narration)))
  const pictures = (script: ReturnType<typeof scriptOf>) =>
    script.beats.filter((b) => b.beatKind === 'video' || b.beatKind === 'still')

  it('10～120 秒（每 1 秒一個）、旁白開關：一定過檢查器，沒有 error 也沒有主視覺或節奏提醒', () => {
    const bad: string[] = []
    for (let sec = 10; sec <= 120; sec += 1) {
      for (const narration of [true, false]) {
        const script = scriptOf(sec, narration)
        const settings = TrailerSettingsSchema.parse({
          kind: 'idea',
          targetSec: sec,
          title: script.title,
        })
        const check = checkTrailerScript(beatsOf(script), settings, 24)
        const problems = [
          ...check.errors,
          ...check.warnings.filter((w) => w.code !== 'title_no_action'),
        ]
        if (problems.length > 0 || Math.abs(check.totalSec - sec) > 0.05) {
          bad.push(
            `${String(sec)}s narration=${String(narration)}: ${problems.map((p) => p.code).join(',')}`,
          )
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('沒有角色：每一格 characters 都是空的；主視覺 3～5 個，字卡與片名卡沒有地點', () => {
    for (const sec of [15, 30, 60, 120]) {
      const script = scriptOf(sec)
      expect(script.beats.every((b) => b.characters.length === 0)).toBe(true)
      const visuals = new Set(pictures(script).map((b) => b.location))
      expect(visuals.has('')).toBe(false)
      expect(visuals.size).toBeGreaterThanOrEqual(3)
      expect(visuals.size).toBeLessThanOrEqual(5)
      expect(script.places.map((p) => p.name).sort()).toEqual([...visuals].sort())
      expect(
        script.beats
          .filter((b) => b.beatKind === 'card' || b.beatKind === 'title')
          .every((b) => b.location === ''),
      ).toBe(true)
    }
  })

  it('金句壓在畫面上：30 秒有 5 個疊字格（鉤子、主張、三個收穫），沒有黑底字卡；段落只用 hook、claim、gains、title', () => {
    const script = scriptOf(30)
    const overlays = script.beats.filter((b) => b.overlayText !== '')
    expect(overlays).toHaveLength(5)
    expect(script.beats.filter((b) => b.beatKind === 'card')).toHaveLength(0)
    expect(overlays.every((b) => b.beatKind === 'still')).toBe(true)
    expect(new Set(script.beats.map((b) => b.segment))).toEqual(
      new Set(['hook', 'claim', 'gains', 'title']),
    )
    expect(script.beats[0]?.beatKind).toBe('still')
    expect(script.beats[0]?.overlayText).not.toBe('')
  })

  it('15～120 秒、旁白開關：疊字只放在不動的格子；旁白要嘛是空的、要嘛就是疊的那一句；黑底字卡最多 2 張；30 秒以上至少 3 個疊字格', () => {
    for (const sec of [15, 20, 30, 45, 60, 90, 120]) {
      for (const narration of [true, false]) {
        const script = scriptOf(sec, narration)
        const label = `${String(sec)}s narration=${String(narration)}`
        const overlays = script.beats.filter((b) => b.overlayText !== '')
        expect(
          overlays.every((b) => b.beatKind === 'still'),
          label,
        ).toBe(true)
        for (const b of overlays) {
          expect(b.dialogue === '' || b.dialogue === b.overlayText, label).toBe(true)
          if (!narration) expect(b.dialogue, label).toBe('')
        }
        expect(script.beats.filter((b) => b.beatKind === 'card').length, label).toBeLessThanOrEqual(
          2,
        )
        if (sec >= 30) expect(overlays.length, label).toBeGreaterThanOrEqual(3)
        // 其他格（沒有疊字的畫面）不念旁白：旁白全都是疊字那一句
        for (const b of script.beats.filter((x) => x.overlayText === '')) {
          expect(b.dialogue, label).toBe('')
        }
      }
    }
  })

  it('地點外觀只寫地方（沒有人物、沒有動作）；旁白是說明的口吻、不是問句（鉤子除外）', () => {
    const script = scriptOf(30)
    expect(script.places.length).toBeGreaterThanOrEqual(3)
    for (const place of script.places) expect(place.look).not.toBe('')
    // 鉤子是一個問句（疊在畫面上，旁白照念）；其他段的旁白用肯定句
    const lines = script.beats
      .filter((b) => b.segment !== 'hook')
      .map((b) => b.dialogue)
      .filter((d) => d !== '')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).not.toMatch(/[？?]/)
  })

  it('英文介面：字卡、旁白、主視覺都是英文', async () => {
    const { setLocale } = await import('@svs/schema')
    setLocale('en')
    try {
      const script = scriptOf(30)
      const words = [
        ...script.beats.map((b) => `${b.cardText} ${b.dialogue}`),
        ...script.places.map((p) => p.name),
      ]
      expect(words.join(' ')).not.toMatch(/\p{Script=Han}/u)
    } finally {
      setLocale('zh-TW')
    }
  })
})

describe('示範模式的假腳本：角色的外觀（people）', () => {
  const scriptOf = (kind: 'story' | 'teaser' | 'idea', sec = 30) =>
    TrailerScriptSchema.parse(demoTrailerScript(request(STORY, kind, sec)))

  for (const kind of ['story', 'teaser'] as const) {
    it(`${kind}：people 兩筆，名字跟 characters 用到的完全一樣，長相與服裝都有字`, () => {
      const script = scriptOf(kind)
      const used = new Set(script.beats.flatMap((b) => b.characters))
      expect([...used].length).toBeGreaterThanOrEqual(1)
      expect(script.people.map((p) => p.name).sort()).toEqual([...used].sort())
      for (const person of script.people) {
        expect(person.look.length).toBeGreaterThanOrEqual(15)
        expect(person.outfit.length).toBeGreaterThanOrEqual(8)
        // 只寫看得到的：不出現「性格」「勇敢」這類
        expect(`${person.look}${person.outfit}`).not.toMatch(/個性|性格|勇敢|善良/)
      }
    })
  }

  it('觀點型沒有角色，也沒有 people', () => {
    expect(scriptOf('idea').people).toEqual([])
  })

  it('英文介面：外觀是英文', async () => {
    const { setLocale } = await import('@svs/schema')
    setLocale('en')
    try {
      const script = scriptOf('story')
      expect(script.people.length).toBeGreaterThan(0)
      expect(script.people.map((p) => `${p.look}${p.outfit}`).join('')).not.toMatch(
        /\p{Script=Han}/u,
      )
    } finally {
      setLocale('zh-TW')
    }
  })
})

describe('capWeights：比重換成秒數，每格不超過上限', () => {
  it('沒有超過上限：照比重分配，加總剛好', () => {
    const out = capWeights([1, 2, 1], 8, 5)
    expect(out).toEqual([2, 4, 2])
  })

  it('有格子超過上限：削到上限，多出來的時間分給其他格，加總不變', () => {
    const out = capWeights([6, 1, 1], 12, 5)
    expect(out[0]).toBe(5)
    expect(out[1]).toBeCloseTo(3.5, 9)
    expect(out[2]).toBeCloseTo(3.5, 9)
    expect(out.reduce((sum, v) => sum + v, 0)).toBeCloseTo(12, 9)
  })

  it('全部都到上限還排不滿：每格都是上限（加總比要的短）', () => {
    expect(capWeights([1, 1], 20, 5)).toEqual([5, 5])
    expect(capWeights([], 10, 5)).toEqual([])
  })
})
