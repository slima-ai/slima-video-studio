import type { CanvasRunPlan } from '@svs/schema'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TopBar } from './chrome'
import { RunPlanConfirm } from './run-confirm-plan'

afterEach(cleanup)

const plan = (patch: Partial<CanvasRunPlan> = {}): CanvasRunPlan => ({
  ok: true,
  steps: [
    { key: 'shot:a:image', kind: 'image', label: '第 2 鏡：第一張畫面', redo: false },
    { key: 'shot:a:video', kind: 'video', label: '第 2 鏡：影片', redo: false },
  ],
  highlightKeys: [],
  shotCount: 1,
  skippedBusy: 0,
  estimatedUsd: 0.42,
  estimateIsLowerBound: false,
  demoMode: false,
  models: { image: '生圖模型', video: '影片模型' },
  rejoin: false,
  segments: 0,
  ...patch,
})

const anchor = { left: 360, right: 400, top: 100, bottom: 130 }

describe('RunPlanConfirm', () => {
  it('列出這次會做的每一步、用的模型和預估花費', () => {
    render(<RunPlanConfirm plan={plan()} anchor={anchor} onOk={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByTestId('run-confirm')
    expect(dialog.textContent).toContain('這次會做 2 步')
    expect(dialog.textContent).toContain('第 2 鏡：第一張畫面')
    expect(dialog.textContent).toContain('第 2 鏡：影片')
    expect(dialog.textContent).toContain('用：生圖模型、影片模型')
    expect(dialog.textContent).toContain('US$0.42')
    expect(dialog.textContent).toContain('已經有結果的不會重跑')
  })

  it('重做已完成的節點：標明會產生第幾版、舊的保留，確認鈕也這樣寫；不說「不會重跑」', () => {
    const redo = plan({
      steps: [
        {
          key: 'shot:a:video',
          kind: 'video',
          label: '第 2 鏡：影片',
          redo: true,
          versions: { current: 1, next: 2 },
        },
      ],
    })
    render(<RunPlanConfirm plan={redo} anchor={anchor} onOk={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByTestId('run-confirm')
    expect(dialog.textContent).toContain('第 2 鏡：影片（重做：產生 v2，保留 v1）')
    expect(dialog.textContent).not.toContain('已經有結果的不會重跑')
    expect(screen.getByTestId('run-confirm-ok').textContent).toBe('重做（產生 v2，保留 v1）')
  })

  it('示範模式註明不會花錢；有鏡頭正在生成會說明先略過；只剩接成品時一行說完、不顯示花費', () => {
    const { rerender } = render(
      <RunPlanConfirm
        plan={plan({ demoMode: true, skippedBusy: 2 })}
        anchor={anchor}
        onOk={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const text = screen.getByTestId('run-confirm').textContent
    expect(text).toContain('示範模式：不會真的花錢')
    expect(text).toContain('2 個鏡頭正在生成，先略過')

    rerender(
      <RunPlanConfirm
        plan={plan({
          steps: [
            { key: 'cut', kind: 'cut', label: '接成成品（5 段，在本機處理、免費）', redo: false },
          ],
          shotCount: 0,
          rejoin: true,
          segments: 5,
          estimatedUsd: 0,
        })}
        anchor={anchor}
        onOk={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const join = screen.getByTestId('run-confirm')
    expect(join.querySelector('h2')?.textContent).toBe('接成成品 · 5 段 · 免費（在本機處理）')
    expect(join.textContent).not.toContain('US$')
    expect(join.querySelectorAll('li')).toHaveLength(0)
    expect(screen.getByTestId('run-confirm-ok').textContent).toBe('接成成品')
  })

  it('品質切換：預設、高品質、平衡、經濟（先出草稿）；按了通知上層，目前的那個標成選取', () => {
    const onQuality = vi.fn()
    const { rerender } = render(
      <RunPlanConfirm
        plan={plan()}
        anchor={anchor}
        quality={undefined}
        onQuality={onQuality}
        onOk={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual(['預設', '高品質', '平衡', '經濟'])
    expect(screen.getByTestId('quality-default').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('quality-budget').title).toContain('先出草稿')
    fireEvent.click(screen.getByTestId('quality-premium'))
    expect(onQuality).toHaveBeenCalledWith('premium')
    rerender(
      <RunPlanConfirm
        plan={plan()}
        anchor={anchor}
        quality="premium"
        onQuality={onQuality}
        onOk={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('quality-premium').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByTestId('quality-default'))
    expect(onQuality).toHaveBeenLastCalledWith(undefined)
  })

  it('只剩接成品（不用模型）或沒給 onQuality：不顯示品質切換', () => {
    render(
      <RunPlanConfirm
        plan={plan({ shotCount: 0, rejoin: true, segments: 3, steps: [] })}
        anchor={anchor}
        onQuality={vi.fn()}
        onOk={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('quality-switch')).toBeNull()
    cleanup()
    render(<RunPlanConfirm plan={plan()} anchor={anchor} onOk={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByTestId('quality-switch')).toBeNull()
  })

  it('確認與取消', () => {
    const onOk = vi.fn()
    const onCancel = vi.fn()
    render(<RunPlanConfirm plan={plan()} anchor={anchor} onOk={onOk} onCancel={onCancel} />)
    fireEvent.click(screen.getByTestId('run-confirm-ok'))
    expect(onOk).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('TopBar 全部生成', () => {
  const bar = (props: {
    pendingCostUsd?: number | undefined
    allDone?: boolean
    joinOnly?: boolean
    onRunAll?: () => void
  }) => render(<TopBar onUndo={vi.fn()} onRedo={vi.fn()} {...props} />)

  it('有還沒生成的：顯示預估花費，按下去帶著按鈕位置', () => {
    const onRunAll = vi.fn()
    bar({ pendingCostUsd: 1.5, onRunAll })
    const button = screen.getByTestId('run-all')
    expect(button.textContent).toBe('全部生成（約 US$1.50）')
    fireEvent.click(button)
    expect(onRunAll).toHaveBeenCalledTimes(1)
    const [anchor] = onRunAll.mock.calls[0] as [{ right: number; top: number; bottom: number }]
    expect(typeof anchor.right).toBe('number')
  })

  it('素材都好了、只剩接成品：按鈕寫「接成成品」，可以按', () => {
    bar({ pendingCostUsd: 0, joinOnly: true, onRunAll: vi.fn() })
    expect(screen.getByTestId('run-all').textContent).toBe('接成成品')
    expect(screen.getByTestId('run-all').hasAttribute('disabled')).toBe(false)
  })

  it('都生成好了：按鈕停用；算不出來：照常可以按', () => {
    bar({ pendingCostUsd: 0, allDone: true, onRunAll: vi.fn() })
    expect(screen.getByTestId('run-all').textContent).toBe('全部都生成好了')
    expect(screen.getByTestId('run-all').hasAttribute('disabled')).toBe(true)
    cleanup()
    bar({ pendingCostUsd: undefined, onRunAll: vi.fn() })
    expect(screen.getByTestId('run-all').textContent).toBe('全部生成')
    expect(screen.getByTestId('run-all').hasAttribute('disabled')).toBe(false)
  })
})
