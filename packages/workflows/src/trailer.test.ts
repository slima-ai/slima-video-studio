import {
  TrailerSettingsSchema,
  checkTrailerScript,
  type LlmRequest,
  type TrailerScript,
} from '@svs/schema'
import { describe, expect, it } from 'vitest'

import type { StudioServices } from './services'
import {
  PEOPLE_LOOK_INSTRUCTION,
  ensureTagline,
  MUSIC_END_FADE_SEC,
  MUSIC_EXTRA_SEC,
  musicSpansOf,
  moveShortToStill,
  musicStyleHint,
  repairScript,
  toCheckBeat,
  trailerMusicPrompt,
  trailerSystemPrompt,
  trailerUserMessage,
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
  people: [],
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

  it('旁白太長被退回：給模型的是原本的完整訊息（含「請把這句縮短」），不是給使用者看的短版', async () => {
    const bad = good()
    bad.beats[0] = beat({ durationSec: 4, dialogue: '一二三四五六七八九十甲乙丙丁戊己庚辛' })
    const { studio, requests } = studioOf([bad, good()])
    await writeTrailerScript(studio, input, ctx)
    const feedback = requests[1]?.messages.at(-1)?.content ?? ''
    expect(feedback).toContain('請把這句縮短')
    expect(feedback).not.toContain('旁白太長：')
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

  it('會動的格只有 1 秒（比 1.5 秒短）：程式自動改成不動的畫面，寫在 fixes；其他格與總長不變', async () => {
    const short = script([
      beat({ durationSec: 3 }),
      beat({ durationSec: 1 }),
      beat({ beatKind: 'card', durationSec: 3, description: '', cardText: '有些光' }),
      beat({ beatKind: 'title', durationSec: 3, description: '' }),
    ])
    const { studio, requests } = studioOf([short])
    const result = await writeTrailerScript(studio, input, ctx)
    expect(requests).toHaveLength(1)
    expect(result.script.beats.map((b) => b.beatKind)).toEqual(['video', 'still', 'card', 'title'])
    expect(result.script.beats.map((b) => b.durationSec)).toEqual([3, 1, 3, 3])
    expect(result.fixes).toHaveLength(1)
    expect(result.fixes[0]).toContain('2')
    expect(result.check.warnings.map((w) => w.code)).not.toContain('moving_beat_too_short')
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

describe('moveShortToStill：太短的會動格改成不動', () => {
  it('短於 1.5 秒的會動格改成不動（照成品的整數格算）；剛好 1.5 秒、不動格、字卡、片名卡都不動；每改一格寫一句', () => {
    const before = script([
      beat({ durationSec: 1.45 }),
      beat({ durationSec: 1.5 }),
      beat({ beatKind: 'still', durationSec: 1 }),
      beat({ durationSec: 0.75 }),
      beat({ beatKind: 'card', durationSec: 1, description: '', cardText: '字' }),
      beat({ beatKind: 'title', durationSec: 3, description: '' }),
    ])
    const { script: out, fixes } = moveShortToStill(before)
    expect(out.beats.map((b) => b.beatKind)).toEqual([
      'still',
      'video',
      'still',
      'still',
      'card',
      'title',
    ])
    expect(fixes).toHaveLength(2)
    expect(fixes[0]).toContain('1')
    expect(fixes[1]).toContain('4')
    // 沒有要改的：原樣回傳
    expect(moveShortToStill(good())).toEqual({ script: good(), fixes: [] })
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

// ---- 觀點型 ----

describe('觀點型：寫腳本的提示改成說明的口吻', () => {
  const ideaSettings = (patch: Record<string, unknown> = {}) =>
    TrailerSettingsSchema.parse({
      kind: 'idea',
      targetSec: 30,
      title: '深度工作',
      author: '某作者',
      ...patch,
    })
  const promptOf = (patch: Record<string, unknown> = {}, guide = '') =>
    trailerSystemPrompt({
      text: '這本書說：越忙越沒進度，是因為優先順序錯了。',
      settings: ideaSettings(patch),
      guide,
      knownCharacters: [],
      style: 'realistic',
    })

  it('是商業書、工具書的預告片：旁白是連續、有自信的說明口吻，對讀者說話，不賣關子、不用懸念', () => {
    const p = promptOf()
    expect(p).toContain('觀點型')
    expect(p).toContain('說明的口吻')
    expect(p).toContain('連續')
    expect(p).toContain('你')
    // 劇情型的那套（只給處境與問題、不給答案、懸念）不能出現在這裡
    expect(p).not.toContain('不給答案')
    expect(p).not.toContain('劇情摘要')
    expect(p).not.toContain('懸念')
    expect(p).not.toContain('越到後面剪得越快')
  })

  it('60 秒、作者與推薦語都有：依序列出六段、各段約幾秒；字卡是主角：全片最多 7 張（不是 4 張）', () => {
    const p = promptOf({ targetSec: 60, claims: ['每個經理人都該讀——某某雜誌'] })
    for (const key of ['hook', 'claim', 'gains', 'author', 'praise', 'title']) {
      expect(p).toContain(`${key}＝`)
    }
    expect(p).toContain('hook＝鉤子')
    expect(p).toContain('約 9 秒') // 60 秒的 15%
    expect(p).toContain('約 21 秒') // 三個收穫 35%
    expect(p).toContain('全片最多 7 張')
    expect(p).not.toContain('全片最多 4 張')
    expect(p).toContain('字卡比畫面重要')
  })

  it('30 秒：作者與推薦語最多擇一（兩個都有就留推薦語）；收穫最多 2 張字卡；沒給的那一段整段不印', () => {
    const both = promptOf({ claims: ['每個經理人都該讀——某某雜誌'] })
    expect(both).toContain('praise＝')
    expect(both).not.toContain('author＝')
    expect(both).toContain('收穫（最多 2 張字卡')
    expect(both).not.toContain('三個收穫（三張字卡')
    // 時間按比例分給留下的各段：hook .15 / claim .2 / gains .35 / praise .08 / title .1，總和 .88
    expect(both).toContain(
      'hook＝鉤子（一個反直覺的問句，或讀者的痛點：一張大字卡加一個隱喻畫面；第一格仍然是畫面），約 5.11 秒',
    )
    const authorOnly = promptOf()
    expect(authorOnly).toContain('author＝')
    expect(authorOnly).not.toContain('praise＝')
    const neither = promptOf({ author: '' })
    expect(neither).not.toContain('author＝')
    expect(neither).not.toContain('praise＝')
    // 沒給的那一段不再用「整支不要有…」另外說一次（提示不打架）
    for (const p of [both, authorOnly, neither]) {
      expect(p).not.toContain('整支不要有 praise')
      expect(p).not.toContain('整支不要有 author')
      expect(p).not.toContain('還給 gains')
    }
  })

  it('沒有角色：角色那一步改成 3～5 個主視覺，用場景卡（location＋places）；畫面是隱喻、不是人物劇情', () => {
    const p = promptOf()
    expect(p).toContain('characters 一律是空陣列')
    expect(p).toContain('3 到 5 個主視覺')
    expect(p).toContain('location')
    expect(p).toContain('places')
    expect(p).toContain('隱喻')
    expect(p).not.toContain('同一個角色在不同格子用同一個名字')
  })

  it('推薦語：沒提供就沒有那一段；提供了：只能逐字用那些原文', () => {
    const none = promptOf()
    expect(none).not.toContain('推薦語（praise')
    const given = promptOf({ claims: ['每個經理人都該讀——某某雜誌'] })
    expect(given).toContain('「每個經理人都該讀——某某雜誌」')
    expect(given).toContain('逐字')
  })

  it('作者：沒提供就沒有那一段；有的話只用名字與文本裡逐字照抄的經歷；書名、標語、上市資訊照劇情型的規矩帶進去', () => {
    expect(promptOf({ author: '' })).not.toContain('author 那一段')
    const withAuthor = promptOf()
    expect(withAuthor).toContain('author 那一段')
    expect(withAuthor).toContain('逐字照抄')
    const p = promptOf({ tagline: '少做，才做得好', endLine: '12 月 1 日上市' })
    expect(p).toContain('標語「少做，才做得好」')
    expect(p).toContain('12 月 1 日上市')
    expect(p).toContain('書名「深度工作」')
  })

  it('規則不變的部分照舊：加總剛好等於目標、第一格是畫面、片名卡、畫面裡不生成文字、不編造', () => {
    const p = promptOf({}, '這是準則')
    expect(p).toContain('剛好等於 30')
    expect(p).toContain('第一格必須是畫面')
    expect(p).toContain('片名卡')
    expect(p).toContain('不要寫招牌、字幕、標題這類畫面裡的文字')
    expect(p).toContain('只能用使用者提供的原文')
    expect(p).toContain('這是準則')
    expect(p).toContain('只輸出 JSON')
  })

  it('不要旁白時：每一格 dialogue 都是空字串', () => {
    expect(promptOf({ narration: false })).toContain('這一支不要旁白')
  })

  it('使用者訊息帶類型 idea（示範模式的假模型靠它認得）', () => {
    expect(trailerUserMessage('文字', ideaSettings())).toContain('類型：idea')
  })

  it('劇情型的提示一個字都沒變（逐字釘在 prompts-golden.test.ts）：仍然講處境與問題、最多 4 張', () => {
    const p = trailerSystemPrompt({
      text: '故事',
      settings: TrailerSettingsSchema.parse({ title: 'x' }),
      guide: '',
      knownCharacters: [],
      style: 'realistic',
    })
    expect(p).toContain('不給答案')
    expect(p).toContain('全片最多 4 張')
  })
})

describe('觀點型：toCheckBeat 帶地點、腳本過檢查器', () => {
  it('畫面的格子帶 location，字卡與片名卡不帶', () => {
    expect(toCheckBeat(beat({ location: '辦公室' })).location).toBe('辦公室')
    expect(
      toCheckBeat(beat({ beatKind: 'card', cardText: '字', location: '辦公室' })).location,
    ).toBeUndefined()
  })

  it('主視覺用了 6 個：第一版被退回，錯誤訊息講的是「最多 5 個」；第二版合併成 3 個就過', async () => {
    const ideaSettings = TrailerSettingsSchema.parse({
      kind: 'idea',
      targetSec: 21,
      title: '深度工作',
    })
    const pics = (names: string[]) =>
      names.map((location) => beat({ durationSec: 3, location, characters: [], segment: 'gains' }))
    const make = (names: string[]) =>
      script([
        ...pics(names),
        beat({ beatKind: 'title', durationSec: 3, description: '', segment: 'title' }),
      ])
    const tooMany = make(['a', 'b', 'c', 'd', 'e', 'f'])
    // 6 × 3 ＋ 3 ＝ 21
    const fixed = make(['a', 'b', 'c', 'a', 'b', 'c'])
    const { studio, requests } = studioOf([tooMany, fixed])
    const result = await writeTrailerScript(studio, { ...input, settings: ideaSettings }, ctx)
    expect(result.retried).toBe(true)
    expect(requests).toHaveLength(2)
    const retryMessage = JSON.stringify(requests[1]?.messages.at(-1))
    expect(retryMessage).toContain('最多 5 個')
    expect(result.script.beats.map((b) => b.location)).toContain('c')
  })
})

describe('觀點型：配樂描述有新段落的情緒', () => {
  it('沒存段落的舊腳本照 idea 模板排六段；各段都有自己的情緒', () => {
    const spans = musicSpansOf(undefined, 'idea', 30)
    expect(spans.map((s) => s.key)).toEqual(['hook', 'claim', 'gains', 'author', 'praise', 'title'])
    const text = trailerMusicPrompt({
      settings: TrailerSettingsSchema.parse({ kind: 'idea' }),
      spans,
      filmSec: 30,
    })
    for (const key of ['claim', 'gains', 'author', 'praise']) {
      expect(text).toContain(`s ${key}: `)
      expect(text).not.toContain(`s ${key}: follow the picture`)
    }
  })
})

describe('觀點型：配樂不停一拍、單一樂器平穩、片名進來時加一層', () => {
  const spans = musicSpansOf(undefined, 'idea', 30)
  const idea = trailerMusicPrompt({
    settings: TrailerSettingsSchema.parse({ kind: 'idea' }),
    spans,
    filmSec: 30,
  })

  it('沒有「片名前留一小段靜音」那句；有單一樂器、平穩、片名進來時多一層', () => {
    expect(idea).not.toContain('Leave a short silence')
    expect(idea).not.toContain('the music falls away')
    expect(idea).toContain('single instrument')
    expect(idea).toContain('steady')
    expect(idea).toContain('add one more layer')
    // 片名那一段是 27～30 秒（10%）：就在這個時間點加一層
    expect(idea).toMatch(/at 27\.0 s/)
    expect(idea).toContain('Instrumental only, no vocals')
  })

  it('其他類型的配樂描述不變（片名前留靜音）', () => {
    const story = trailerMusicPrompt({
      settings: TrailerSettingsSchema.parse({ kind: 'story' }),
      spans: musicSpansOf(undefined, 'story', 30),
      filmSec: 30,
    })
    expect(story).toContain('Leave a short silence')
  })

  it('寫腳本的提示：地方只寫畫得出來的具體東西，不寫抽象詞；各長度的句數', () => {
    const p = trailerSystemPrompt({
      text: '文本',
      settings: TrailerSettingsSchema.parse({ kind: 'idea', targetSec: 30 }),
      guide: '',
      knownCharacters: [],
      style: 'realistic',
    })
    expect(p).toContain('畫得出來的具體')
    expect(p).toContain('不要寫抽象')
    expect(p).toContain('最多 2 個收穫')
    expect(p).toContain('作者與推薦語最多擇一')
    expect(p).toContain('每一句都要讀得完')
    expect(p).toContain('15 秒')
    expect(p).toContain('60 秒')
  })
})

describe('A1：寫腳本時把角色的外觀一起寫出來（people）', () => {
  const promptOf = (
    kind: 'story' | 'teaser' | 'idea',
    text = '黑藤爬滿了斷橋。',
    known: string[] = [],
  ) =>
    trailerSystemPrompt({
      text,
      settings: TrailerSettingsSchema.parse({ kind, title: '黑藤裂谷' }),
      guide: '',
      knownCharacters: known,
      style: 'realistic',
    })

  it('劇情型與懸念短版的提示帶著 people 的要求（放在地點外觀的要求後面）', () => {
    for (const kind of ['story', 'teaser'] as const) {
      const p = promptOf(kind)
      expect(p).toContain(PEOPLE_LOOK_INSTRUCTION)
      expect(p.indexOf(PEOPLE_LOOK_INSTRUCTION)).toBeGreaterThan(p.indexOf('places 欄位'))
    }
  })

  it('要求的內容：長相與服裝各 15 到 40 個字、只寫看得到的、文本沒寫的依時代身分補、不模仿任何改編作品的造型、已建好的不用寫、描述畫面用名字稱呼', () => {
    const t = PEOPLE_LOOK_INSTRUCTION
    for (const part of [
      'people 欄位',
      '{ name, look, outfit }',
      '15 到 40 個字',
      '只寫看得到的',
      '時代、身分和描述',
      '不要模仿任何改編作品的造型',
      '電視劇、電影、動畫、遊戲、漫畫',
      '已經建好的角色不用寫',
      '用名字稱呼角色',
    ]) {
      expect(t, part).toContain(part)
    }
  })

  it('英文故事：多一句用故事的語言寫的清單裡也列了 people 的 look 與 outfit', () => {
    const p = promptOf('story', 'Black vines cover the broken bridge.')
    expect(p).toContain('people 的 look、outfit')
    // 中文故事沒有這一句
    expect(promptOf('story')).not.toContain('people 的 look、outfit')
  })

  it('觀點型沒有角色：people 也一律是空陣列，不帶外觀要求', () => {
    const p = promptOf('idea')
    expect(p).toContain('people 一律是空陣列')
    expect(p).not.toContain(PEOPLE_LOOK_INSTRUCTION)
  })
})

describe('觀點型：作者經歷要是使用者給的字或文本裡的原文', () => {
  const ideaSettings = TrailerSettingsSchema.parse({
    kind: 'idea',
    targetSec: 21,
    title: '深度工作',
    author: '某作者',
  })
  const pic = (extra: Record<string, unknown> = {}) =>
    beat({ durationSec: 3, location: '辦公室', segment: 'gains', ...extra })
  const withAuthorCard = (text: string) =>
    script([
      pic(),
      pic({ location: '待辦清單' }),
      pic({ location: '時鐘' }),
      beat({
        beatKind: 'card',
        durationSec: 3,
        description: '',
        cardText: text,
        segment: 'author',
      }),
      pic({ segment: 'gains' }),
      pic({ segment: 'gains' }),
      beat({ beatKind: 'title', durationSec: 3, description: '', segment: 'title' }),
    ])

  it('編出來的頭銜（「哈佛教授」）：第一版被退回，訊息說作者只能用名字與文本裡的原文；改成只放名字就過', async () => {
    const { studio, requests } = studioOf([withAuthorCard('哈佛教授'), withAuthorCard('某作者')])
    const result = await writeTrailerScript(
      studio,
      { ...input, settings: ideaSettings, text: '這本書說：越忙越沒進度。' },
      ctx,
    )
    expect(result.retried).toBe(true)
    expect(JSON.stringify(requests[1]?.messages.at(-1))).toContain('作者')
    expect(result.script.beats.find((b) => b.segment === 'author')?.cardText).toBe('某作者')
  })

  it('文本裡明明寫著的（逐字）：過；「作者：某作者」前面的稱呼不算', async () => {
    const text = '某作者在顧問業做了二十年。這本書說：越忙越沒進度。'
    for (const card of ['做了二十年', '作者：某作者']) {
      const { studio, requests } = studioOf([withAuthorCard(card)])
      const result = await writeTrailerScript(
        studio,
        { ...input, settings: ideaSettings, text },
        ctx,
      )
      expect(result.retried, card).toBe(false)
      expect(requests).toHaveLength(1)
    }
  })
})
