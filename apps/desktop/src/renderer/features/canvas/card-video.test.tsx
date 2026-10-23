import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CanvasActionsContext, type CanvasActions } from './canvas-actions'
import type { CanvasNode, CanvasNodeData } from './canvas-model'
import { CardNode } from './nodes'

beforeEach(() => {
  // jsdom 沒有實作影片播放
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  })
})
afterEach(cleanup)

// jsdom 沒有 ResizeObserver，React Flow 需要
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
  const node: CanvasNode = { id: 'node:v', type: 'card', position: { x: 0, y: 0 }, data }
  return render(
    <CanvasActionsContext.Provider value={actions}>
      <ReactFlowProvider>
        <ReactFlow nodes={[node]} edges={[]} nodeTypes={{ card: CardNode }} />
      </ReactFlowProvider>
    </CanvasActionsContext.Provider>,
  )
}

describe('「圖片或影片」卡裡的影片', () => {
  it('自己上傳的影片：點 ▶ 就能播，有控制列，播放元件不會被拖曳吃掉', () => {
    renderCard({
      kind: 'freeVideo',
      title: '最終成品',
      summary: '',
      videoSrc: 'svs-asset://asset/abc',
    })
    const video = screen.getByTestId<HTMLVideoElement>('inline-video')
    expect(video.getAttribute('src')).toBe('svs-asset://asset/abc')
    expect(video.className).toContain('nodrag')
    const play = screen.getByTestId('inline-video-play')
    expect(play.getAttribute('aria-label')).toBe('播放影片')
    expect(play.className).toContain('nodrag')
    // 按 ▶：開始播，卡片上出現自己的控制列（暫停、進度、時間、靜音、音量），每個控制項都不會拖到卡片
    fireEvent.click(play)
    expect(play.isConnected).toBe(false)
    const controls = screen.getByTestId('inline-video-controls')
    for (const id of ['seek', 'toggle', 'mute', 'volume']) {
      const el = screen.getByTestId(`inline-video-${id}`)
      expect(controls.contains(el), id).toBe(true)
      expect(el.className, id).toContain('nodrag')
    }
  })

  it('生成出來的影片格（鏡頭的影片）仍然只是預覽，沒有播放鈕', () => {
    renderCard({
      kind: 'video',
      title: '第 1 鏡・影片',
      summary: '',
      status: 'done',
      videoSrc: 'svs-asset://asset/abc',
    })
    expect(screen.queryByTestId('inline-video')).toBeNull()
    expect(screen.queryByTestId('inline-video-play')).toBeNull()
  })
})
