import { describe, expect, it } from 'vitest'

import {
  CHARACTER_PROMPT_KINDS,
  CHARACTER_PROMPT_VARS,
  DEFAULT_CHARACTER_PROMPTS,
  renderCharacterPrompt,
  resolveCharacterPrompt,
} from './character-prompts'

describe('角色提示詞範本', () => {
  it('三種範本都有預設，而且用到的記號都在說明清單裡（使用者看得到每個記號的意思）', () => {
    const known = new Set<string>(CHARACTER_PROMPT_VARS.map((v) => v.name))
    for (const kind of CHARACTER_PROMPT_KINDS) {
      const template = DEFAULT_CHARACTER_PROMPTS[kind]
      expect(template.length).toBeGreaterThan(20)
      const used = [...template.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1] ?? '')
      expect(used.length).toBeGreaterThan(0)
      for (const name of used)
        expect(known.has(name), `${kind} 用了沒說明的記號 ${name}`).toBe(true)
    }
  })

  it('有參考圖的範本要求「照參考圖、不重新設計」；沒有參考圖的概念圖範本不提參考圖', () => {
    expect(DEFAULT_CHARACTER_PROMPTS.conceptRef).toContain('必須和參考圖完全一致')
    expect(DEFAULT_CHARACTER_PROMPTS.conceptRef).toContain('不要重新設計')
    expect(DEFAULT_CHARACTER_PROMPTS.concept).not.toContain('參考圖')
  })

  it('resolve：沒自訂（空白、只有空白）就用預設；有自訂就用自訂（去掉前後空白）', () => {
    expect(resolveCharacterPrompt(undefined, 'concept')).toBe(DEFAULT_CHARACTER_PROMPTS.concept)
    expect(resolveCharacterPrompt('  \n ', 'turnaround')).toBe(DEFAULT_CHARACTER_PROMPTS.turnaround)
    expect(resolveCharacterPrompt('  我的範本 {{名稱}}  ', 'concept')).toBe('我的範本 {{名稱}}')
  })

  it('render：把記號換成內容；不認得的記號原樣留著；內容裡的 {{…}} 不會被再換一次', () => {
    expect(renderCharacterPrompt('{{名稱}}在{{地點}}', { 名稱: '阿鐵' })).toBe('阿鐵在{{地點}}')
    expect(renderCharacterPrompt('{{外觀}}｜{{畫風}}', { 外觀: '長得像{{畫風}}', 畫風: 'X' })).toBe(
      '長得像{{畫風}}｜X',
    )
  })
})
