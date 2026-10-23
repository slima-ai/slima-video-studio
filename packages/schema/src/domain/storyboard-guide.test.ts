import { afterEach, describe, expect, it } from 'vitest'

import { setLocale } from '../i18n/locale'
import { AppSettingsPatchSchema, AppSettingsSchema } from './settings'
import {
  DEFAULT_STORYBOARD_GUIDE,
  DEFAULT_STORYBOARD_GUIDE_EN,
  STORYBOARD_GUIDE_MAX_CHARS,
  STORYBOARD_GUIDE_MAX_CHARS_EN,
  STORYBOARD_GUIDE_SCHEMA_MAX_CHARS,
  defaultStoryboardGuide,
  isDefaultStoryboardGuide,
  resolveStoryboardGuide,
  storyboardGuideMaxChars,
  storyboardGuidePrompt,
} from './storyboard-guide'

afterEach(() => {
  setLocale('zh-TW')
})

describe('分鏡準則', () => {
  it('預設準則不會超過自訂上限的一半（使用者要有改的空間）', () => {
    expect(DEFAULT_STORYBOARD_GUIDE.length).toBeLessThan(STORYBOARD_GUIDE_MAX_CHARS / 2)
  })

  it('預設準則有「鏡頭語言」那一條：App 的景別、角度、運鏡 id，而且只說直接切、不把溶接淡出當選項', () => {
    for (const id of [
      'extreme_wide',
      'close_up',
      'high',
      'low',
      'dutch',
      'static',
      'push_in',
      'crane',
    ]) {
      expect(DEFAULT_STORYBOARD_GUIDE, id).toContain(id)
    }
    expect(DEFAULT_STORYBOARD_GUIDE).toContain('只有直接切，不要寫溶接、淡出')
    expect(DEFAULT_STORYBOARD_GUIDE.match(/溶接|淡出/g)).toHaveLength(2)
  })

  it('運鏡不預設不動：沒有「沒理由就用 static／就不要動」；每場至少一個帶目的的運鏡、同一種不連續超過兩鏡', () => {
    expect(DEFAULT_STORYBOARD_GUIDE).not.toContain('沒有理由就用')
    expect(DEFAULT_STORYBOARD_GUIDE).not.toContain('沒有理由就不要動')
    expect(DEFAULT_STORYBOARD_GUIDE).toContain('每一場至少有一個帶目的的運鏡')
    expect(DEFAULT_STORYBOARD_GUIDE).toContain('同一種運鏡或角度不要連續超過兩鏡')
    expect(DEFAULT_STORYBOARD_GUIDE).toContain('static 留給對話、停頓與情緒落點')
  })

  it('第 7 條：用前景、背景、遠近說位置；不要把畫面切成上下或左右兩塊描述（圖片模型會畫成兩格拼貼）', () => {
    expect(DEFAULT_STORYBOARD_GUIDE).toContain('用前景、背景、遠近來說位置')
    expect(DEFAULT_STORYBOARD_GUIDE).toContain('不要把畫面切成上下或左右兩塊來描述')
    // 舊的說法（「在畫面的哪個位置」）會讓拆鏡模型寫出「臉在畫面上半部」
    expect(DEFAULT_STORYBOARD_GUIDE).not.toContain('在畫面的哪個位置')
  })

  it('沒自訂（空白）就用預設，有自訂就用自訂', () => {
    expect(resolveStoryboardGuide(undefined)).toBe(DEFAULT_STORYBOARD_GUIDE)
    expect(resolveStoryboardGuide('  \n')).toBe(DEFAULT_STORYBOARD_GUIDE)
    expect(resolveStoryboardGuide(' 多用遠景。 ')).toBe('多用遠景。')
  })

  it('接在提示後面的段落：空字串什麼都不加', () => {
    expect(storyboardGuidePrompt('')).toBe('')
    expect(storyboardGuidePrompt('  ')).toBe('')
    expect(storyboardGuidePrompt('多用遠景。')).toContain('多用遠景。')
  })

  it('設定預設是空字串，舊的設定檔（沒有這個欄位）也讀得進來；太長會被拒絕', () => {
    expect(AppSettingsSchema.parse({}).storyboardGuide).toBe('')
    const tooLong = 'a'.repeat(STORYBOARD_GUIDE_SCHEMA_MAX_CHARS + 1)
    expect(AppSettingsSchema.safeParse({ storyboardGuide: tooLong }).success).toBe(false)
    expect(AppSettingsPatchSchema.safeParse({ storyboardGuide: tooLong }).success).toBe(false)
    expect(AppSettingsPatchSchema.parse({ storyboardGuide: '' })).toEqual({ storyboardGuide: '' })
  })

  it('AI 工具連線的更新不會帶出沒提到的欄位的預設值；埠與額度有範圍', () => {
    expect(AppSettingsPatchSchema.parse({ mcp: { enabled: true } })).toEqual({
      mcp: { enabled: true },
    })
    expect(AppSettingsPatchSchema.safeParse({ mcp: { port: 80 } }).success).toBe(false)
    expect(AppSettingsPatchSchema.safeParse({ mcp: { allowanceUsd: -1 } }).success).toBe(false)
    expect(AppSettingsSchema.parse({}).mcp).toEqual({
      enabled: false,
      port: 47821,
      allowanceUsd: 0,
    })
  })

  it('只改別的欄位的更新不會帶出預設的花費上限（不然會把使用者設的上限蓋掉）', () => {
    expect(AppSettingsPatchSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' })
    expect(
      AppSettingsPatchSchema.parse({ budget: { perRunLimitUsd: 12, projectLimitUsd: 40 } }),
    ).toEqual({ budget: { perRunLimitUsd: 12, projectLimitUsd: 40 } })
  })
})

describe('分鏡準則：英文版與依介面語言挑預設', () => {
  const han = /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/
  const numbered = (text: string): string[] => text.match(/^\d+\. /gm) ?? []
  const bullets = (text: string): number => (text.match(/^- /gm) ?? []).length
  const ids = (text: string): string[] =>
    [
      'extreme_wide',
      'wide',
      'full',
      'medium',
      'close_up',
      'extreme_close_up',
      'eye_level',
      'high',
      'low',
      'over_shoulder',
      'side',
      'back',
      'dutch',
      'push_in',
      'pan',
      'follow',
      'pull_out',
      'handheld',
      'crane',
      'static',
    ].filter((id) => new RegExp(`\\b${id}\\b`).test(text))

  it('英文版對照中文版：同樣 9 條、同樣的條列數、同樣的欄位 id；沒有任何漢字與全形標點', () => {
    expect(numbered(DEFAULT_STORYBOARD_GUIDE_EN)).toEqual(numbered(DEFAULT_STORYBOARD_GUIDE))
    expect(numbered(DEFAULT_STORYBOARD_GUIDE_EN)).toHaveLength(9)
    expect(bullets(DEFAULT_STORYBOARD_GUIDE_EN)).toBe(bullets(DEFAULT_STORYBOARD_GUIDE))
    expect(ids(DEFAULT_STORYBOARD_GUIDE_EN)).toEqual(ids(DEFAULT_STORYBOARD_GUIDE))
    expect(han.test(DEFAULT_STORYBOARD_GUIDE_EN)).toBe(false)
  })

  it('英文版也守住兩條關鍵規則：只有直接切（不寫溶接、淡出）、不把畫面切成兩塊描述', () => {
    expect(DEFAULT_STORYBOARD_GUIDE_EN).toContain(
      'straight cuts only; do not write dissolves or fades',
    )
    expect(DEFAULT_STORYBOARD_GUIDE_EN).toContain(
      'Do not describe the picture as split into top and bottom or left and right halves',
    )
    expect(DEFAULT_STORYBOARD_GUIDE_EN).toContain('at least one move with a purpose')
    expect(DEFAULT_STORYBOARD_GUIDE_EN).toContain('more than two shots in a row')
    expect(DEFAULT_STORYBOARD_GUIDE_EN).not.toMatch(/no reason/i)
  })

  it('兩種語言的預設都不超過各自上限的一半（使用者要有改的空間）', () => {
    expect(DEFAULT_STORYBOARD_GUIDE.length).toBeLessThan(STORYBOARD_GUIDE_MAX_CHARS / 2)
    expect(DEFAULT_STORYBOARD_GUIDE_EN.length).toBeLessThan(STORYBOARD_GUIDE_MAX_CHARS_EN / 2)
    expect(STORYBOARD_GUIDE_SCHEMA_MAX_CHARS).toBe(STORYBOARD_GUIDE_MAX_CHARS_EN)
  })

  it('沒自訂：中文介面是中文版（一字不差）、英文與假語系是英文版；字數上限也跟著語言', () => {
    expect(resolveStoryboardGuide('')).toBe(DEFAULT_STORYBOARD_GUIDE)
    expect(storyboardGuideMaxChars()).toBe(STORYBOARD_GUIDE_MAX_CHARS)
    for (const locale of ['en', 'en-XA'] as const) {
      setLocale(locale)
      expect(resolveStoryboardGuide(undefined)).toBe(DEFAULT_STORYBOARD_GUIDE_EN)
      expect(defaultStoryboardGuide()).toBe(DEFAULT_STORYBOARD_GUIDE_EN)
      expect(storyboardGuideMaxChars()).toBe(STORYBOARD_GUIDE_MAX_CHARS_EN)
    }
    setLocale('zh-TW')
    expect(defaultStoryboardGuide()).toBe(DEFAULT_STORYBOARD_GUIDE)
  })

  it('使用者自訂的原樣保留，換介面語言也不換（中文自訂、英文自訂、混合的都一樣）', () => {
    const customs = [
      '多用遠景。',
      'Prefer wide shots.',
      `${DEFAULT_STORYBOARD_GUIDE}\n10. 多一條`,
      `${DEFAULT_STORYBOARD_GUIDE_EN}\n10. Extra rule`,
    ]
    for (const locale of ['zh-TW', 'en', 'en-XA'] as const) {
      setLocale(locale)
      for (const custom of customs) {
        expect(resolveStoryboardGuide(custom), `${locale}: ${custom.slice(0, 20)}`).toBe(
          custom.trim(),
        )
        expect(isDefaultStoryboardGuide(custom)).toBe(false)
      }
    }
  })

  it('存的剛好是某一種語言的內建預設，算「沒自訂」：換語言就跟著換', () => {
    setLocale('en')
    expect(resolveStoryboardGuide(DEFAULT_STORYBOARD_GUIDE)).toBe(DEFAULT_STORYBOARD_GUIDE_EN)
    expect(resolveStoryboardGuide(` ${DEFAULT_STORYBOARD_GUIDE_EN}\n`)).toBe(
      DEFAULT_STORYBOARD_GUIDE_EN,
    )
    setLocale('zh-TW')
    expect(resolveStoryboardGuide(DEFAULT_STORYBOARD_GUIDE_EN)).toBe(DEFAULT_STORYBOARD_GUIDE)
    expect(isDefaultStoryboardGuide(DEFAULT_STORYBOARD_GUIDE)).toBe(true)
    expect(isDefaultStoryboardGuide(DEFAULT_STORYBOARD_GUIDE_EN)).toBe(true)
  })

  it('接進拆鏡提示的段落：英文介面帶英文準則，開頭的中文框架句不變', () => {
    setLocale('en')
    const prompt = storyboardGuidePrompt(resolveStoryboardGuide(''))
    expect(
      prompt.startsWith(
        '\n\n分鏡準則（安排鏡頭時請照這些原則，但不要違反上面的輸出格式）：\n1. One shot does one thing',
      ),
    ).toBe(true)
    setLocale('zh-TW')
    expect(
      storyboardGuidePrompt(resolveStoryboardGuide('')).includes(DEFAULT_STORYBOARD_GUIDE),
    ).toBe(true)
  })
})
