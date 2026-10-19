import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidePanel } from './side-panel'

afterEach(cleanup)

describe('SidePanel（單獨使用）', () => {
  it('沒打開就不顯示；打開才顯示內容', () => {
    const { rerender } = render(
      <SidePanel open={false} onClose={vi.fn()}>
        <p>詳情</p>
      </SidePanel>,
    )
    expect(screen.queryByText('詳情')).toBeNull()
    rerender(
      <SidePanel open onClose={vi.fn()}>
        <p>詳情</p>
      </SidePanel>,
    )
    expect(screen.getByText('詳情')).toBeTruthy()
  })

  it('按 Esc 關閉；在輸入框裡按 Esc 不會關（留給輸入框放棄修改）', () => {
    const onClose = vi.fn()
    render(
      <SidePanel open onClose={onClose}>
        <input aria-label="描述" />
      </SidePanel>,
    )
    fireEvent.keyDown(screen.getByLabelText('描述'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('沒打開時按 Esc 不會呼叫關閉', () => {
    const onClose = vi.fn()
    render(
      <SidePanel open={false} onClose={onClose}>
        <p>詳情</p>
      </SidePanel>,
    )
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
