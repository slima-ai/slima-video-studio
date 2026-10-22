import type { CanvasRunPlan, OutlineView, ShotView, ShotsSnapshot } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import type { CanvasNode } from './canvas-model'
import { DetailPanel, keyOfTarget, panelTargetOf } from './detail-panel'

afterEach(cleanup)

const HASH = (c: string): string => c.repeat(64)

const shot: ShotView = {
  id: 's1',
  number: 1,
  description: '貓跳上窗台',
  action: '',
  cameraMove: null,
  durationSec: 3,
  characters: [],
  size: 'medium',
  angle: 'eye_level',
  dialogue: '',
  autoPrompt: '貓跳上窗台',
  status: 'done',
  firstFrames: [
    {
      id: 'f1',
      kind: 'first_frame',
      version: 1,
      assetHash: HASH('a'),
      adopted: false,
      modelId: 'fal/nano-banana-2',
      createdAt: '2026-10-12T08:30:00.000Z',
    },
    {
      id: 'f2',
      kind: 'first_frame',
      version: 2,
      assetHash: HASH('b'),
      adopted: true,
      modelId: 'fal/nano-banana-2',
      createdAt: '2026-10-12T08:31:00.000Z',
    },
  ],
  videos: [],
}
const snapshot: ShotsSnapshot = { shots: [shot] }
const nodes = [
  { id: 'shot:s1', position: { x: 0, y: 0 }, data: { kind: 'shot', title: '第 1 鏡' } },
  { id: 'scene:c1', position: { x: 0, y: 0 }, data: { kind: 'scene', title: '第 1 場・雨夜' } },
] as CanvasNode[]

const PLAN: CanvasRunPlan = {
  ok: true,
  steps: [
    {
      key: 'shot:s1:image',
      kind: 'image',
      label: '第 1 鏡・第一張畫面',
      redo: true,
      versions: { current: 2, next: 3 },
    },
  ],
  highlightKeys: ['shot:s1:image'],
  shotCount: 1,
  skippedBusy: 0,
  estimatedUsd: 0.08,
  estimateIsLowerBound: false,
  demoMode: true,
  models: { image: 'Nano Banana 2' },
  rejoin: false,
  segments: 0,
}

const renderPanel = (target: ReturnType<typeof panelTargetOf>, extra = {}) => {
  const props = {
    target,
    snapshot,
    nodes,
    refreshKey: 1,
    onChanged: vi.fn(),
    onRun: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  }
  render(<DetailPanel {...props} />)
  return props
}

describe('哪一格打開哪種面板', () => {
  it('鏡頭、圖、影片、剪輯、角色、地點、場有面板；一句話、便條、群組、獨立圖片沒有', () => {
    expect(panelTargetOf('shot:s1')).toEqual({ kind: 'shot', shotId: 's1' })
    expect(panelTargetOf('shot:s1:image')).toEqual({ kind: 'image', shotId: 's1' })
    expect(panelTargetOf('shot:s1:video')).toEqual({ kind: 'video', shotId: 's1' })
    expect(panelTargetOf('cut')).toEqual({ kind: 'cut' })
    expect(panelTargetOf('character:h')).toEqual({ kind: 'character', id: 'h' })
    expect(panelTargetOf('location:l')).toEqual({ kind: 'location', id: 'l' })
    expect(panelTargetOf('scene:c')).toEqual({ kind: 'scene', id: 'c' })
    expect(panelTargetOf('node:n1')).toBeUndefined()
    expect(panelTargetOf('shot:s1:other')).toBeUndefined()
  })

  it('面板對回原本的格子鍵', () => {
    for (const key of ['shot:s1', 'shot:s1:image', 'cut', 'character:h', 'scene:c']) {
      const target = panelTargetOf(key)
      if (!target) throw new Error(key)
      expect(keyOfTarget(target)).toBe(key)
    }
  })
})

describe('浮動面板', () => {
  it('圖的面板：標題帶鏡號、列出所有版本，可以改用舊版本；× 和 Esc 都會收起', async () => {
    const adopt = vi.fn(() => ({}))
    installFakeSvs({ 'shots.adopt': adopt })
    const props = renderPanel(panelTargetOf('shot:s1:image'))
    expect(screen.getByTestId('canvas-panel-title').textContent).toContain('第 1 鏡・第一張畫面')
    expect(screen.getByTestId('takes-panel-image')).toBeTruthy()
    fireEvent.click(screen.getByTestId('shot-adopt-1'))
    await waitFor(() => {
      expect(adopt).toHaveBeenCalledWith({ takeId: 'f1' })
    })
    fireEvent.click(screen.getByTestId('canvas-panel-close'))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('試跑分頁：列出這次會做的步驟與花費，按「執行」照這個計畫開始', async () => {
    installFakeSvs({ 'canvas.runPlan': () => PLAN })
    const props = renderPanel(panelTargetOf('shot:s1:image'))
    fireEvent.click(screen.getByTestId('canvas-panel-tab-trial'))
    expect((await screen.findByTestId('trial-steps')).textContent).toContain(
      '第 1 鏡・第一張畫面（重做：產生 v3，保留 v2）',
    )
    expect(screen.getByTestId('trial-cost').textContent).toContain('US$0.08')
    fireEvent.click(screen.getByTestId('trial-run'))
    expect(props.onRun).toHaveBeenCalledWith({ keys: ['shot:s1:image'] }, PLAN)
  })

  it('角色、場沒有試跑分頁；剪輯也沒有', () => {
    installFakeSvs()
    renderPanel(panelTargetOf('scene:c1'))
    expect(screen.queryByTestId('canvas-panel-tab-trial')).toBeNull()
  })

  it('場的欄位：改名字、離開輸入框就存，存好讓畫布重新讀', async () => {
    const outline: OutlineView = {
      acts: [
        {
          id: 'a1',
          title: '第 1 幕',
          summary: '',
          scenes: [{ id: 'c1', title: '雨夜', summary: '' }],
        },
      ],
      locations: [{ id: 'l1', name: '巷口', description: '' }],
    }
    const edit = vi.fn(() => outline)
    installFakeSvs({ 'outline.get': () => outline, 'outline.edit': edit })
    const props = renderPanel(panelTargetOf('scene:c1'))
    const title = await screen.findByTestId('scene-panel-title')
    fireEvent.change(title, { target: { value: '雨停了' } })
    fireEvent.blur(title)
    await waitFor(() => {
      expect(edit).toHaveBeenCalledWith({
        op: 'updateScene',
        sceneId: 'c1',
        patch: { title: '雨停了' },
      })
    })
    await waitFor(() => {
      expect(props.onChanged).toHaveBeenCalled()
    })
  })

  it('鏡頭已經被刪掉：面板收起', () => {
    installFakeSvs()
    renderPanel({ kind: 'shot', shotId: 'gone' })
    expect(screen.queryByTestId('canvas-panel')).toBeNull()
  })
})
