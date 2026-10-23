import { DEFAULT_LOCALE, setLocale } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { httpError } from '../http/errors'
import { exampleFromJsonSchema } from './json-example'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

const HAN = /[㐀-鿿]/
const schema = {
  type: 'object',
  properties: { title: { type: 'string' }, mood: { type: 'string' }, extra: { type: 'string' } },
}

describe('英文介面的示範內容與供應商錯誤', () => {
  it('示範資料：繁中維持原本的中文範例，英文沒有中文', () => {
    expect(exampleFromJsonSchema(schema)).toEqual({
      title: '示範短片',
      mood: '安靜',
      extra: '示範文字',
    })
    setLocale('en')
    const example = exampleFromJsonSchema(schema) as Record<string, string>
    expect(JSON.stringify(example)).not.toMatch(HAN)
    expect(example.title).toBe('Demo short film')
  })

  it('HTTP 錯誤的白話訊息：英文、帶供應商名字', () => {
    setLocale('en')
    for (const status of [401, 402, 408, 429, 500, 400]) {
      const error = httpError({ name: 'fal.ai' }, status)
      expect(error.userMessage, String(status)).not.toMatch(HAN)
      expect(error.userMessage).toContain('fal.ai')
    }
  })
})
