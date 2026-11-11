import { describe, expect, it } from 'vitest'

import { setLocale } from '../i18n'
import { ShotEditSchema } from './shots'
import { ShotSchema } from './story'
import {
  BeatKindSchema,
  CARD_MAX_COUNT,
  DEFAULT_TRAILER_GUIDE,
  DEFAULT_TRAILER_GUIDE_EN,
  DEFAULT_TRAILER_SETTINGS,
  TITLE_MIN_SEC,
  TRAILER_TEMPLATES,
  TrailerSettingsPatchSchema,
  beatMinFrames,
  TrailerSettingsSchema,
  cardMinSec,
  checkTrailerScript,
  defaultTrailerGuide,
  fitToTarget,
  textUnits,
  type TrailerBeat,
  type TrailerIssueCode,
  type TrailerSettings,
} from './trailer'

const FPS = 24

const settings = (patch: Partial<TrailerSettings> = {}): TrailerSettings =>
  TrailerSettingsSchema.parse({
    title: '黑藤裂谷',
    author: '某作者',
    endLine: '12 月 1 日 全台書店上市',
    ...patch,
  })

const video = (durationSec: number, extra: Partial<TrailerBeat> = {}): TrailerBeat => ({
  beatKind: 'video',
  durationSec,
  ...extra,
})
const card = (text: string, durationSec: number): TrailerBeat => ({
  beatKind: 'card',
  durationSec,
  card: { text },
})
const title = (durationSec = 5): TrailerBeat => ({ beatKind: 'title', durationSec })

/** 一份剛好 30 秒、全部規則都過的腳本：7 格畫面（越來越短）＋2 張字卡＋片名卡。 */
function goodScript(): TrailerBeat[] {
  return [
    video(4), // 第一格：畫面、4 秒以內
    video(3.5, { dialogue: '黑藤爬滿了斷橋。' }),
    card('他回來了', 2),
    video(3),
    video(3),
    video(2.5),
    card('這一次', 2),
    video(2),
    video(2),
    video(1),
    title(5),
  ]
}

const codes = (issues: readonly { code: TrailerIssueCode }[]): TrailerIssueCode[] =>
  issues.map((i) => i.code)

describe('預告片設定：預設長度是 30 秒', () => {
  it('什麼都不給就是 30 秒、劇情型、有旁白有配樂', () => {
    expect(DEFAULT_TRAILER_SETTINGS.targetSec).toBe(30)
    expect(DEFAULT_TRAILER_SETTINGS).toMatchObject({
      kind: 'story',
      targetSec: 30,
      title: '',
      narration: true,
      music: true,
      claims: [],
    })
  })

  it('目標秒數 10～120：9.9 與 120.1 不收，10 與 120 收；類型只有 story、teaser', () => {
    expect(TrailerSettingsSchema.safeParse({ targetSec: 9.9 }).success).toBe(false)
    expect(TrailerSettingsSchema.safeParse({ targetSec: 120.1 }).success).toBe(false)
    expect(TrailerSettingsSchema.parse({ targetSec: 10 }).targetSec).toBe(10)
    expect(TrailerSettingsSchema.parse({ targetSec: 120 }).targetSec).toBe(120)
    expect(TrailerSettingsSchema.safeParse({ kind: 'idea' }).success).toBe(false)
    expect(TrailerSettingsSchema.parse({ kind: 'teaser' }).kind).toBe('teaser')
  })

  it('封面素材要是內容雜湊；patch 每個欄位都可以不給', () => {
    expect(TrailerSettingsSchema.safeParse({ coverAssetHash: 'xyz' }).success).toBe(false)
    expect(TrailerSettingsSchema.parse({ coverAssetHash: 'a'.repeat(64) }).coverAssetHash).toBe(
      'a'.repeat(64),
    )
    expect(TrailerSettingsPatchSchema.parse({})).toEqual({})
  })
})

describe('格子種類 beatKind 與字卡 card（鏡頭多的兩個欄位）', () => {
  it('四種：video、still、card、title；鏡頭沒填就是 video、沒有字卡（舊專案的鏡頭全是 video）', () => {
    expect(BeatKindSchema.options).toEqual(['video', 'still', 'card', 'title'])
    const shot = ShotSchema.parse({
      id: 'a1',
      projectId: 'p1',
      number: 1,
      order: 0,
    })
    expect(shot.beatKind).toBe('video')
    expect(shot.card).toBeUndefined()
  })

  it('鏡頭可以是字卡：card 有主文字、副文字（預設空字串）', () => {
    const shot = ShotSchema.parse({
      id: 'a1',
      projectId: 'p1',
      number: 1,
      order: 0,
      beatKind: 'card',
      card: { text: '他回來了' },
    })
    expect(shot.card).toEqual({ text: '他回來了', subtext: '' })
    expect(
      ShotSchema.safeParse({ id: 'a1', projectId: 'p1', number: 1, order: 0, beatKind: 'x' })
        .success,
    ).toBe(false)
  })

  it('使用者改鏡頭（ShotEdit）可以改這兩個欄位，card 傳 null 代表清掉', () => {
    expect(ShotEditSchema.parse({ beatKind: 'still' })).toEqual({ beatKind: 'still' })
    expect(ShotEditSchema.parse({ card: null })).toEqual({ card: null })
    expect(ShotEditSchema.parse({ card: { text: '他回來了' } }).card).toEqual({
      text: '他回來了',
      subtext: '',
    })
    expect(ShotEditSchema.safeParse({ card: { text: '' } }).success).toBe(false)
  })
})

describe('類型模板是資料', () => {
  it('劇情型六段、懸念短版三段；佔比各自加總 1；最後一段是片名與行動', () => {
    expect(TRAILER_TEMPLATES.story.segments.map((s) => s.key)).toEqual([
      'hook',
      'world',
      'turn',
      'escalate',
      'suspense',
      'title',
    ])
    expect(TRAILER_TEMPLATES.teaser.segments.map((s) => s.key)).toEqual([
      'hook',
      'montage',
      'title',
    ])
    for (const template of Object.values(TRAILER_TEMPLATES)) {
      const total = template.segments.reduce((sum, s) => sum + s.share, 0)
      expect(total).toBeCloseTo(1, 9)
      expect(template.segments.at(-1)?.key).toBe('title')
      // 全片字卡數的上限不能大於檢查器的上限
      const cards = template.segments.reduce((sum, s) => sum + s.maxCards, 0)
      expect(cards).toBeLessThanOrEqual(CARD_MAX_COUNT)
    }
  })

  it('劇情型：鉤子 13%、升高 30%（規劃第 2.2 節的表）；懸念短版沒有旁白', () => {
    const share = (key: string) =>
      TRAILER_TEMPLATES.story.segments.find((s) => s.key === key)?.share
    expect(share('hook')).toBeCloseTo(0.13, 9)
    expect(share('escalate')).toBeCloseTo(0.3, 9)
    expect(TRAILER_TEMPLATES.teaser.segments.every((s) => s.narrationDensity === 'none')).toBe(true)
  })
})

describe('預告片準則（內建，中英各一份）', () => {
  it('中、英各一份，不一樣；跟著介面語言挑', () => {
    expect(DEFAULT_TRAILER_GUIDE).not.toBe(DEFAULT_TRAILER_GUIDE_EN)
    expect(DEFAULT_TRAILER_GUIDE).toMatch(/[一-鿿]/)
    expect(DEFAULT_TRAILER_GUIDE_EN).not.toMatch(/[一-鿿]/)
    expect(defaultTrailerGuide('zh-TW')).toBe(DEFAULT_TRAILER_GUIDE)
    expect(defaultTrailerGuide('en')).toBe(DEFAULT_TRAILER_GUIDE_EN)
  })

  it('把規劃第 2.3 節的規則都寫進去（長度、第一格、旁白密度、字卡、片名卡、不編造、畫面不生成文字）', () => {
    for (const guide of [DEFAULT_TRAILER_GUIDE, DEFAULT_TRAILER_GUIDE_EN]) {
      expect(guide).toMatch(/12/)
      expect(guide).toMatch(/4/)
      expect(guide).toMatch(/0\.8/)
    }
  })
})

describe('checkTrailerScript：一份好腳本', () => {
  it('30 秒、全部規則都過：沒有 errors，也沒有 warnings', () => {
    const result = checkTrailerScript(goodScript(), settings(), FPS)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.totalSec).toBeCloseTo(30, 9)
  })
})

describe('checkTrailerScript：規則 1 長度（errors）', () => {
  it('加總剛好等於目標：過；差 0.05 秒以內：過', () => {
    const beats = goodScript()
    beats[3] = video(3 + 0.04)
    expect(codes(checkTrailerScript(beats, settings(), FPS).errors)).not.toContain('length')
  })

  it('加總差 0.1 秒：擋', () => {
    const beats = goodScript()
    beats[3] = video(3.1)
    const result = checkTrailerScript(beats, settings(), FPS)
    expect(codes(result.errors)).toContain('length')
    expect(result.errors.find((e) => e.code === 'length')?.message).toMatch(/30\.1/)
  })

  it('依成品實際長度算：每格先對齊到整數格（24 fps，2.3 秒 ＝ 55 格 ＝ 2.2917 秒）', () => {
    const result = checkTrailerScript([video(2.3), title(3)], settings({ targetSec: 10 }), FPS)
    expect(result.totalSec).toBeCloseTo(55 / 24 + 3, 9)
  })

  it('目標秒數照設定（不是固定 30）', () => {
    const result = checkTrailerScript(goodScript(), settings({ targetSec: 45 }), FPS)
    expect(codes(result.errors)).toContain('length')
  })

  it('沒有任何一格：擋', () => {
    expect(codes(checkTrailerScript([], settings(), FPS).errors)).toContain('empty')
  })
})

describe('checkTrailerScript：規則 2 第一格', () => {
  it('第一格是字卡：擋；第一格是片名卡：擋', () => {
    for (const first of [card('他回來了', 3.5), title(3.5)]) {
      const beats = goodScript()
      beats[0] = first
      const result = checkTrailerScript(beats, settings(), FPS)
      expect(codes(result.errors), first.beatKind).toContain('first_beat_not_picture')
      expect(result.errors.find((e) => e.code === 'first_beat_not_picture')?.index).toBe(0)
    }
  })

  it('第一格是靜態鏡頭（still）可以；超過 4 秒：擋，剛好 4 秒：過', () => {
    const still: TrailerBeat = { beatKind: 'still', durationSec: 4 }
    const ok = goodScript()
    ok[0] = still
    expect(codes(checkTrailerScript(ok, settings(), FPS).errors)).not.toContain(
      'first_beat_too_long',
    )
    const long = goodScript()
    long[0] = video(4.5)
    long[1] = video(3)
    expect(codes(checkTrailerScript(long, settings(), FPS).errors)).toContain('first_beat_too_long')
  })
})

describe('checkTrailerScript：規則 4 旁白密度', () => {
  it('中文每秒 4 個字：剛好過；每秒超過 4 個字：擋', () => {
    const ok = goodScript()
    ok[1] = video(3.5, { dialogue: '一二三四五六七八九十甲乙丙丁' }) // 14 字 ≤ 14
    expect(codes(checkTrailerScript(ok, settings(), FPS).errors)).not.toContain(
      'narration_too_dense',
    )
    const bad = goodScript()
    bad[1] = video(3.5, { dialogue: '一二三四五六七八九十甲乙丙丁戊' }) // 15 字 > 14
    const result = checkTrailerScript(bad, settings(), FPS)
    expect(codes(result.errors)).toContain('narration_too_dense')
    expect(result.errors.find((e) => e.code === 'narration_too_dense')?.index).toBe(1)
  })

  it('英文照單字算：每秒最多 2.6 個字（約每分鐘 156 字）', () => {
    const ok = goodScript()
    ok[1] = video(3.5, { dialogue: 'The vines took the bridge.' }) // 5 字
    expect(codes(checkTrailerScript(ok, settings(), FPS).errors)).not.toContain(
      'narration_too_dense',
    )
    const bad = goodScript()
    bad[1] = video(3.5, { dialogue: 'The vines took the old stone bridge in one night again' }) // 11 字 > 9.1
    expect(codes(checkTrailerScript(bad, settings(), FPS).errors)).toContain('narration_too_dense')
  })

  it('有旁白的時間超過片長的 60%：擋', () => {
    // 6 格有旁白（每格 3 秒 ＝ 18 秒），30 秒的 60% 剛好 18 秒：過
    const lines = ['黑藤爬上橋。', '風停了。', '門開了。', '他來了。', '燈滅了。', '水退了。']
    const beats: TrailerBeat[] = [
      ...lines.map((dialogue) => video(3, { dialogue })),
      video(2),
      video(2),
      card('這一次', 2),
      video(2),
      title(4),
    ]
    expect(checkTrailerScript(beats, settings(), FPS).totalSec).toBeCloseTo(30, 9)
    expect(codes(checkTrailerScript(beats, settings(), FPS).errors)).not.toContain(
      'narration_share',
    )
    // 再多一格有旁白的（21 秒 ＞ 18 秒）
    const more = [...beats]
    more[6] = video(3, { dialogue: '她笑了。' })
    more[7] = video(1)
    expect(codes(checkTrailerScript(more, settings(), FPS).errors)).toContain('narration_share')
  })

  it('一格一句：一格裡有兩句：擋', () => {
    const beats = goodScript()
    beats[1] = video(3.5, { dialogue: '黑藤爬滿了橋。風停了。' })
    const result = checkTrailerScript(beats, settings(), FPS)
    expect(codes(result.errors)).toContain('narration_one_sentence')
  })

  it('字卡與片名卡的 dialogue 不算旁白', () => {
    const beats = goodScript()
    beats[2] = { ...card('他回來了', 2), dialogue: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸' }
    expect(codes(checkTrailerScript(beats, settings(), FPS).errors)).not.toContain(
      'narration_too_dense',
    )
  })
})

describe('checkTrailerScript：規則 6 字卡', () => {
  it('字卡 12 個字：過；13 個字：擋', () => {
    const ok = goodScript()
    ok[2] = card('一二三四五六七八九十甲乙', 3.5) // 12 字 → 至少 0.8+2.4=3.2 秒
    ok[3] = video(1.5)
    expect(codes(checkTrailerScript(ok, settings(), FPS).errors)).not.toContain('card_too_long')
    const bad = goodScript()
    bad[2] = card('一二三四五六七八九十甲乙丙', 3.5) // 13 字
    bad[3] = video(1.5)
    const result = checkTrailerScript(bad, settings(), FPS)
    expect(codes(result.errors)).toContain('card_too_long')
    expect(result.errors.find((e) => e.code === 'card_too_long')?.index).toBe(2)
  })

  it('英文字卡最多 6 個字', () => {
    const ok = goodScript()
    ok[2] = card('He is coming back again', 2)
    expect(codes(checkTrailerScript(ok, settings(), FPS).errors)).not.toContain('card_too_long')
    const bad = goodScript()
    bad[2] = card('He is coming back again very soon', 2) // 7 字
    expect(codes(checkTrailerScript(bad, settings(), FPS).errors)).toContain('card_too_long')
  })

  it('停留秒數 ≥ 0.8 ＋ 字數 × 0.2：12 個字要 3.2 秒，3.1 秒擋、3.2 秒過', () => {
    expect(cardMinSec({ text: '一二三四五六七八九十甲乙' })).toBeCloseTo(3.2, 9)
    const make = (sec: number) => {
      const beats = goodScript()
      beats[2] = card('一二三四五六七八九十甲乙', sec)
      beats[3] = video(5 - sec)
      return checkTrailerScript(beats, settings(), FPS)
    }
    expect(codes(make(3.1).errors)).toContain('card_too_short')
    expect(codes(make(3.2).errors)).not.toContain('card_too_short')
  })

  it('字卡沒有字：擋', () => {
    const beats = goodScript()
    beats[2] = { beatKind: 'card', durationSec: 2 }
    expect(codes(checkTrailerScript(beats, settings(), FPS).errors)).toContain('card_empty')
  })

  it('全片字卡最多 4 張（片名卡另外算）：5 張擋，4 張過', () => {
    const four: TrailerBeat[] = [
      video(3.5),
      card('一', 2),
      video(3),
      card('二', 2),
      video(3),
      card('三', 2),
      video(3),
      card('四', 2),
      video(2.5),
      title(5),
    ]
    expect(checkTrailerScript(four, settings(), FPS).totalSec).toBeCloseTo(28, 9)
    const r4 = checkTrailerScript(four, settings({ targetSec: 28 }), FPS)
    expect(codes(r4.errors)).not.toContain('too_many_cards')
    const five = [...four.slice(0, 9), card('五', 2), title(5)]
    expect(codes(checkTrailerScript(five, settings({ targetSec: 30 }), FPS).errors)).toContain(
      'too_many_cards',
    )
  })
})

describe('checkTrailerScript：規則 7 片名卡', () => {
  it('沒有片名卡：擋', () => {
    const beats = goodScript().slice(0, -1)
    beats[9] = video(6)
    expect(codes(checkTrailerScript(beats, settings(), FPS).errors)).toContain('no_title')
  })

  it('片名卡 3 秒：過；2.9 秒：擋', () => {
    expect(TITLE_MIN_SEC).toBe(3)
    const make = (sec: number) => {
      const beats = goodScript()
      beats[10] = title(sec)
      beats[9] = video(6 - sec)
      return checkTrailerScript(beats, settings(), FPS)
    }
    expect(codes(make(3).errors)).not.toContain('title_too_short')
    expect(codes(make(2.9).errors)).toContain('title_too_short')
  })

  it('設定裡沒有書名：擋；沒有片尾那一行（去哪裡買、哪天上市）：只提醒', () => {
    const noTitle = checkTrailerScript(goodScript(), settings({ title: '' }), FPS)
    expect(codes(noTitle.errors)).toContain('title_missing_name')
    const noLine = checkTrailerScript(goodScript(), settings({ endLine: '' }), FPS)
    expect(codes(noLine.errors)).not.toContain('title_missing_name')
    expect(codes(noLine.warnings)).toContain('title_no_action')
  })
})

describe('checkTrailerScript：規則 11 不編造', () => {
  it('字卡寫了「暢銷」「得獎」之類，但使用者沒填過：擋', () => {
    const beats = goodScript()
    beats[2] = card('百萬冊暢銷', 2.5)
    beats[3] = video(2.5)
    const result = checkTrailerScript(beats, settings(), FPS)
    expect(codes(result.errors)).toContain('unverified_claim')
    expect(result.errors.find((e) => e.code === 'unverified_claim')?.index).toBe(2)
  })

  it('使用者自己填的（claims 或標語）原句：過', () => {
    const beats = goodScript()
    beats[2] = card('百萬冊暢銷', 2.5)
    beats[3] = video(2.5)
    expect(
      codes(checkTrailerScript(beats, settings({ claims: ['百萬冊暢銷'] }), FPS).errors),
    ).not.toContain('unverified_claim')
    expect(
      codes(checkTrailerScript(beats, settings({ tagline: '百萬冊暢銷' }), FPS).errors),
    ).not.toContain('unverified_claim')
  })

  it('旁白也一樣；英文的 bestseller、award 也算', () => {
    const narr = goodScript()
    narr[1] = video(3.5, { dialogue: '全球暢銷小說。' })
    expect(codes(checkTrailerScript(narr, settings(), FPS).errors)).toContain('unverified_claim')
    const en = goodScript()
    en[2] = card('Award winning', 2)
    expect(codes(checkTrailerScript(en, settings(), FPS).errors)).toContain('unverified_claim')
  })

  it('一般的字卡不受影響', () => {
    expect(codes(checkTrailerScript(goodScript(), settings(), FPS).errors)).not.toContain(
      'unverified_claim',
    )
  })
})

describe('checkTrailerScript：規則 3 一路升高（只提醒，不擋）', () => {
  it('最後三分之一沒有比前三分之一短：只有 warning，沒有 error', () => {
    const flat: TrailerBeat[] = [...Array.from({ length: 8 }, () => video(3.25)), title(4)]
    const result = checkTrailerScript(flat, settings(), FPS)
    expect(result.errors).toEqual([])
    expect(codes(result.warnings)).toContain('no_escalation')
  })

  it('最後三分之一的平均格長 ≤ 前三分之一的 60%：不提醒', () => {
    expect(codes(checkTrailerScript(goodScript(), settings(), FPS).warnings)).not.toContain(
      'no_escalation',
    )
  })

  it('懸念那一格與片名卡不算進去；格數太少（不到 6 格）不比', () => {
    const withSuspense: TrailerBeat[] = [
      video(2),
      video(2),
      video(2),
      video(2),
      video(1),
      video(1),
      video(1),
      video(1),
      video(7, { segment: 'suspense' }),
      title(9),
    ]
    expect(
      codes(checkTrailerScript(withSuspense, settings({ targetSec: 28 }), FPS).warnings),
    ).not.toContain('no_escalation')
    const few: TrailerBeat[] = [video(5), video(5), video(5), video(5), video(5), title(5)]
    expect(codes(checkTrailerScript(few, settings(), FPS).warnings)).not.toContain('no_escalation')
  })
})

describe('checkTrailerScript：訊息是白話，跟著介面語言', () => {
  it('中文與英文各一句；不出現 beat、take、prompt', () => {
    const beats = goodScript()
    beats[3] = video(3.1)
    setLocale('zh-TW')
    const zh = checkTrailerScript(beats, settings(), FPS).errors[0]?.message ?? ''
    setLocale('en')
    const en = checkTrailerScript(beats, settings(), FPS).errors[0]?.message ?? ''
    setLocale('zh-TW')
    expect(zh).toMatch(/[一-鿿]/)
    expect(en).not.toMatch(/[一-鿿]/)
    for (const text of [zh, en]) expect(text).not.toMatch(/\b(beat|take|prompt)\b/i)
  })
})

describe('textUnits：字數怎麼算', () => {
  it('中文算字（不算標點與空白）；沒有中文的算單字', () => {
    expect(textUnits('黑藤，爬滿了斷橋。')).toBe(7)
    expect(textUnits('The vines  took the bridge.')).toBe(5)
    expect(textUnits('')).toBe(0)
  })
})

/** 固定種子的亂數，測試才可重現。 */
function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('fitToTarget', () => {
  const frames = (sec: number) => Math.round(sec * FPS)

  it('目標 10～120 秒、5～30 格的隨機輸入：加總剛好等於目標、每格是 1/fps 的整數倍、字卡與片名卡不低於最短秒數', () => {
    const random = rng(20261112)
    for (let round = 0; round < 300; round++) {
      const n = 5 + Math.floor(random() * 26)
      let cardsLeft = 2
      const beats: TrailerBeat[] = Array.from({ length: n }, (_, i) => {
        if (i === n - 1) return title(0.5 + random() * 8)
        if (random() < 0.1 && cardsLeft > 0) {
          cardsLeft--
          return card('一二三四五六', 0.5 + random() * 3)
        }
        return video(0.3 + random() * 6)
      })
      // 目標要至少放得下每一格的最短秒數（放不下的情況另外一條測試）
      const minTotal = beats.reduce((sum, b) => sum + beatMinFrames(b, FPS), 0) / FPS
      const target = Math.min(
        120,
        Math.max(Math.round((10 + random() * 110) * 10) / 10, Math.ceil(minTotal) + 1),
      )
      const result = fitToTarget(beats, target, FPS)
      expect(result.ok, `round ${String(round)}`).toBe(true)
      expect(result.durations).toHaveLength(n)
      // 加總：格數剛好等於目標的格數
      const total = result.durations.reduce((sum, d) => sum + frames(d), 0)
      expect(total).toBe(frames(target))
      expect(result.durations.reduce((sum, d) => sum + d, 0)).toBeCloseTo(frames(target) / FPS, 9)
      result.durations.forEach((d, i) => {
        // 每格是 1/fps 的整數倍
        expect(Math.abs(d * FPS - Math.round(d * FPS))).toBeLessThan(1e-9)
        expect(d).toBeGreaterThan(0)
        const beat = beats[i]
        if (beat?.beatKind === 'card' && beat.card) {
          expect(d).toBeGreaterThanOrEqual(cardMinSec(beat.card) - 1e-9)
        }
        if (beat?.beatKind === 'title') expect(d).toBeGreaterThanOrEqual(TITLE_MIN_SEC - 1e-9)
      })
    }
  })

  it('調完的腳本，長度那一條檢查器一定過', () => {
    const beats = goodScript().map((b) => ({ ...b, durationSec: b.durationSec * 1.37 }))
    const fitted = fitToTarget(beats, 30, FPS)
    const next = beats.map((b, i) => ({ ...b, durationSec: fitted.durations[i] ?? b.durationSec }))
    expect(codes(checkTrailerScript(next, settings(), FPS).errors)).not.toContain('length')
  })

  it('等比例：本來 1：2 的兩格，調成 12 秒就是 4 秒與 8 秒（沒有字卡擋著時）', () => {
    const result = fitToTarget([video(1), video(2)], 12, FPS)
    expect(result.durations[0]).toBeCloseTo(4, 9)
    expect(result.durations[1]).toBeCloseTo(8, 9)
  })

  it('字卡被壓到最短就停在最短，多出的時間由別的格分攤', () => {
    const beats: TrailerBeat[] = [video(5), card('一二三四五六七八九十', 5), video(5)]
    const result = fitToTarget(beats, 6, FPS)
    expect(result.ok).toBe(true)
    expect(result.durations[1]).toBeCloseTo(cardMinSec({ text: '一二三四五六七八九十' }), 1)
    expect(result.durations.reduce((s, d) => s + d, 0)).toBeCloseTo(6, 9)
  })

  it('最短秒數加起來就超過目標：ok 是 false，每格取最短（不偷偷違反最短秒數）', () => {
    const beats: TrailerBeat[] = [video(1), card('一二三四五六七八九十十一十二', 3), title(3)]
    const result = fitToTarget(beats, 5, FPS)
    expect(result.ok).toBe(false)
    expect(result.durations[2]).toBeGreaterThanOrEqual(TITLE_MIN_SEC)
  })

  it('沒有任何一格：回空的，ok 是 false', () => {
    expect(fitToTarget([], 30, FPS)).toEqual({ durations: [], ok: false })
  })
})
