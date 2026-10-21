import type { CanvasAiChanged } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { markableKeys, removedMessage } from './ai-marks'

describe('markableKeys：哪些節點標「AI 剛改」', () => {
  it('改了的、新出現的都標；剪輯與展開的步驟格不標', () => {
    expect(
      markableKeys({
        added: ['character:c1'],
        changed: ['shot:a', 'cut', 'shot:a:step:prompt', 'scene:s1'],
      }),
    ).toEqual(['character:c1', 'shot:a', 'scene:s1'])
  })

  it('新增鏡頭時它的圖和影片也跟著出現，只標鏡頭；既有鏡頭的圖或影片變了才各自標', () => {
    expect(
      markableKeys({
        added: ['shot:new', 'shot:new:image', 'shot:new:video'],
        changed: ['shot:old:video', 'cut'],
      }),
    ).toEqual(['shot:new', 'shot:old:video'])
  })

  it('同一個鍵不重複', () => {
    expect(markableKeys({ added: ['shot:a'], changed: ['shot:a'] })).toEqual(['shot:a'])
  })
})

describe('removedMessage：AI 刪了東西的提示', () => {
  const shot = (n: number, over: Partial<CanvasAiChanged['removed'][number]> = {}) => ({
    key: `shot:${String(n)}`,
    title: `第 ${String(n)} 鏡`,
    kind: 'shot' as const,
    ...over,
  })

  it('有內容的鏡頭：第 N 鏡後面帶描述開頭；跟著不見的圖和影片不另外說', () => {
    expect(
      removedMessage([
        shot(3, { summary: '看見暖光' }),
        { key: 'shot:3:image', title: '第 3 鏡・第一張畫面', kind: 'image' },
        { key: 'shot:3:video', title: '第 3 鏡・影片', kind: 'video' },
      ]),
    ).toBe('AI 刪了第 3 鏡「看見暖光」，按「復原」可以找回來')
  })

  it('描述太長只帶開頭；沒有描述就只有第 N 鏡', () => {
    expect(removedMessage([shot(2, { summary: '雨夜的屋簷下，貓縮成一團' })])).toBe(
      'AI 刪了第 2 鏡「雨夜的屋簷下，貓…」，按「復原」可以找回來',
    )
    expect(removedMessage([shot(2)])).toBe('AI 刪了第 2 鏡，按「復原」可以找回來')
  })

  it('空的節點不列名字，只說幾個空的什麼；鏡頭寫鏡頭、場寫場景', () => {
    const scenes = [4, 5, 6].map((n) => ({
      key: `scene:${String(n)}`,
      title: `第 ${String(n)} 場・示範短片`,
      kind: 'scene' as const,
      empty: true,
    }))
    expect(removedMessage(scenes)).toBe('AI 刪了 3 個空的場景，按「復原」可以找回來')
    expect(removedMessage([shot(1, { empty: true }), shot(2, { empty: true })])).toBe(
      'AI 刪了 2 個空的鏡頭，按「復原」可以找回來',
    )
  })

  it('有內容的列名字、空的另外數：混在一起時兩段都說', () => {
    expect(
      removedMessage([
        shot(3, { summary: '看見暖光' }),
        shot(4, { empty: true }),
        shot(5, { empty: true }),
      ]),
    ).toBe('AI 刪了第 3 鏡「看見暖光」、2 個空的鏡頭，按「復原」可以找回來')
  })

  it('Claude 對話正在做事時，復原是整輪一起退，提示要這樣說（一律寫 AI，不寫 Claude）', () => {
    const text = removedMessage([shot(3, { summary: '看見暖光' })], true)
    expect(text).toBe(
      'AI 刪了第 3 鏡「看見暖光」，按「復原」可以找回來（這一輪 AI 做的其他改動也會一起退回）',
    )
    expect(text).not.toContain('Claude')
  })

  it('角色、便條等加上種類；有內容的超過三個寫總數', () => {
    expect(removedMessage([{ key: 'character:c', title: '阿鐵', kind: 'character' }])).toBe(
      'AI 刪了角色「阿鐵」，按「復原」可以找回來',
    )
    expect(removedMessage([1, 2, 3, 4].map((n) => shot(n, { summary: `畫面${String(n)}` })))).toBe(
      'AI 刪了第 1 鏡「畫面1」、第 2 鏡「畫面2」、第 3 鏡「畫面3」等 4 個，按「復原」可以找回來',
    )
  })

  it('連著好幾次刪除合成的一則：鏡頭不寫號碼（每次刪完重新編號，後面記的號碼不是原本的），只靠描述開頭；場只留名字', () => {
    // 刪第 1 鏡「開場」，原本的第 2 鏡變成第 1 鏡，再被刪：兩筆記下來的號碼都是「第 1 鏡」
    const text = removedMessage(
      [shot(1, { summary: '開場：小機器人' }), shot(1, { key: 'shot:b', summary: '第 2 段：花' })],
      true,
      true,
    )
    expect(text).toBe(
      'AI 刪了鏡頭「開場：小機器人」、鏡頭「第 2 段：花」，按「復原」可以找回來（這一輪 AI 做的其他改動也會一起退回）',
    )
    expect(text).not.toContain('第 1 鏡')
    expect(
      removedMessage(
        [{ key: 'scene:a', title: '第 2 場・黑藤裂谷', kind: 'scene' as const }],
        false,
        true,
      ),
    ).toBe('AI 刪了場景「黑藤裂谷」，按「復原」可以找回來')
    // 只刪一次（號碼是對的）照舊寫「第 N 鏡「…」」
    expect(removedMessage([shot(3, { summary: '看見暖光' })], true, false)).toContain(
      '第 3 鏡「看見暖光」',
    )
  })

  it('只有跟著不見的圖與影片：不用提示', () => {
    expect(removedMessage([{ key: 'shot:a:image', title: 'x', kind: 'image' }])).toBeUndefined()
  })
})
