import type { LlmRequest } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { demoShortenedLine } from './demo-narration'

const ask = (limit: number, line: string): LlmRequest => ({
  capability: 'llm',
  modelId: 'mock/llm',
  messages: [
    {
      role: 'user',
      content: `請把這句旁白改短。這句旁白要在 2 秒內念完，字數上限 ${String(limit)} 個字（含標點）。\n原句：${line}`,
    },
  ],
})

describe('demoShortenedLine：示範模式的假旁白改短', () => {
  it('不是改短請求就不接', () => {
    expect(
      demoShortenedLine({
        capability: 'llm',
        modelId: 'm',
        messages: [{ role: 'user', content: '你好' }],
      }),
    ).toBeUndefined()
  })
  it('原句已經在上限內：原樣回', () => {
    expect(demoShortenedLine(ask(20, '短短一句。'))).toBe('短短一句。')
  })
  it('太長：停在上限內最後一個逗號、補句號；一定比上限短', () => {
    const line =
      '黑藤爬滿了斷橋，她一個人守著最後一盞燈，直到有人敲門，門外的人說他來自河的另一邊。'
    const out = demoShortenedLine(ask(25, line)) ?? ''
    expect(out.length).toBeLessThanOrEqual(25)
    expect(out.endsWith('。')).toBe(true)
    expect(line.startsWith(out.slice(0, -1))).toBe(true)
  })
  it('沒有標點可停：直接截斷再補句號', () => {
    const out = demoShortenedLine(ask(10, '一二三四五六七八九十甲乙丙丁')) ?? ''
    expect(out).toBe('一二三四五六七八九。')
  })
})
