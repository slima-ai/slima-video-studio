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
  MIN_BEAT_SEC,
  MIN_MOVING_BEAT_SEC,
  OVERLAY_MAX_CJK,
  OVERLAY_MAX_WORDS,
  OVERLAY_SUB_MAX_CJK,
  OVERLAY_SUB_MAX_WORDS,
  overlaySize,
  ShotOverlaySchema,
  TITLE_MIN_SEC,
  TRAILER_TEMPLATES,
  TrailerSettingsPatchSchema,
  beatMinFrames,
  TrailerSettingsSchema,
  cardLimitOf,
  cardMinSec,
  checkTrailerScript,
  defaultTrailerGuide,
  fitAround,
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
    video(2.5),
    video(2.5),
    card('這一次', 2),
    video(2),
    video(2),
    video(1.5),
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

  it('目標秒數 10～120：9.9 與 120.1 不收，10 與 120 收；類型只有 story、teaser、idea', () => {
    expect(TrailerSettingsSchema.safeParse({ targetSec: 9.9 }).success).toBe(false)
    expect(TrailerSettingsSchema.safeParse({ targetSec: 120.1 }).success).toBe(false)
    expect(TrailerSettingsSchema.parse({ targetSec: 10 }).targetSec).toBe(10)
    expect(TrailerSettingsSchema.parse({ targetSec: 120 }).targetSec).toBe(120)
    expect(TrailerSettingsSchema.safeParse({ kind: 'essay' }).success).toBe(false)
    expect(TrailerSettingsSchema.parse({ kind: 'teaser' }).kind).toBe('teaser')
    expect(TrailerSettingsSchema.parse({ kind: 'idea' }).kind).toBe('idea')
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
      // 全片字卡數的上限不能大於檢查器給這個類型的上限
      const cards = template.segments.reduce((sum, s) => sum + s.maxCards, 0)
      expect(cards).toBeLessThanOrEqual(cardLimitOf(template.kind))
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

describe('checkTrailerScript：給模型的訊息與給使用者的短版分開', () => {
  it('旁白太長：message（退回給寫腳本的模型）一字不改；userMessage 是給使用者看的短版', () => {
    const bad = goodScript()
    bad[1] = video(3.5, { dialogue: '一二三四五六七八九十甲乙丙丁戊' }) // 15 字 > 14
    const issue = checkTrailerScript(bad, settings(), FPS).errors.find(
      (e) => e.code === 'narration_too_dense',
    )
    expect(issue?.message).toBe(
      '第 2 格的旁白有 15 個字（或單字），這一格只有 3.5 秒，最多念得完 14 個。請把這句縮短。',
    )
    expect(issue?.userMessage).toBe('第 2 格旁白太長：15 字，最多 14 字。')
  })

  it('總長不對、旁白佔太多、提到沒提供的暢銷：message 照舊、userMessage 縮短', () => {
    const long = goodScript()
    long[0] = video(5)
    const length = checkTrailerScript(long, settings(), FPS).errors.find((e) => e.code === 'length')
    expect(length?.message).toContain('請調整各格的秒數')
    expect(length?.userMessage).toMatch(/^總長 .* 秒，目標 30 秒，差 .* 秒。$/)

    const talky = goodScript().map((beat) =>
      beat.beatKind === 'video' ? { ...beat, dialogue: '一二三四五六' } : beat,
    )
    const share = checkTrailerScript(talky, settings(), FPS).errors.find(
      (e) => e.code === 'narration_share',
    )
    expect(share?.message).toContain('請讓一些格子不說話')
    expect(share?.userMessage).not.toContain('請')

    const claim = goodScript()
    claim[2] = card('百萬冊暢銷', 2.5)
    const unverified = checkTrailerScript(claim, settings(), FPS).errors.find(
      (e) => e.code === 'unverified_claim',
    )
    expect(unverified?.message).toContain('推薦語、獎項、銷量只能用你自己提供的原文')
    expect(unverified?.userMessage).toBe(
      '第 3 格提到了暢銷、獎項或推薦語，但不是你提供的；沒有原文就拿掉。',
    )
  })

  it('沒有短版的訊息（例如沒有片名卡）：沒有 userMessage，直接顯示 message', () => {
    const noTitle = goodScript().filter((beat) => beat.beatKind !== 'title')
    const issue = checkTrailerScript(noTitle, settings(), FPS).errors.find(
      (e) => e.code === 'no_title',
    )
    expect(issue?.userMessage).toBeUndefined()
    expect(issue?.message).toBe('沒有片名卡。最後要有一格片名卡。')
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

describe('checkTrailerScript：格子最短（D3）', () => {
  /** 在 goodScript 最後一格畫面前面多塞一格，再把前面某一格縮短補回去，讓總長仍是 30 秒。 */
  const withBeat = (extra: TrailerBeat, takeFrom: number): TrailerBeat[] => {
    const beats = goodScript()
    const donor = beats[takeFrom]
    if (!donor) throw new Error('no donor')
    beats[takeFrom] = { ...donor, durationSec: donor.durationSec - extra.durationSec }
    beats.splice(9, 0, extra)
    return beats
  }

  it('常數：任何一格至少 0.75 秒，會動的至少 1.5 秒', () => {
    expect(MIN_BEAT_SEC).toBe(0.75)
    expect(MIN_MOVING_BEAT_SEC).toBe(1.5)
    expect(beatMinFrames({ beatKind: 'video' }, FPS)).toBe(18)
    expect(beatMinFrames({ beatKind: 'still' }, FPS)).toBe(18)
  })

  it('畫面格短於 0.75 秒：擋下（error beat_too_short，指出是哪一格）；剛好 0.75 秒通過', () => {
    const short = withBeat({ beatKind: 'still', durationSec: 0.5 }, 3)
    const result = checkTrailerScript(short, settings(), FPS)
    expect(result.errors.filter((e) => e.code === 'beat_too_short').map((e) => e.index)).toEqual([
      9,
    ])
    const ok = withBeat({ beatKind: 'still', durationSec: 0.75 }, 3)
    expect(codes(checkTrailerScript(ok, settings(), FPS).errors)).toEqual([])
    const movingShort = withBeat({ beatKind: 'video', durationSec: 0.5 }, 3)
    expect(codes(checkTrailerScript(movingShort, settings(), FPS).errors)).toContain(
      'beat_too_short',
    )
  })

  it('會動的格短於 1.5 秒：只提醒（warning moving_beat_too_short）；不動的、字卡、片名卡不提醒；1.5 秒整不提醒', () => {
    const moving = withBeat({ beatKind: 'video', durationSec: 1 }, 3)
    const result = checkTrailerScript(moving, settings(), FPS)
    expect(result.errors).toEqual([])
    expect(
      result.warnings.filter((w) => w.code === 'moving_beat_too_short').map((w) => w.index),
    ).toEqual([9])
    const still = withBeat({ beatKind: 'still', durationSec: 1 }, 3)
    expect(codes(checkTrailerScript(still, settings(), FPS).warnings)).not.toContain(
      'moving_beat_too_short',
    )
    const exact = withBeat({ beatKind: 'video', durationSec: 1.5 }, 3)
    expect(codes(checkTrailerScript(exact, settings(), FPS).warnings)).not.toContain(
      'moving_beat_too_short',
    )
  })

  it('訊息是白話，寫出第幾格與最短秒數', () => {
    const short = withBeat({ beatKind: 'still', durationSec: 0.5 }, 3)
    const message = checkTrailerScript(short, settings(), FPS).errors.find(
      (e) => e.code === 'beat_too_short',
    )?.message
    expect(message).toContain('10')
    expect(message).toContain('0.75')
  })

  it('fitToTarget：畫面格不會被壓到 0.75 秒以下；改格長的編輯（ShotEdit）也一樣：0.5 不收、0.75 收', () => {
    const beats: TrailerBeat[] = [video(3), video(3), video(3), title(3)]
    const squeezed = fitToTarget(beats, 10, FPS)
    expect(squeezed.ok).toBe(true)
    for (const d of squeezed.durations.slice(0, 3)) expect(d).toBeGreaterThanOrEqual(0.75)
    const tight = fitToTarget([video(3), video(3), video(3), title(3)], 5, FPS)
    expect(tight.ok).toBe(false)
    expect(tight.durations.slice(0, 3)).toEqual([0.75, 0.75, 0.75])
    expect(ShotEditSchema.safeParse({ durationSec: 0.5 }).success).toBe(false)
    expect(ShotEditSchema.safeParse({ durationSec: 0.75 }).success).toBe(true)
  })
})

describe('checkTrailerScript：停太久（只提醒，不擋）', () => {
  /** 把 goodScript 的某一格換掉；目標秒數跟著新的總長，這樣不會冒出「長度不對」的錯誤。 */
  const swap = (index: number, beat: TrailerBeat) => {
    const beats = goodScript()
    beats[index] = beat
    const total = beats.reduce((sum, b) => sum + b.durationSec, 0)
    return { beats, config: settings({ targetSec: total }) }
  }
  const check = (index: number, beat: TrailerBeat) => {
    const { beats, config } = swap(index, beat)
    return checkTrailerScript(beats, config, FPS)
  }
  const warnCodes = (index: number, beat: TrailerBeat) => codes(check(index, beat).warnings)

  it('字卡停留超過最短停留的 2 倍：提醒（指出第幾格）；剛好 2 倍不提醒', () => {
    // 「這一次」3 個字：最短 0.8＋3×0.2＝1.4 秒，2 倍是 2.8 秒
    const result = check(6, card('這一次', 3))
    expect(result.errors).toEqual([])
    expect(
      result.warnings.filter((w) => w.code === 'card_hold_too_long').map((w) => w.index),
    ).toEqual([6])
    expect(warnCodes(6, card('這一次', 2.8))).not.toContain('card_hold_too_long')
    expect(codes(checkTrailerScript(goodScript(), settings(), FPS).warnings)).toEqual([])
  })

  it('片名卡超過 6 秒：提醒；剛好 6 秒不提醒', () => {
    expect(warnCodes(10, title(6.5))).toContain('title_hold_too_long')
    expect(warnCodes(10, title(6))).not.toContain('title_hold_too_long')
  })

  it('畫面格（第一格以外）超過 6 秒：提醒；剛好 6 秒、第一格、字卡不算', () => {
    const result = check(3, video(6.5))
    expect(result.errors).toEqual([])
    expect(
      result.warnings.filter((w) => w.code === 'beat_hold_too_long').map((w) => w.index),
    ).toEqual([3])
    expect(warnCodes(3, video(6))).not.toContain('beat_hold_too_long')
    // 第一格另有 4 秒的上限（錯誤），不再重複提醒
    expect(warnCodes(0, video(7))).not.toContain('beat_hold_too_long')
  })

  it('訊息是白話，寫出第幾格與秒數', () => {
    const message = check(3, video(6.5)).warnings.find(
      (w) => w.code === 'beat_hold_too_long',
    )?.message
    expect(message).toContain('4')
    expect(message).toContain('6.5')
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

describe('fitAround：固定一格的秒數，其他格讓時間，總長不變', () => {
  const frames = (sec: number) => Math.round(sec * FPS)
  const sum = (d: number[]) => d.reduce((a, b) => a + frames(b), 0)

  it('固定那一格就是指定的秒數（對齊 1/24），其餘照比例讓出，加總剛好等於目標', () => {
    const beats = [video(3), video(2.5), video(2.5), video(2), video(20)]
    const result = fitAround(beats, new Map([[1, 4]]), 30, FPS)
    expect(result.ok).toBe(true)
    expect(result.durations[1]).toBeCloseTo(4, 9)
    expect(sum(result.durations)).toBe(frames(30))
    // 其他格都比原本短一點，沒有一格比原本長
    result.durations.forEach((d, i) => {
      if (i !== 1) expect(d).toBeLessThanOrEqual((beats[i]?.durationSec ?? 0) + 1e-9)
    })
  })

  it('指定的秒數不是整數格：對齊到最近的一格（2.43 秒 → 58 格）', () => {
    const result = fitAround([video(2), video(2), video(6)], new Map([[0, 2.43]]), 10, FPS)
    expect(result.durations[0]).toBeCloseTo(58 / FPS, 9)
    expect(sum(result.durations)).toBe(frames(10))
  })

  it('字卡不低於最短停留：其他格排不下時 ok 是 false，並說這一格最多能到幾秒', () => {
    // 兩張字卡（各 0.8＋0.2×5 ＝ 1.8 秒）加片名卡最短，剩下的時間才是這一格能用的
    const beats = [video(3), card('一二三四五', 1.8), card('一二三四五', 1.8), title(3)]
    const minRest = beats.slice(1).reduce((sum, beat) => sum + beatMinFrames(beat, FPS), 0)
    const result = fitAround(beats, new Map([[0, 10]]), 10, FPS)
    expect(result.ok).toBe(false)
    expect(result.maxSec).toBeCloseTo((frames(10) - minRest) / FPS, 9)
  })

  it('只有一格：指定的秒數剛好等於目標才行', () => {
    expect(fitAround([video(5)], new Map([[0, 5]]), 5, FPS).ok).toBe(true)
    expect(fitAround([video(5)], new Map([[0, 4]]), 5, FPS).ok).toBe(false)
  })

  it('固定兩格（例如第一格定在 4 秒）：兩格都不動，其餘照比例', () => {
    const result = fitAround(
      [video(6), video(3), video(3), video(3)],
      new Map([
        [1, 5],
        [0, 4],
      ]),
      20,
      FPS,
    )
    expect(result.ok).toBe(true)
    expect(result.durations[0]).toBeCloseTo(4, 9)
    expect(result.durations[1]).toBeCloseTo(5, 9)
    expect(sum(result.durations)).toBe(frames(20))
  })
})

// ---- 觀點型（idea）：商業書、工具書、非虛構 ----

describe('觀點型：模板六段（規劃第 2.2 節 C）', () => {
  it('鉤子 15%、核心主張 20%、三個收穫 35%、作者憑什麼 12%、推薦語 8%、封面與行動 10%', () => {
    const segs = TRAILER_TEMPLATES.idea.segments
    expect(segs.map((s) => s.key)).toEqual(['hook', 'claim', 'gains', 'author', 'praise', 'title'])
    expect(segs.map((s) => s.share)).toEqual([0.15, 0.2, 0.35, 0.12, 0.08, 0.1])
    expect(segs.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 9)
  })

  it('字卡是主角：每一段都可以放字卡（鉤子 1、主張 1、收穫 3、作者 1、推薦語 1）；全片 7 張', () => {
    const segs = TRAILER_TEMPLATES.idea.segments
    expect(segs.map((s) => s.maxCards)).toEqual([1, 1, 3, 1, 1, 0])
    expect(cardLimitOf('idea')).toBe(7)
  })

  it('其他兩種類型的字卡上限不變：4 張', () => {
    expect(cardLimitOf('story')).toBe(4)
    expect(cardLimitOf('teaser')).toBe(4)
    expect(CARD_MAX_COUNT).toBe(4)
  })
})

/** 觀點型 30 秒：鉤子（畫面＋字卡）→ 主張 → 三個收穫（三張字卡各配畫面）→ 作者 → 封面與片名。 */
function ideaScript(extra: { visuals?: string[] } = {}): TrailerBeat[] {
  const v = extra.visuals ?? ['辦公室', '待辦清單', '時鐘', '辦公室', '待辦清單', '時鐘']
  const pic = (sec: number, i: number, segment: string, dialogue = ''): TrailerBeat =>
    video(sec, { segment, location: v[i] ?? '辦公室', ...(dialogue ? { dialogue } : {}) })
  return [
    pic(3, 0, 'hook'),
    card('越忙越沒進度？', 2.5),
    pic(3, 1, 'claim', '真正的問題是優先順序。'),
    pic(2.5, 2, 'gains'),
    card('先做最重要的一件', 2.5),
    pic(2.5, 3, 'gains'),
    card('把待辦清單砍一半', 2.5),
    pic(2.5, 4, 'gains'),
    card('每天留一小時深度工作', 3.5),
    pic(2.5, 5, 'author'),
    title(3),
  ]
}
const ideaSettings = (patch: Partial<TrailerSettings> = {}): TrailerSettings =>
  settings({ kind: 'idea', targetSec: 30, ...patch })

describe('觀點型：檢查器依類型給不同的字卡上限', () => {
  it('同一份有 5 張字卡的腳本：劇情型擋（上限 4），觀點型過（上限 7）', () => {
    const beats = ideaScript()
    const cards = beats.filter((b) => b.beatKind === 'card').length
    expect(cards).toBe(4)
    // 補成 5 張：把「作者」那一格換成字卡
    const five = beats.map((b) =>
      b.segment === 'author' ? { ...card('作者做過十年顧問', 2.5), segment: 'author' } : b,
    )
    expect(five.filter((b) => b.beatKind === 'card')).toHaveLength(5)
    expect(
      codes(checkTrailerScript(five, settings({ kind: 'story', targetSec: 30 }), FPS).errors),
    ).toContain('too_many_cards')
    expect(
      codes(checkTrailerScript(five, ideaSettings({ author: '某作者' }), FPS).errors),
    ).not.toContain('too_many_cards')
  })

  it('觀點型 7 張過、8 張擋；擋的訊息寫的是 7 張', () => {
    const base = (n: number): TrailerBeat[] => [
      video(3, { location: 'a' }),
      ...Array.from({ length: n }, (_, i) => card(`字卡${String(i + 1)}`, 2)),
      video(3, { location: 'b' }),
      video(3, { location: 'c' }),
      title(3),
    ]
    const seven = checkTrailerScript(base(7), ideaSettings({ targetSec: 23 }), FPS)
    expect(codes(seven.errors)).not.toContain('too_many_cards')
    const eight = checkTrailerScript(base(8), ideaSettings({ targetSec: 25 }), FPS)
    expect(codes(eight.errors)).toContain('too_many_cards')
    expect(eight.errors.find((e) => e.code === 'too_many_cards')?.message).toContain('7')
  })

  it('一般的劇情型訊息還是「4 張」', () => {
    const five = [
      video(3.5),
      card('一', 2),
      card('二', 2),
      card('三', 2),
      card('四', 2),
      card('五', 2),
      video(3.5),
      title(5),
    ]
    const r = checkTrailerScript(five, settings({ targetSec: 22 }), FPS)
    expect(r.errors.find((e) => e.code === 'too_many_cards')?.message).toContain('4')
  })
})

describe('觀點型：節奏與主視覺', () => {
  it('不要求「一路升高」：講道理的片子節奏平，不提醒', () => {
    const flat: TrailerBeat[] = [
      ...Array.from({ length: 8 }, (_, i) =>
        video(3.25, { location: ['a', 'b', 'c'][i % 3] ?? 'a' }),
      ),
      title(4),
    ]
    const r = checkTrailerScript(flat, ideaSettings({ targetSec: 30 }), FPS)
    expect(codes(r.warnings)).not.toContain('no_escalation')
    // 同一份在劇情型還是會提醒
    expect(codes(checkTrailerScript(flat, settings({ targetSec: 30 }), FPS).warnings)).toContain(
      'no_escalation',
    )
  })

  it('主視覺（地點）3～5 個：3、5 個過；6 個擋；2 個只提醒', () => {
    const withVisuals = (names: string[]): TrailerBeat[] => [
      ...names.map((n) => video(4, { location: n })),
      title(3),
    ]
    const ok3 = checkTrailerScript(
      withVisuals(['a', 'b', 'c']),
      ideaSettings({ targetSec: 15 }),
      FPS,
    )
    expect(codes(ok3.errors)).not.toContain('visuals_out_of_range')
    expect(codes(ok3.warnings)).not.toContain('few_visuals')
    const ok5 = checkTrailerScript(
      withVisuals(['a', 'b', 'c', 'd', 'e']),
      ideaSettings({ targetSec: 23 }),
      FPS,
    )
    expect(codes(ok5.errors)).not.toContain('too_many_visuals')
    const six = checkTrailerScript(
      withVisuals(['a', 'b', 'c', 'd', 'e', 'f']),
      ideaSettings({ targetSec: 27 }),
      FPS,
    )
    expect(codes(six.errors)).toContain('too_many_visuals')
    expect(six.errors.find((e) => e.code === 'too_many_visuals')?.message).toContain('5')
    // 30 秒：2 個主視覺只提醒、不擋
    const many2 = [
      ...Array.from({ length: 9 }, (_, i) => video(3, { location: i % 2 === 0 ? 'a' : 'b' })),
      title(3),
    ]
    const two = checkTrailerScript(many2, ideaSettings({ targetSec: 30 }), FPS)
    expect(codes(two.errors)).not.toContain('too_many_visuals')
    expect(codes(two.warnings)).toContain('few_visuals')
  })

  it('同一個主視覺用幾次都只算一個；字卡與片名卡不算；劇情型不管地點數', () => {
    const r = checkTrailerScript(ideaScript(), ideaSettings(), FPS)
    expect(codes(r.errors)).not.toContain('too_many_visuals')
    const many = [
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => video(3, { location: n })),
      title(3),
    ]
    expect(codes(checkTrailerScript(many, settings({ targetSec: 24 }), FPS).errors)).not.toContain(
      'too_many_visuals',
    )
  })
})

describe('觀點型：推薦語與作者只用使用者提供的字', () => {
  const withPraise = (text: string): TrailerBeat[] => [
    video(4, { location: 'a' }),
    video(4, { location: 'b' }),
    video(4, { location: 'c' }),
    { ...card(text, 3), segment: 'praise' },
    title(3),
  ]

  it('沒提供推薦語，卻有「推薦語」那一段：擋（說的是沒提供）', () => {
    const r = checkTrailerScript(
      withPraise('每個經理人都該讀'),
      ideaSettings({ targetSec: 18 }),
      FPS,
    )
    const issue = r.errors.find((e) => e.code === 'unverified_claim')
    expect(issue).toBeDefined()
    expect(issue?.index).toBe(3)
  })

  it('提供了推薦語，字卡是它的原文（或原文裡的一段）：過；改寫過：擋', () => {
    const claims = ['每個經理人都該讀這本書——某某雜誌']
    const ok = checkTrailerScript(
      withPraise('每個經理人都該讀這本書'),
      ideaSettings({ targetSec: 18, claims }),
      FPS,
    )
    expect(codes(ok.errors)).not.toContain('unverified_claim')
    const rewritten = checkTrailerScript(
      withPraise('經理人必讀的一本書'),
      ideaSettings({ targetSec: 18, claims }),
      FPS,
    )
    expect(codes(rewritten.errors)).toContain('unverified_claim')
  })

  it('推薦語一段的旁白也一樣；一般段落的字卡不受這條影響', () => {
    const beats = withPraise('每個經理人都該讀這本書')
    beats[2] = video(4, {
      location: 'b',
      segment: 'praise',
      dialogue: '大家都說它改變了工作方式。',
    })
    const r = checkTrailerScript(
      beats,
      ideaSettings({ targetSec: 18, claims: ['每個經理人都該讀這本書'] }),
      FPS,
    )
    expect(r.errors.filter((e) => e.code === 'unverified_claim').map((e) => e.index)).toEqual([2])
    expect(codes(checkTrailerScript(ideaScript(), ideaSettings(), FPS).errors)).not.toContain(
      'unverified_claim',
    )
  })

  it('劇情型的「praise」段不存在，這條不影響（沿用規則 11 的原樣）', () => {
    const beats = withPraise('每個經理人都該讀')
    expect(codes(checkTrailerScript(beats, settings({ targetSec: 18 }), FPS).errors)).not.toContain(
      'unverified_claim',
    )
  })
})

describe('觀點型：好腳本全部規則都過', () => {
  it('六段齊全、4 張字卡、3 個主視覺：沒有 errors 也沒有 warnings', () => {
    const r = checkTrailerScript(ideaScript(), ideaSettings({ endLine: '12 月 1 日上市' }), FPS)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.totalSec).toBeCloseTo(30, 9)
  })
})

describe('觀點型：短片不提醒「主視覺少於 3 個」', () => {
  const visuals = (n: number, sec: number): TrailerBeat[] => {
    const each = (sec - 3) / n
    return [
      ...Array.from({ length: n }, (_, i) => video(each, { location: `v${String(i)}` })),
      title(3),
    ]
  }

  it('15 秒、1 個主視覺：不提醒；20 秒 1 個提醒、2 個不提醒；30 秒 2 個提醒；劇情型不管', () => {
    const warn = (n: number, sec: number) =>
      codes(checkTrailerScript(visuals(n, sec), ideaSettings({ targetSec: sec }), FPS).warnings)
    expect(warn(1, 15)).not.toContain('few_visuals')
    expect(warn(1, 20)).toContain('few_visuals')
    expect(warn(2, 20)).not.toContain('few_visuals')
    expect(warn(2, 30)).toContain('few_visuals')
    expect(warn(3, 30)).not.toContain('few_visuals')
  })
})

describe('觀點型：作者那一段（作者經歷）只能是使用者給的字或文本裡的原文', () => {
  const authorBeats = (text: string, dialogue = ''): TrailerBeat[] => [
    video(4, { location: 'a' }),
    video(4, { location: 'b' }),
    video(4, { location: 'c' }),
    {
      ...card(text, 3),
      segment: 'author',
      ...(dialogue ? { dialogue } : {}),
    },
    title(3),
  ]
  const run = (text: string, patch: Partial<TrailerSettings> = {}, dialogue = '') =>
    checkTrailerScript(authorBeats(text, dialogue), ideaSettings({ targetSec: 18, ...patch }), FPS)

  it('編出來的頭銜、經歷：擋（unverified_author，指到那一格）', () => {
    const r = run('哈佛教授')
    const issue = r.errors.find((e) => e.code === 'unverified_author')
    expect(issue?.index).toBe(3)
    expect(run('十年顧問經歷').errors.map((e) => e.code)).toContain('unverified_author')
  })

  it('作者欄的名字（含「作者：」「by」稱呼）、推薦語原文、文本裡逐字寫著的：過', () => {
    expect(codes(run('某作者').errors)).not.toContain('unverified_author')
    expect(codes(run('作者：某作者').errors)).not.toContain('unverified_author')
    expect(codes(run('by 某作者').errors)).not.toContain('unverified_author')
    const text = '某作者在顧問業做了二十年，寫過三本書。'
    expect(codes(run('做了二十年', { sourceText: text }).errors)).not.toContain('unverified_author')
    expect(codes(run('做了二十年').errors)).toContain('unverified_author')
  })

  it('旁白也一樣；其他段落的字不受這條影響', () => {
    const r = checkTrailerScript(
      [
        video(4, { location: 'a' }),
        video(4, { location: 'b', segment: 'author', dialogue: '他是業界公認的專家。' }),
        video(4, { location: 'c' }),
        card('先做最重要的一件', 3),
        title(3),
      ],
      ideaSettings({ targetSec: 18 }),
      FPS,
    )
    expect(r.errors.filter((e) => e.code === 'unverified_author').map((e) => e.index)).toEqual([1])
  })

  it('劇情型沒有「author」這一段：這條不影響', () => {
    expect(
      codes(checkTrailerScript(authorBeats('哈佛教授'), settings({ targetSec: 18 }), FPS).errors),
    ).not.toContain('unverified_author')
  })
})

describe('ShotOverlaySchema：疊在不動畫面上的字（A：字疊圖）', () => {
  it('主文字去頭尾空白、至少 1 個字；小字可以沒有（預設空字串）；上限只是防呆', () => {
    expect(ShotOverlaySchema.parse({ text: '  寵辱不驚  ' })).toEqual({
      text: '寵辱不驚',
      subtext: '',
    })
    expect(ShotOverlaySchema.parse({ text: '閒看庭前花開花落', subtext: '——《菜根譚》' })).toEqual({
      text: '閒看庭前花開花落',
      subtext: '——《菜根譚》',
    })
    expect(ShotOverlaySchema.safeParse({ text: '   ' }).success).toBe(false)
    expect(ShotOverlaySchema.safeParse({ text: 'a'.repeat(81) }).success).toBe(false)
    expect(ShotOverlaySchema.safeParse({ text: '字', subtext: 'b'.repeat(61) }).success).toBe(false)
  })

  it('字數上限的常數：主文字中文 24／英文 12，小字中文 16／英文 8', () => {
    expect([
      OVERLAY_MAX_CJK,
      OVERLAY_MAX_WORDS,
      OVERLAY_SUB_MAX_CJK,
      OVERLAY_SUB_MAX_WORDS,
    ]).toEqual([24, 12, 16, 8])
  })

  it('overlaySize：中文數字（不含空白）、英文數單字；小字的上限比主文字小', () => {
    expect(overlaySize('閒看庭前 花開花落', 'text')).toEqual({ used: 8, max: 24, cjk: true })
    expect(overlaySize('Some light, and someone to keep it', 'text')).toEqual({
      used: 7,
      max: 12,
      cjk: false,
    })
    expect(overlaySize('——《菜根譚》', 'sub')).toEqual({ used: 7, max: 16, cjk: true })
    expect(overlaySize('Hong Zicheng', 'sub')).toEqual({ used: 2, max: 8, cjk: false })
    expect(overlaySize('   ', 'text').used).toBe(0)
    // 還沒有字：看介面語言決定上限
    expect(overlaySize('', 'text', true).max).toBe(24)
    expect(overlaySize('', 'text').max).toBe(12)
  })

  it('鏡頭（ShotSchema）可以帶 overlay、沒有就沒有這個欄位；ShotEdit 可以設或用 null 清掉', () => {
    const base = {
      id: 'a'.repeat(8),
      projectId: 'p'.repeat(8),
      number: 1,
      order: 0,
    }
    expect(ShotSchema.parse(base).overlay).toBeUndefined()
    const withOverlay = ShotSchema.parse({ ...base, overlay: { text: '一句話' } })
    expect(withOverlay.overlay).toEqual({ text: '一句話', subtext: '' })
    expect(ShotEditSchema.parse({ overlay: { text: '一句話' } }).overlay).toEqual({
      text: '一句話',
      subtext: '',
    })
    expect(ShotEditSchema.parse({ overlay: null }).overlay).toBeNull()
    expect(ShotEditSchema.parse({}).overlay).toBeUndefined()
  })
})
