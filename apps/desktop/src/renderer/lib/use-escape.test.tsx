import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useEscape } from './use-escape'

afterEach(cleanup)

function Probe({ enabled, onEscape }: { enabled: boolean; onEscape: () => void }) {
  useEscape(enabled, onEscape)
  return null
}

describe('useEscape', () => {
  it('啟用時按 Esc 會呼叫，而且標記已處理（外面的面板就不會跟著關）', () => {
    const onEscape = vi.fn()
    render(<Probe enabled onEscape={onEscape} />)
    const notPrevented = fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledOnce()
    expect(notPrevented).toBe(false)
  })

  it('沒啟用、或按別的鍵，什麼都不做', () => {
    const onEscape = vi.fn()
    const { rerender } = render(<Probe enabled={false} onEscape={onEscape} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    rerender(<Probe enabled onEscape={onEscape} />)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onEscape).not.toHaveBeenCalled()
  })
})
