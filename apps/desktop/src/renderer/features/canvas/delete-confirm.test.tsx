import { describe, expect, it } from 'vitest'

import { makeDemo } from '../../test/canvas-demo'
import { planDelete } from './delete-confirm'

const { nodes } = makeDemo(2)
const idOf = (kind: string, index = 0): string => {
  const found = nodes.filter((n) => n.data.kind === kind)[index]
  if (!found) throw new Error(`沒有 ${kind}`)
  return found.id
}

describe('planDelete：選取的節點要刪什麼、先說明什麼後果', () => {
  it('鏡頭：列出名字，說明連同圖與影片；可以復原', () => {
    const { plan } = planDelete(nodes, new Set([idOf('shot')]))
    expect(plan?.keys).toEqual([idOf('shot')])
    expect(plan?.lines[0]).toContain('圖和影片版本')
    expect(plan?.undoable).toBe(true)
  })

  it('鏡頭連同它的圖與影片一起選：只算一個鏡頭，不重複', () => {
    const shot = nodes.find((n) => n.data.kind === 'shot')
    const chain = nodes.filter((n) => n.data.shotId === shot?.data.shotId).map((n) => n.id)
    const { plan, reason } = planDelete(nodes, new Set(chain))
    expect(plan?.keys).toEqual([idOf('shot')])
    expect(reason).toBeUndefined()
  })

  it('單獨選到圖或影片：清掉採用中的版本，直接做、不用確認（可以復原）', () => {
    const { plan } = planDelete(nodes, new Set([idOf('video'), idOf('image', 1)]))
    expect(plan?.keys).toEqual([idOf('video'), idOf('image', 1)])
    expect(plan?.freeOnly).toBe(true)
    expect(plan?.undoable).toBe(true)
  })

  it('圖和別的一起刪：確認框說明圖只是清掉採用中的版本', () => {
    const { plan } = planDelete(nodes, new Set([idOf('image', 1), idOf('scene')]))
    expect(plan?.freeOnly).toBeUndefined()
    expect(plan?.lines.some((l) => l.includes('的第一張畫面（清掉採用中的版本'))).toBe(true)
  })

  it('還沒有圖的格子：沒有東西可以刪，說明原因', () => {
    const empty = nodes.map((n) =>
      n.id === idOf('image') ? { ...n, data: { ...n.data, thumb: undefined } } : n,
    )
    const { plan, reason } = planDelete(empty, new Set([idOf('image')]))
    expect(plan).toBeUndefined()
    expect(reason).toContain('還沒有圖或影片')
  })

  it('剪輯不能刪；什麼都沒選就什麼都不做', () => {
    expect(planDelete(nodes, new Set([idOf('cut')])).reason).toContain('不能刪')
    expect(planDelete(nodes, new Set())).toEqual({})
  })

  it('場說明鏡頭會留著；角色說明不能復原', () => {
    const scene = planDelete(nodes, new Set([idOf('scene')])).plan
    expect(scene?.lines[0]).toContain('鏡頭會留著')
    expect(scene?.undoable).toBe(true)
    const character = planDelete(nodes, new Set([idOf('character')])).plan
    expect(character?.lines[0]).toContain('出場的鏡頭會拿掉這個角色')
    expect(character?.undoable).toBe(true)
  })

  it('只有便條、群組：直接刪（可以復原）不用確認；和鏡頭一起選就一起確認', () => {
    const note = {
      id: 'node:n1',
      position: { x: 0, y: 0 },
      data: { kind: 'note' as const, title: '便條', summary: '第 3 鏡要更暗' },
    }
    const group = {
      id: 'node:g1',
      position: { x: 0, y: 0 },
      data: { kind: 'group' as const, title: '開場' },
    }
    const all = [...nodes, note, group]
    const free = planDelete(all, new Set([note.id, group.id])).plan
    expect(free).toMatchObject({ keys: [note.id, group.id], freeOnly: true, undoable: true })
    const mixed = planDelete(all, new Set([idOf('shot'), group.id])).plan
    expect(mixed?.freeOnly).toBeUndefined()
    expect(mixed?.keys).toEqual([idOf('shot'), group.id])
    expect(mixed?.lines).toContain('群組「開場」（框裡的格子留著）')
  })
})
