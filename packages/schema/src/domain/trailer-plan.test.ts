import { describe, expect, it } from 'vitest'

import { TrailerScriptSchema } from './trailer-plan'

const beat = { beatKind: 'video', durationSec: 3 }

describe('TrailerScriptSchema：people（角色的外觀）', () => {
  it('舊的腳本 JSON 沒有 people：照樣解析得過，people 是空陣列', () => {
    const script = TrailerScriptSchema.parse({ title: 'x', beats: [beat] })
    expect(script.people).toEqual([])
  })

  it('people 一筆：名字、長相、服裝；長相與服裝沒寫就是空字串', () => {
    const script = TrailerScriptSchema.parse({
      title: 'x',
      people: [{ name: '小葉', look: '短髮的少女', outfit: '靛藍短衫' }, { name: '老鐘' }],
      beats: [beat],
    })
    expect(script.people).toEqual([
      { name: '小葉', look: '短髮的少女', outfit: '靛藍短衫' },
      { name: '老鐘', look: '', outfit: '' },
    ])
  })

  it('people 沒有名字：不收', () => {
    expect(
      TrailerScriptSchema.safeParse({ title: 'x', people: [{ look: '短髮' }], beats: [beat] })
        .success,
    ).toBe(false)
  })
})
