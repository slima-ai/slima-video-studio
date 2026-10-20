import { describe, expect, it } from 'vitest'

import { PORT_TYPE_COLOR, portsOf, type NodeKind } from './canvas-model'

const KINDS: NodeKind[] = [
  'oneliner',
  'scene',
  'shot',
  'image',
  'video',
  'character',
  'location',
  'freeImage',
  'freeVideo',
]

describe('連接點的類型', () => {
  it('每個連接點都有類型與顏色；參考線的連接點一律是「參考」類型（灰色）', () => {
    for (const kind of KINDS) {
      for (const port of portsOf({ kind, title: kind })) {
        expect(PORT_TYPE_COLOR[port.type], `${kind}/${port.id}`).toBeDefined()
        if (port.tone === 'ref') expect(port.type).toBe('ref')
      }
    }
  })

  it('鏡頭的描述是 shot、第一張畫面是 image、剪輯的每一場是 video、成品是 cut', () => {
    const type = (kind: NodeKind, id: string) =>
      portsOf({ kind, title: kind }).find((p) => p.id === id)?.type
    expect(type('shot', 'shot-out')).toBe('shot')
    expect(type('image', 'img-in')).toBe('shot')
    expect(type('image', 'img-out')).toBe('image')
    expect(type('video', 'vid-in')).toBe('image')
    const cut = portsOf({
      kind: 'cut',
      title: '剪輯',
      slots: [{ id: 'cut-slot-1', label: '第 1 場' }],
    })
    expect(cut.find((p) => p.id === 'cut-slot-1')?.type).toBe('video')
    expect(cut.find((p) => p.id === 'cut-out')?.type).toBe('cut')
  })
})
