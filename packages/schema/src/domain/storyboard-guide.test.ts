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
