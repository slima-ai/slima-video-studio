import { DEFAULT_LOCALE, setLocale, t } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { NODE_INFO } from './nodes'

const titleOf = (type: string): string => {
  const info = NODE_INFO[type]
  if (!info) throw new Error(`沒有這個節點：${type}`)
  return t(info.title)
}

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe('節點圖上的節點名稱', () => {
  it('繁中維持原本的名稱；英文沒有中文，也不出現「node」這個詞', () => {
    expect(titleOf('$input')).toBe('這個鏡頭')
    expect(titleOf('forEach')).toBe('對每個鏡頭執行')
    setLocale('en')
    const titles = Object.values(NODE_INFO).map((info) => t(info.title))
    expect(titles.length).toBeGreaterThan(10)
    for (const title of titles) {
      expect(title).not.toMatch(/[㐀-鿿]/)
      expect(title).not.toMatch(/\bnodes?\b/i)
    }
    expect(titleOf('$input')).toBe('This shot')
  })
})
