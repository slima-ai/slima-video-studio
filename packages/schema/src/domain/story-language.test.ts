import { describe, expect, it } from 'vitest'

import { isChineseText, storyLanguageNote } from './story-language'

describe('這段文字算不算中文：有漢字，而且沒有假名、韓文字母', () => {
  it.each([
    ['一隻貓在雨夜找到溫暖的家。', true],
    ['小饅頭 and the red seed（中英混著寫）', true],
    ['東京', true], // 只有漢字、看不出是日文：照規則算中文
  ])('%s → 中文：%s', (text, expected) => {
    expect(isChineseText(text)).toBe(expected)
  })

  it.each([
    ['Mina is the last keeper of a small lighthouse.'],
    ['ミナは小さな灯台の最後の番人でした。'], // 日文：片假名＋漢字
    ['嵐の夜、東京の港で。'], // 日文：平假名＋漢字
    ['ﾐﾅは灯台の番人'], // 半形片假名
    ['미나는 작은 등대의 마지막 지기였습니다.'], // 韓文
    ['미나는 港口에서'], // 韓文夾漢字：有韓文字母，不算中文
    ['Mina vive en un faro'], // 西班牙文
    ['1234 !?'],
    [''],
  ])('%s → 不是中文', (text) => {
    expect(isChineseText(text)).toBe(false)
  })
})

describe('storyLanguageNote：不是中文才附那一句', () => {
  it('中文回空字串（提示一字不改）；其他語言回指定的那一句', () => {
    expect(storyLanguageNote('一隻貓', '用故事的語言寫')).toBe('')
    expect(storyLanguageNote('A cat', '用故事的語言寫')).toBe('用故事的語言寫')
    expect(storyLanguageNote('猫がいた。', '用故事的語言寫')).toBe('用故事的語言寫')
  })
})
