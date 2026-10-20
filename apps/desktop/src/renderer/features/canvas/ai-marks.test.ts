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
  it('鏡頭用「第 N 鏡」；跟著不見的圖和影片不另外說', () => {
    expect(
      removedMessage([
        { key: 'shot:a', title: '第 3 鏡', kind: 'shot' },
        { key: 'shot:a:image', title: '第 3 鏡・第一張畫面', kind: 'image' },
        { key: 'shot:a:video', title: '第 3 鏡・影片', kind: 'video' },
      ]),
    ).toBe('AI 刪了第 3 鏡，可以復原')
  })

  it('Claude 對話正在做事時，復原是整輪一起退，提示要這樣說', () => {
    expect(removedMessage([{ key: 'shot:a', title: '第 3 鏡', kind: 'shot' }], true)).toBe(
      'AI 刪了第 3 鏡，可以復原（會連 Claude 這一輪的其他改動一起退回）',
    )
  })

  it('角色、便條等加上種類；超過三個寫總數', () => {
    expect(removedMessage([{ key: 'character:c', title: '阿鐵', kind: 'character' }])).toBe(
      'AI 刪了角色「阿鐵」，可以復原',
    )
    expect(
      removedMessage(
        ['1', '2', '3', '4'].map((n) => ({
          key: `shot:${n}`,
          title: `第 ${n} 鏡`,
          kind: 'shot' as const,
        })),
      ),
    ).toBe('AI 刪了第 1 鏡、第 2 鏡、第 3 鏡等 4 個，可以復原')
  })

  it('只有跟著不見的圖與影片：不用提示', () => {
    expect(removedMessage([{ key: 'shot:a:image', title: 'x', kind: 'image' }])).toBeUndefined()
  })
})
