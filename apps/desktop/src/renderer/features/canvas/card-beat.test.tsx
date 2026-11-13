import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CanvasActionsContext, type CanvasActions } from './canvas-actions'
import type { CanvasNode, CanvasNodeData } from './canvas-model'
import { CardNode } from './nodes'

afterEach(cleanup)

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)

function renderCard(data: CanvasNodeData) {
  const actions: CanvasActions = { focusNode: vi.fn(), toggleInCut: vi.fn() }
  const node: CanvasNode = { id: 'node:s', type: 'card', position: { x: 0, y: 0 }, data }
  return render(
    <CanvasActionsContext.Provider value={actions}>
      <ReactFlowProvider>
        <ReactFlow nodes={[node]} edges={[]} nodeTypes={{ card: CardNode }} />
      </ReactFlowProvider>
    </CanvasActionsContext.Provider>,
  )
}

const shot = (extra: Partial<CanvasNodeData> = {}): CanvasNodeData => ({
  kind: 'shot',
  title: '第 2 鏡',
  summary: '貓跳上窗台',
  meta: '中景・平視・3 秒',
  sceneId: 'sc1',
  ...extra,
})

describe('鏡頭卡：格子種類的小記號', () => {
  it('一般鏡頭沒有記號（舊專案的畫面跟以前一樣）', () => {
    renderCard(shot())
    expect(screen.queryByTestId('beat-badge')).toBeNull()
  })

  it('不動的畫面標「不動」、字卡標「字卡」、片名卡標「片名卡」', () => {
    renderCard(shot({ beat: 'still' }))
    expect(screen.getByTestId('beat-badge').textContent).toBe('不動')
    cleanup()
    renderCard(shot({ beat: 'card' }))
    expect(screen.getByTestId('beat-badge').textContent).toBe('字卡')
    cleanup()
    renderCard(shot({ beat: 'title' }))
    expect(screen.getByTestId('beat-badge').textContent).toBe('片名卡')
  })

  it('字卡的影片格：「吃：」寫字卡，不寫第一張畫面與動作', () => {
    renderCard({ kind: 'video', title: '第 3 鏡・影片', summary: '', status: 'idle', beat: 'card' })
    const eat = screen.getByTestId('io-in')
    expect(eat.textContent).toContain('字卡')
    expect(eat.textContent).not.toContain('動作')
    expect(screen.queryByTestId('io-vid-in')).toBeNull()
  })

  it('一般影片格的「吃：」還是第一張畫面與動作', () => {
    renderCard({ kind: 'video', title: '第 1 鏡・影片', summary: '', status: 'idle' })
    expect(screen.getByTestId('io-vid-in')).toBeTruthy()
    expect(screen.getByTestId('io-vid-action')).toBeTruthy()
  })
})

describe('鏡頭卡：旁白在格子裡念不完', () => {
  it('標「旁白太長」；沒有這個旗標就沒有', () => {
    renderCard(shot({ beat: 'still', narrationTooLong: true }))
    expect(screen.getByTestId('narration-long-badge').textContent).toBe('旁白太長')
    cleanup()
    renderCard(shot({ beat: 'still' }))
    expect(screen.queryByTestId('narration-long-badge')).toBeNull()
  })
})
