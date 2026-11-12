import {
  TrailerSettingsSchema,
  checkTrailerScript,
  type LlmRequest,
  type TrailerScript,
} from '@svs/schema'
import { describe, expect, it } from 'vitest'

import type { StudioServices } from './services'
import {
  ensureTagline,
  repairScript,
  toCheckBeat,
  truncateUnits,
  writeTrailerScript,
} from './trailer'

const beat = (extra: Record<string, unknown> = {}) => ({
  segment: '',
  beatKind: 'video' as const,
  durationSec: 2,
  description: '畫面',
  action: '',
  size: 'medium' as const,
  angle: 'eye_level' as const,
  cameraMove: null,
  characters: [],
  location: '',
  dialogue: '',
  cardText: '',
  cardSubtext: '',
  ...extra,
})

const script = (beats: ReturnType<typeof beat>[], title = '黑藤裂谷'): TrailerScript => ({
  title,
  music: '留白、推進、停一拍、重音',
  beats,
})

/** 一份加總 10 秒、過檢查的腳本：4 秒影片＋3 秒字卡＋3 秒片名卡。 */
const good = (): TrailerScript =>
  script([
    beat({ durationSec: 4 }),
    beat({ beatKind: 'card', durationSec: 3, description: '', cardText: '有些光' }),
    beat({ beatKind: 'title', durationSec: 3, description: '' }),
  ])

const settings = TrailerSettingsSchema.parse({ targetSec: 10, title: '黑藤裂谷' })

/** 假的 studio：依序回傳給定的回答。 */
function studioOf(answers: unknown[]) {
  const requests: LlmRequest[] = []
  const studio = {
    generate: (request: LlmRequest) => {
      requests.push(request)
      const answer = answers[Math.min(requests.length - 1, answers.length - 1)]
      return Promise.resolve({
        output: {
          kind: 'text' as const,
          text: typeof answer === 'string' ? answer : JSON.stringify(answer),
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        provider: 'mock',
        jobId: `job${String(requests.length)}`,
        costUsd: 0.01,
      })
    },
  } as unknown as StudioServices
  return { studio, requests }
}

const input = {
  modelId: 'm',
  text: '故事',
  settings,
  guide: '',
  knownCharacters: [],
  style: 'realistic' as const,
}
const ctx = { signal: new AbortController().signal }

describe('writeTrailerScript', () => {
  it('第一次就過：不重寫、不修正，加總剛好', async () => {
    const { studio, requests } = studioOf([good()])
    const result = await writeTrailerScript(studio, input, ctx)
    expect(requests).toHaveLength(1)
    expect(result).toMatchObject({ retried: false, fixes: [] })
    expect(result.check.totalSec).toBeCloseTo(10, 6)
    expect(result.costUsd).toBeCloseTo(0.01, 6)
  })

  it('加總差 2 秒：把檢查器的白話錯誤退回重寫；第二次對了就用第二次；兩次的花費都算', async () => {
    const bad = good()
    bad.beats[0] = beat({ durationSec: 6 })
    const { studio, requests } = studioOf([bad, good()])
    const result = await writeTrailerScript(studio, input, ctx)
    expect(requests).toHaveLength(2)
    const feedback = requests[1]?.messages.at(-1)?.content ?? ''
    expect(feedback).toContain('沒有通過檢查')
    expect(feedback).toMatch(/12(\.0)? 秒/)
    expect(result.retried).toBe(true)
    expect(result.fixes).toEqual([])
    expect(result.costUsd).toBeCloseTo(0.02, 6)
  })

  it('重寫後還是差 2 秒：程式把各格調成剛好等於目標（每格整數格、字卡不低於最短停留）', async () => {
    const bad = good()
    bad.beats[0] = beat({ durationSec: 6 })
    const { studio, requests } = studioOf([bad])
    const result = await writeTrailerScript(studio, input, ctx)
    expect(requests).toHaveLength(2)
    expect(result.retried).toBe(true)
    expect(result.fixes.join('')).toContain('10')
    const total = result.script.beats.reduce((sum, b) => sum + b.durationSec, 0)
    expect(total).toBeCloseTo(10, 6)
    for (const b of result.script.beats)
      expect(Math.abs(b.durationSec * 24 - Math.round(b.durationSec * 24))).toBeLessThan(1e-6)
    expect(checkTrailerScript(result.script.beats.map(toCheckBeat), settings, 24).errors).toEqual(
      [],
    )
  })

  it('字卡 13 個字、旁白念不完：程式截短，寫在 fixes', async () => {
    const bad = good()
    bad.beats[0] = beat({
      durationSec: 4,
      dialogue: '這是一句很長很長很長很長很長的旁白，還有第二個逗號。第二句。',
    })
    bad.beats[1] = beat({
      beatKind: 'card',
      durationSec: 3,
      description: '',
      cardText: '一二三四五六七八九十一二三',
    })
    const { studio } = studioOf([bad])
    const result = await writeTrailerScript(studio, input, ctx)
    expect(result.fixes.length).toBeGreaterThanOrEqual(2)
    expect(result.script.beats[1]?.cardText).toBe('一二三四五六七八九十一二')
    expect((result.script.beats[0]?.dialogue ?? '').length).toBeLessThanOrEqual(16)
  })

  it('第一格是字卡：程式修不了，丟白話錯誤（不回傳任何腳本）', async () => {
    const bad = good()
    bad.beats[0] = beat({ beatKind: 'card', durationSec: 4, description: '', cardText: '開場' })
    const { studio } = studioOf([bad])
    await expect(writeTrailerScript(studio, input, ctx)).rejects.toMatchObject({
      userMessage: expect.stringContaining('第一格必須是畫面') as unknown,
    })
  })

  it('不是 JSON：generateStructured 試兩次後白話錯誤', async () => {
    const { studio, requests } = studioOf(['哈哈'])
    await expect(writeTrailerScript(studio, input, ctx)).rejects.toThrow()
    expect(requests).toHaveLength(2)
  })

  it('使用者沒給書名：用 AI 從文本取的書名（檢查器不再說缺書名）', async () => {
    const { studio } = studioOf([good()])
    const result = await writeTrailerScript(
      studio,
      { ...input, settings: TrailerSettingsSchema.parse({ targetSec: 10 }) },
      ctx,
    )
    expect(result.check.errors).toEqual([])
    expect(result.script.title).toBe('黑藤裂谷')
  })

  it('使用者給的標語：一個字不改地放上字卡；太長（超過 12 字）就丟錯，不截它', async () => {
    const withTag = {
      ...input,
      settings: TrailerSettingsSchema.parse({ targetSec: 10, title: 'x', tagline: '有些光要守著' }),
    }
    const ok = await writeTrailerScript(studioOf([good()]).studio, withTag, ctx)
    expect(ok.script.beats.some((b) => b.cardText === '有些光要守著')).toBe(true)
    const long = {
      ...input,
      settings: TrailerSettingsSchema.parse({
        targetSec: 10,
        title: 'x',
        tagline: '這是一句超過十二個字的標語文字啊啊',
      }),
    }
    await expect(writeTrailerScript(studioOf([good()]).studio, long, ctx)).rejects.toThrow()
  })
})

describe('小工具', () => {
  it('truncateUnits：中文截前 N 個字（標點不算字）；英文截前 N 個單字', () => {
    expect(truncateUnits('一二三，四五六', 4)).toBe('一二三，四')
    expect(truncateUnits('一二三', 5)).toBe('一二三')
    expect(truncateUnits('one two three four', 2)).toBe('one two')
  })

  it('ensureTagline：已經有就不動；沒有就換掉第一張字卡；沒有字卡不動', () => {
    const s = TrailerSettingsSchema.parse({ tagline: '標語' })
    expect(ensureTagline(good(), s).beats[1]?.cardText).toBe('標語')
    const has = good()
    has.beats[1] = beat({ beatKind: 'card', description: '', cardText: '標語' })
    expect(ensureTagline(has, s)).toBe(has)
    const none = script([beat(), beat({ beatKind: 'title', description: '' })])
    expect(ensureTagline(none, s)).toBe(none)
  })

  it('repairScript：目標放不下時不亂改秒數（交給檢查器擋）', () => {
    const tiny = TrailerSettingsSchema.parse({ targetSec: 10, title: 'x' })
    const many = script([
      beat({ durationSec: 1 }),
      ...Array.from({ length: 4 }, () =>
        beat({
          beatKind: 'card',
          durationSec: 3,
          description: '',
          cardText: '十二個字的字卡文字呀呀',
        }),
      ),
      beat({ beatKind: 'title', durationSec: 3, description: '' }),
    ])
    const repaired = repairScript(many, tiny)
    expect(
      checkTrailerScript(repaired.script.beats.map(toCheckBeat), tiny, 24).errors.length,
    ).toBeGreaterThan(0)
  })
})
