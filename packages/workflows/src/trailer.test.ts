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
  MUSIC_END_FADE_SEC,
  MUSIC_EXTRA_SEC,
  musicSpansOf,
  musicStyleHint,
  repairScript,
  toCheckBeat,
  trailerMusicPrompt,
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
  places: [],
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

describe('trailerMusicPrompt：配樂描述跟著腳本', () => {
  const settings = TrailerSettingsSchema.parse({
    kind: 'story',
    targetSec: 30,
    musicMood: '緊張、壓迫',
  })
  // 三段式腳本：鉤子 0～6 秒、升高 6～26 秒、片名 26～30 秒
  const spans = [
    { key: 'hook', startSec: 0, endSec: 6 },
    { key: 'escalate', startSec: 6, endSec: 26 },
    { key: 'title', startSec: 26, endSec: 30 },
  ]
  const text = trailerMusicPrompt({ settings, spans, filmSec: 30 })

  it('每一段的起訖秒數與情緒都寫進去；片名前短暫靜音、結尾一個重音、純音樂不要人聲、使用者選的情緒', () => {
    expect(text).toContain('0.0–6.0 s')
    expect(text).toContain('6.0–26.0 s')
    expect(text).toContain('26.0–30.0 s')
    expect(text).toMatch(/hook/)
    expect(text).toMatch(/escalate/)
    expect(text).toMatch(/title/)
    expect(text).toMatch(/silence/i)
    // 靜音在片名前 0.8 秒（25.2～26.0），重音落在片名出現的 26 秒
    expect(text).toContain('25.2–26.0 s')
    expect(text).toMatch(/final accent[^.]*26\.0 s/i)
    expect(text).toMatch(/instrumental/i)
    expect(text).toMatch(/no vocals/i)
    expect(text).toContain('緊張、壓迫')
  })

  it('要的長度是成品長度加 3 秒，結尾淡出 1.5 秒（常數與描述一致）', () => {
    expect(MUSIC_EXTRA_SEC).toBe(3)
    expect(MUSIC_END_FADE_SEC).toBe(1.5)
    expect(text).toContain('33 s')
    expect(text).toContain('1.5 s fade-out')
  })

  it('沒有使用者情緒就不寫那一句；沒有片名段（懸念短版以外的舊腳本）就不寫靜音與重音位置', () => {
    const plain = trailerMusicPrompt({
      settings: TrailerSettingsSchema.parse({ musicMood: '' }),
      spans: [{ key: 'hook', startSec: 0, endSec: 10 }],
      filmSec: 10,
    })
    expect(plain).not.toMatch(/Overall mood/)
    expect(plain).not.toMatch(/before the title/i)
    expect(plain).toMatch(/final accent/i)
  })

  it('沒有段落（舊專案的腳本沒存段落）：照類型模板的比例排各段', () => {
    const derived = musicSpansOf(undefined, 'story', 30)
    expect(derived.map((s) => s.key)).toEqual([
      'hook',
      'world',
      'turn',
      'escalate',
      'suspense',
      'title',
    ])
    expect(derived[0]).toMatchObject({ startSec: 0 })
    expect(derived.at(-1)?.endSec).toBeCloseTo(30, 5)
  })

  it('musicSpansOf：連續同一段的格子併成一段，秒數照格長累加', () => {
    const shots = [
      { segment: 'hook', durationSec: 2 },
      { segment: 'hook', durationSec: 1.5 },
      { segment: 'escalate', durationSec: 3 },
      { segment: 'title', durationSec: 3.5 },
    ]
    expect(musicSpansOf(shots, 'story', 10)).toEqual([
      { key: 'hook', startSec: 0, endSec: 3.5 },
      { key: 'escalate', startSec: 3.5, endSec: 6.5 },
      { key: 'title', startSec: 6.5, endSec: 10 },
    ])
  })
})

describe('musicStyleHint：把模型寫的 musicBrief 整理成「風格、配器」那一句', () => {
  it('人聲類的字（英文、中文）整句拿掉；有時間碼的句子也拿掉（時間軸另外產生）；只留風格與配器', () => {
    const brief =
      '低沉的大提琴與合成器鋪底，緩慢推進。0:00–0:06 留白。人聲合唱在副歌進入。Dark cello and analog synth pads; choir enters at the chorus. A solo female vocal over strings. 重音收尾，停一拍。Sparse piano, 6 s of silence.'
    const hint = musicStyleHint(brief)
    expect(hint).toContain('低沉的大提琴與合成器鋪底')
    expect(hint).toContain('Dark cello and analog synth pads')
    expect(hint).toContain('Sparse piano')
    for (const banned of ['人聲', '合唱', 'choir', 'vocal', '0:00', '6 s of silence', 'chorus']) {
      expect(hint.toLowerCase()).not.toContain(banned.toLowerCase())
    }
  })
  it('沒有可用的句子（全是人聲或時間碼）、或空字串：回空字串', () => {
    expect(musicStyleHint('')).toBe('')
    expect(musicStyleHint('女聲獨唱。Lyrics about love, sung softly. 12 秒開始進鼓。')).toBe('')
  })
  it('太長截斷在 240 字內', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Warm strings number ${String(i)}`).join('. ')
    expect(musicStyleHint(long).length).toBeLessThanOrEqual(240)
  })
})

describe('trailerMusicPrompt：模型寫的風格句接進來（T6c）', () => {
  const spans = [
    { key: 'hook', startSec: 0, endSec: 6 },
    { key: 'title', startSec: 6, endSec: 10 },
  ]
  it('有 musicBrief：多一句風格與配器，放在情緒之後、時間軸之前；人聲字不會進去', () => {
    const text = trailerMusicPrompt({
      settings: { musicMood: '緊張', musicBrief: 'Dark cello and synth pads. 女聲合唱。' },
      spans,
      filmSec: 10,
    })
    expect(text).toMatch(
      /Overall mood: 緊張\. Style and instrumentation \(from the script\): Dark cello and synth pads\. Timeline:/,
    )
    expect(text).not.toContain('合唱')
  })
  it('沒有 musicBrief 或整段被濾光：跟沒有這個欄位的時候一模一樣', () => {
    const base = trailerMusicPrompt({ settings: { musicMood: '緊張' }, spans, filmSec: 10 })
    expect(
      trailerMusicPrompt({ settings: { musicMood: '緊張', musicBrief: '' }, spans, filmSec: 10 }),
    ).toBe(base)
    expect(
      trailerMusicPrompt({
        settings: { musicMood: '緊張', musicBrief: '女聲獨唱。' },
        spans,
        filmSec: 10,
      }),
    ).toBe(base)
  })
})
