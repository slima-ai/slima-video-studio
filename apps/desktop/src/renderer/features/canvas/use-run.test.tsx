import type { CanvasRunPlan } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/toast'
import { installFakeSvs } from '../../test/fake-svs'
import type { CanvasNode } from './canvas-model'
import { useRun } from './use-run'

afterEach(cleanup)

const node = (id: string, title: string, status: string): CanvasNode =>
  ({
    id,
    type: 'shot',
    position: { x: 0, y: 0 },
    data: { kind: 'shot', title, status },
  }) as unknown as CanvasNode

const PLAN = {
  ok: true,
  steps: [
    { key: 'shot:a:video', kind: 'video', label: '第 2 鏡：影片' },
    { key: 'shot:b:video', kind: 'video', label: '第 4 鏡：影片' },
  ],
  highlightKeys: [],
} as unknown as CanvasRunPlan

function Harness({
  nodes,
  reveal,
}: {
  nodes: readonly CanvasNode[]
  reveal?: (key: string) => void
}) {
  const run = useRun({ nodes, ...(reveal ? { reveal } : {}) })
  return (
    <div>
      <button
        data-testid="go"
        onClick={() => {
          run.start({ request: { keys: [], all: true }, plan: PLAN })
        }}
      />
      <span data-testid="active">{run.active === undefined ? 'no' : 'yes'}</span>
    </div>
  )
}

const withProvider = (ui: React.ReactElement) => <ToastProvider>{ui}</ToastProvider>

describe('useRun：失敗的提示寫出是哪幾鏡', () => {
  it('有鏡頭沒成功：寫「第 2、4 鏡沒有成功」，「看第一個」把第一個失敗的那一格帶進畫面', async () => {
    const fake = installFakeSvs({ 'canvas.run': () => ({ started: 2, failed: [] }) })
    const reveal = vi.fn()
    const running = [
      node('shot:a', '第 2 鏡', 'idle'),
      node('shot:a:video', '第 2 鏡・影片', 'running'),
      node('shot:b', '第 4 鏡', 'idle'),
      node('shot:b:video', '第 4 鏡・影片', 'running'),
    ]
    const view = render(withProvider(<Harness nodes={running} reveal={reveal} />))
    fireEvent.click(screen.getByTestId('go'))
    await screen.findByText('yes')
    expect(fake.payloadsOf('canvas.run')).toHaveLength(1)
    view.rerender(withProvider(<Harness nodes={running} reveal={reveal} />))
    // 做完：兩個影片都失敗
    const failed = [
      node('shot:a', '第 2 鏡', 'idle'),
      node('shot:a:video', '第 2 鏡・影片', 'failed'),
      node('shot:b', '第 4 鏡', 'idle'),
      node('shot:b:video', '第 4 鏡・影片', 'failed'),
    ]
    view.rerender(withProvider(<Harness nodes={failed} reveal={reveal} />))
    const toast = await screen.findByTestId('toast')
    expect(toast.textContent).toContain('第 2、4 鏡沒有成功：在那一格按「重試」')
    fireEvent.click(screen.getByTestId('toast-action'))
    expect(reveal).toHaveBeenCalledWith('shot:a')
  })

  it('換了專案（queue.reset）：這一次執行不算了', async () => {
    const fake = installFakeSvs({ 'canvas.run': () => ({ started: 1, failed: [] }) })
    render(withProvider(<Harness nodes={[node('shot:a:video', '第 1 鏡・影片', 'running')]} />))
    fireEvent.click(screen.getByTestId('go'))
    await screen.findByText('yes')
    act(() => {
      fake.emit('queue.reset', {})
    })
    expect(screen.getByTestId('active').textContent).toBe('no')
  })
})
