import { describe, expect, it } from 'vitest'

import {
  choicesFor,
  edgeFor,
  explainConnection,
  explainLink,
  isRewirable,
  portKind,
  replacedEdge,
} from './connection-rules'
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

describe('新線取代舊線、拖端點改接', () => {
  // 再多一個地點：鏡頭 1 已經接著「舊倉庫」
  const first = graph.nodes.find((n) => n.id === 'loc:0')
  if (!first) throw new Error('demo 沒有地點')
  const withSecond = {
    ...graph,
    nodes: [...graph.nodes, { ...first, id: 'loc:1', data: { ...first.data, title: '街角' } }],
  }

  it('接進單線的地點輸入點：新線取代原本那條（不用先剪線）；改接時不行，要先剪目標上原本的', () => {
    const connection = link('loc:1', 'loc-out', 'shot:1', 'shot-ref-loc')
    expect(explainLink(connection, withSecond)).toBe(undefined)
    expect(explainLink(connection, withSecond, { replace: false })).toBe('這裡已經有地點了')
    expect(replacedEdge(connection, withSecond)?.source).toBe('loc:0')
  })

  it('取代只適用地點、第一張畫面；角色可以接很多個、剪輯的槽與圖→影片不取代', () => {
    expect(replacedEdge({ target: 'shot:1', targetHandle: 'shot-ref-char' }, withSecond)).toBe(
      undefined,
    )
    expect(explainConnection(link('scene:1', 'scene-out', 'cut', 'cut-slot-1'), graph)).toBe(
      '這一場已經接在剪輯上了',
    )
    // 沒有舊線可取代
    expect(replacedEdge({ target: 'shot:0', targetHandle: 'shot-ref-loc' }, withSecond)).toBe(
      undefined,
    )
  })

  it('完全一樣的線還是「已經接在一起了」', () => {
    expect(explainLink(link('loc:0', 'loc-out', 'shot:1', 'shot-ref-loc'), withSecond)).toBe(
      '這兩個已經接在一起了',
    )
  })

  it('可以拖端點改接的線：角色、地點、第一張畫面；固定的一串（圖、影片、剪輯）不行', () => {
    for (const port of ['shot-ref-char', 'shot-ref-loc', 'scene-loc', 'img-first']) {
      expect(isRewirable(port)).toBe(true)
    }
    for (const port of ['img-in', 'vid-in', 'cut-slot-1', 'char-ref', 'scene-story', undefined]) {
      expect(isRewirable(port)).toBe(false)
    }
  })

  it('edgeFor 畫出來的線預設不能改接', () => {
    expect(
      edgeFor(link('shot:1', 'shot-out', 'shot:1:image', 'img-in'), graph.nodes).reconnectable,
    ).toBe(false)
  })
})
