import { describe, expect, it } from 'vitest'

import { cleanShortenedLine, narrationShortenMessage } from './narration'

describe('cleanShortenedLine：把模型的回答整理成一句旁白', () => {
  const original = '黑藤爬滿了斷橋，她一個人守著最後一盞燈。'
  it('拿掉引號與程式碼框、只取第一行', () => {
    expect(cleanShortenedLine('「她守著最後一盞燈。」', original)).toBe('她守著最後一盞燈。')
    expect(cleanShortenedLine('```\n她守著最後一盞燈。\n```', original)).toBe('她守著最後一盞燈。')
    expect(
      cleanShortenedLine('"She kept the last lamp."', 'She kept the very last lamp burning alone.'),
    ).toBe('She kept the last lamp.')
    expect(cleanShortenedLine('她守著燈。\n（以上是改短的版本）', original)).toBe('她守著燈。')
  })
  it('空的、或沒有比原句短：回 undefined（不重念）', () => {
    expect(cleanShortenedLine('   \n  ', original)).toBeUndefined()
    expect(cleanShortenedLine(original, original)).toBeUndefined()
    expect(cleanShortenedLine(`${original}呀`, original)).toBeUndefined()
  })
})

describe('narrationShortenMessage', () => {
  it('寫明秒數、字數上限與原句', () => {
    const text = narrationShortenMessage({ line: '一句很長的話', roomSec: 1.6, maxChars: 12 })
    expect(text).toContain('請把這句旁白改短')
    expect(text).toContain('1.6 秒')
    expect(text).toContain('字數上限 12 個字')
    expect(text.endsWith('原句：一句很長的話')).toBe(true)
  })
})
