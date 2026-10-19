import { describe, expect, it } from 'vitest'

import type { CanvasNode } from './canvas-model'
import { nodeEntries, paneEntries } from './context-menu'

const node = (id: string, data: Partial<CanvasNode['data']>): CanvasNode =>
  ({ id, type: 'card', position: { x: 0, y: 0 }, data: { title: id, ...data } }) as CanvasNode

const labels = (n: CanvasNode, selection: CanvasNode[] = []) =>
  nodeEntries(n, selection).map((e) => e.label)

describe('右鍵選單', () => {
  it('影片：打開面板、依狀態的執行、放進成品開關、置中、複製；有影片時可以清掉採用中的版本', () => {
    expect(
      labels(
        node('shot:1:video', { kind: 'video', status: 'done', inCut: true, videoSrc: 'v.mp4' }),
      ),
    ).toEqual([
      '打開面板',
      '重做（產生新的一版）',
      '不放進成品',
      '置中顯示',
      '複製',
      '複製成獨立的一格',
      '清掉採用中的版本',
    ])
    // 還沒有影片：沒有東西可以清
    expect(labels(node('shot:1:video', { kind: 'video', status: 'idle', inCut: false }))).toEqual([
      '打開面板',
      '生成影片',
      '放回成品',
      '置中顯示',
      '複製',
      '複製成獨立的一格',
    ])
  })

  it('生成中不列執行；失敗的寫重試', () => {
    expect(labels(node('shot:1:image', { kind: 'image', status: 'running' }))).not.toContain(
      '生成第一張畫面',
    )
    expect(labels(node('shot:1:image', { kind: 'image', status: 'failed' }))).toContain('重試')
  })

  it('場、角色、地點可以打開面板、改名與刪除；刪除排最後、前面有分隔線', () => {
    const entries = nodeEntries(node('scene:1', { kind: 'scene' }), [])
    expect(entries.map((e) => e.id)).toEqual([
      'open',
      'run',
      'rename',
      'focus',
      'copy',
      'duplicate',
      'delete',
    ])
    expect(entries.at(-1)).toMatchObject({ danger: true, separated: true, hint: 'Delete' })
    expect(entries.find((e) => e.id === 'copy')).toMatchObject({ separated: true, hint: 'Ctrl+C' })
    expect(labels(node('character:1', { kind: 'character' }))).toEqual([
      '打開面板',
      '改名',
      '置中顯示',
      '複製',
      '再做一份',
      '刪除',
    ])
  })

  it('一句話：寫故事、置中、複製；剪輯：打開成品、全部生成再接成成品，不能複製也不能刪', () => {
    expect(labels(node('node:1', { kind: 'oneliner' }))).toEqual([
      '寫故事',
      '置中顯示',
      '複製',
      '再做一份',
    ])
    expect(labels(node('cut', { kind: 'cut' }))).toEqual([
      '打開成品',
      '全部生成再接成成品',
      '置中顯示',
    ])
  })

  it('按在選取的一群格子上：對整群執行或刪除', () => {
    const a = node('shot:1', { kind: 'shot' })
    const b = node('shot:2', { kind: 'shot' })
    const hero = node('character:1', { kind: 'character' })
    expect(labels(a, [a, b, hero])).toEqual([
      '執行選取的 2 格',
      '複製',
      '再做一份',
      '刪除選取的 3 格',
    ])
    // 按在群外的格子：只對它
    expect(labels(hero, [a, b])).toEqual([
      '打開面板',
      '改名',
      '置中顯示',
      '複製',
      '再做一份',
      '刪除',
    ])
  })

  it('鏡頭：打開面板、執行、展開／收合步驟、置中、複製、刪除', () => {
    expect(labels(node('shot:1', { kind: 'shot' }))).toEqual([
      '打開面板',
      '生成這一鏡還缺的',
      '展開步驟',
      '置中顯示',
      '複製',
      '再做一份',
      '刪除',
    ])
    expect(labels(node('shot:1', { kind: 'shot', expanded: true }))).toContain('收合步驟')
  })

  it('空白處：新增、整理、全部顯示；有複製的東西時多一個貼上', () => {
    expect(paneEntries().map((e) => e.label)).toEqual(['新增…', '整理', '全部顯示'])
    expect(paneEntries(true).map((e) => e.label)).toEqual(['新增…', '貼上', '整理', '全部顯示'])
  })

  it('便條：編輯文字、置中、刪除；群組：改名、置中、刪除群組（格子留著）', () => {
    expect(labels(node('node:1', { kind: 'note' }))).toEqual([
      '編輯文字',
      '置中顯示',
      '複製',
      '再做一份',
      '刪除',
    ])
    expect(labels(node('node:2', { kind: 'group' }))).toEqual([
      '改名',
      '置中顯示',
      '複製',
      '再做一份',
      '刪除群組（格子留著）',
    ])
  })
})
