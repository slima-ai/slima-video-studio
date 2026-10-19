import { describe, expect, it } from 'vitest'

import { AppSettingsPatchSchema, AppSettingsSchema } from './settings'
import {
  DEFAULT_STORYBOARD_GUIDE,
  STORYBOARD_GUIDE_MAX_CHARS,
  resolveStoryboardGuide,
  storyboardGuidePrompt,
} from './storyboard-guide'

describe('分鏡準則', () => {
  it('預設準則不會超過自訂上限的一半（使用者要有改的空間）', () => {
    expect(DEFAULT_STORYBOARD_GUIDE.length).toBeLessThan(STORYBOARD_GUIDE_MAX_CHARS / 2)
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
    const tooLong = 'a'.repeat(STORYBOARD_GUIDE_MAX_CHARS + 1)
    expect(AppSettingsSchema.safeParse({ storyboardGuide: tooLong }).success).toBe(false)
    expect(AppSettingsPatchSchema.safeParse({ storyboardGuide: tooLong }).success).toBe(false)
    expect(AppSettingsPatchSchema.parse({ storyboardGuide: '' })).toEqual({ storyboardGuide: '' })
  })

  it('只改別的欄位的更新不會帶出預設的花費上限（不然會把使用者設的上限蓋掉）', () => {
    expect(AppSettingsPatchSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' })
    expect(
      AppSettingsPatchSchema.parse({ budget: { perRunLimitUsd: 12, projectLimitUsd: 40 } }),
    ).toEqual({ budget: { perRunLimitUsd: 12, projectLimitUsd: 40 } })
  })
})
