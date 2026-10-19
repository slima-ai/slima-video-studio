import { describe, expect, it } from 'vitest'

import { choicesFor, edgeFor, explainConnection, explainLink, portKind } from './connection-rules'
import { makeDemo } from '../../test/canvas-demo'

const graph = makeDemo(4)
const link = (
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): Parameters<typeof explainConnection>[0] => ({ source, sourceHandle, target, targetHandle })

describe('連線規則：合法才接，不合法回一行白話提示', () => {
  it('角色可以接到鏡頭的「出場角色」', () => {
    expect(explainConnection(link('char:0', 'char-out', 'shot:1', 'shot-ref-char'), graph)).toBe(
      undefined,
    )
  })

  it('同一個角色已經在這一鏡，不能重複接', () => {
    expect(explainConnection(link('char:0', 'char-out', 'shot:0', 'shot-ref-char'), graph)).toBe(
      '阿鐵已經在這一鏡',
    )
  })

  it('角色只能接到鏡頭、影片只收圖、場只能接到剪輯', () => {
    expect(explainConnection(link('char:0', 'char-out', 'shot:1:video', 'vid-in'), graph)).toBe(
      '角色只能接到鏡頭',
    )
    expect(explainConnection(link('shot:1', 'shot-out', 'shot:1:video', 'vid-in'), graph)).toBe(
      '鏡頭只能接到它的圖',
    )
    expect(explainConnection(link('scene:0', 'scene-out', 'shot:0', 'shot-ref-loc'), graph)).toBe(
      '場只能接到剪輯',
    )
  })

  it('不能接到自己；輸入點接輸入點也不行', () => {
    expect(explainConnection(link('shot:0', 'shot-out', 'shot:0', 'shot-ref-char'), graph)).toBe(
      '不能接到自己',
    )
    expect(
      explainConnection(link('char:0', 'shot-ref-char', 'shot:1', 'shot-ref-char'), graph),
    ).toBe('這裡接不起來')
  })

  it('鏡頭只能接到「自己的」圖', () => {
    expect(explainConnection(link('shot:0', 'shot-out', 'shot:1:image', 'img-in'), graph)).toBe(
      '這個鏡頭的圖在它旁邊',
    )
  })

  it('一次只收一條線的輸入點（剪輯的槽、鏡頭的地點）', () => {
    expect(explainConnection(link('scene:1', 'scene-out', 'cut', 'cut-slot-1'), graph)).toBe(
      '這一場已經接在剪輯上了',
    )
    expect(explainConnection(link('loc:0', 'loc-out', 'shot:1', 'shot-ref-loc'), graph)).toBe(
      '這兩個已經接在一起了',
    )
  })

  it('edgeFor：參考類畫成虛線的參考線，其餘是主線', () => {
    const ref = edgeFor(link('char:0', 'char-out', 'shot:1', 'shot-ref-char'), graph.nodes)
    expect(ref.type).toBe('ref')
    expect(ref.data?.tone).toBe('ref')
    const main = edgeFor(link('shot:1', 'shot-out', 'shot:1:image', 'img-in'), graph.nodes)
    expect(main.type).toBe('flow')
  })

  it('放開在空白處：只列接得上的新節點，固定的一串（鏡頭→圖→影片）不從「＋」新增', () => {
    expect(choicesFor('char-out', 'out').map((c) => c.kind)).toEqual(['shot'])
    expect(choicesFor('loc-out', 'out').map((c) => c.kind)).toEqual(['shot', 'scene'])
    expect(choicesFor('shot-out', 'out')).toEqual([])
    expect(choicesFor('img-first', 'in').map((c) => c.kind)).toEqual(['freeImage'])
    expect(portKind('cut-slot-7')).toBe('cut-slot')
  })
})

describe('explainLink：現在拉得動的線只有角色→鏡頭、地點→場或鏡頭', () => {
  it('角色接到鏡頭可以', () => {
    expect(
      explainLink(
        {
          source: 'char:0',
          sourceHandle: 'char-out',
          target: 'shot:1',
          targetHandle: 'shot-ref-char',
        },
        graph,
      ),
    ).toBeUndefined()
  })

  it('其他規則上合法、但是固定一串的線不用手動接', () => {
    const open = { ...graph, edges: graph.edges.filter((e) => e.target !== 'shot:1:image') }
    const connection = {
      source: 'shot:1',
      sourceHandle: 'shot-out',
      target: 'shot:1:image',
      targetHandle: 'img-in',
    }
    expect(explainConnection(connection, open)).toBeUndefined()
    expect(explainLink(connection, open)).toContain('不用手動接')
  })

  it('規則本身擋下的，沿用規則的說明', () => {
    expect(
      explainLink(
        {
          source: 'char:0',
          sourceHandle: 'char-out',
          target: 'shot:0',
          targetHandle: 'shot-ref-char',
        },
        graph,
      ),
    ).toBe('阿鐵已經在這一鏡')
  })
})
