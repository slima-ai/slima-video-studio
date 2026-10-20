import { describe, expect, it } from 'vitest'

import { makeDemo } from '../../test/canvas-demo'
import { blockedReason, planDelete } from './delete-plan'

const { nodes } = makeDemo(2)
const idOf = (kind: string, index = 0): string => {
  const found = nodes.filter((n) => n.data.kind === kind)[index]
  if (!found) throw new Error(`沒有 ${kind}`)
  return found.id
}
const node = (kind: string, extra: Record<string, unknown> = {}) => ({
  id: `node:${kind}`,
  position: { x: 0, y: 0 },
  data: { kind, title: kind, ...extra },
})

describe('planDelete：選取的節點要刪什麼、刪完告訴使用者什麼後果', () => {
  it('鏡頭：寫出是哪一鏡，連同圖與影片版本', () => {
    const { plan } = planDelete(nodes, new Set([idOf('shot')]))
    expect(plan?.keys).toEqual([idOf('shot')])
    expect(plan?.message).toContain('圖和影片版本')
    expect(plan?.message).toContain(nodes.find((n) => n.id === idOf('shot'))?.data.title)
  })

  it('鏡頭連同它的圖與影片一起選：只算一個鏡頭，不重複', () => {
    const shot = nodes.find((n) => n.data.kind === 'shot')
    const chain = nodes.filter((n) => n.data.shotId === shot?.data.shotId).map((n) => n.id)
    const { plan, reason } = planDelete(nodes, new Set(chain))
    expect(plan?.keys).toEqual([idOf('shot')])
    expect(reason).toBeUndefined()
  })

  it('單獨選到圖或影片：清掉採用中的版本，說明版本還在生成紀錄裡', () => {
    const { plan } = planDelete(nodes, new Set([idOf('video'), idOf('image', 1)]))
    expect(plan?.keys).toEqual([idOf('video'), idOf('image', 1)])
    expect(plan?.message).toContain('版本還在生成紀錄裡')
  })

  it('還沒有圖的格子：沒有東西可以刪，原因說明要刪就刪鏡頭', () => {
    const empty = nodes.map((n) =>
      n.id === idOf('image') ? { ...n, data: { ...n.data, thumb: undefined } } : n,
    )
    const { plan, reason } = planDelete(empty, new Set([idOf('image')]))
    expect(plan).toBeUndefined()
    expect(reason).toContain('還沒生成')
    expect(reason).toContain('請刪鏡頭')
  })

  it('剪輯不能刪，原因是它由場自動長出來；什麼都沒選就什麼都不做', () => {
    const { plan, reason } = planDelete(nodes, new Set([idOf('cut')]))
    expect(plan).toBeUndefined()
    expect(reason).toContain('由「場」自動長出來')
    expect(planDelete(nodes, new Set())).toEqual({})
  })

  it('場說明鏡頭會留著；角色說明出場的鏡頭已拿掉這個角色；地點說明已清空', () => {
    expect(planDelete(nodes, new Set([idOf('scene')])).plan?.message).toContain('鏡頭留著')
    expect(planDelete(nodes, new Set([idOf('character')])).plan?.message).toContain(
      '出場的鏡頭已拿掉這個角色',
    )
    expect(planDelete(nodes, new Set([idOf('location')])).plan?.message).toContain('已清空地點')
  })

  it('一句話也刪得掉：說明它生出來的內容都留著', () => {
    const oneliner = node('oneliner', { title: '一句話' })
    const { plan, reason } = planDelete([...nodes, oneliner as never], new Set([oneliner.id]))
    expect(reason).toBeUndefined()
    expect(plan?.keys).toEqual([oneliner.id])
    expect(plan?.message).toBe('已刪除一句話；它生出來的場、鏡頭、圖和影片都留著')
  })

  it('便條、群組、上傳的圖與影片都刪得掉；和鏡頭一起選就一起刪、一起說明', () => {
    const note = node('note', { title: '便條', summary: '第 3 鏡要更暗' })
    const group = node('group', { title: '開場' })
    const image = node('freeImage', { title: '雨夜.png' })
    const all = [...nodes, note, group, image] as never[]
    const free = planDelete(all, new Set([note.id, group.id, image.id])).plan
    expect(new Set(free?.keys)).toEqual(new Set([note.id, group.id, image.id]))
    expect(free?.message).toContain('已刪除便條')
    expect(free?.message).toContain('已刪除群組「開場」；框裡的格子留著')
    expect(free?.message).toContain('已刪除圖片「雨夜.png」')
    const mixed = planDelete(all, new Set([idOf('shot'), group.id])).plan
    expect(mixed?.keys).toEqual([idOf('shot'), group.id])
  })

  it('選了刪不掉的（剪輯）和刪得掉的：只刪刪得掉的', () => {
    const { plan } = planDelete(nodes, new Set([idOf('cut'), idOf('shot')]))
    expect(plan?.keys).toEqual([idOf('shot')])
  })
})

describe('blockedReason：停用的刪除鈕，滑過說明的原因', () => {
  it('剪輯、步驟、沒有結果的圖與影片刪不掉，原因寫得具體', () => {
    expect(blockedReason(nodes.find((n) => n.data.kind === 'cut') as never)).toContain(
      '由「場」自動長出來',
    )
    expect(blockedReason(node('step') as never)).toContain('收合步驟')
    expect(blockedReason(node('image') as never)).toContain('第一張畫面還沒生成')
    expect(blockedReason(node('video') as never)).toContain('影片還沒生成')
  })

  it('其他種類（含有結果的圖與影片）刪得掉', () => {
    for (const kind of ['oneliner', 'scene', 'shot', 'character', 'location', 'note', 'group']) {
      expect(blockedReason(node(kind) as never)).toBeUndefined()
    }
    expect(blockedReason(node('image', { thumb: 'x' }) as never)).toBeUndefined()
    expect(blockedReason(node('video', { videoSrc: 'x' }) as never)).toBeUndefined()
  })
})
