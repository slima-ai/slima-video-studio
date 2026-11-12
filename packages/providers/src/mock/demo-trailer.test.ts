import {
  TrailerScriptSchema,
  TrailerSettingsSchema,
  checkTrailerScript,
  type LlmRequest,
  type TrailerBeat,
} from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { demoTrailerScript, parseTrailerRequest } from './demo-trailer'

const request = (
  story: string,
  kind: 'story' | 'teaser',
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
    segment: b.segment,
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

  it('讀得到類型、目標秒數、旁白開關', () => {
    expect(parseTrailerRequest(request(STORY, 'teaser', 15, false))).toMatchObject({
      kind: 'teaser',
      targetSec: 15,
      narration: false,
    })
  })

  for (const kind of ['story', 'teaser'] as const) {
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
