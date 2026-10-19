import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Modal } from './modal'

afterEach(cleanup)

describe('Modal', () => {
  it('放進畫面就打開，是有名稱的對話框', () => {
    render(
      <Modal label="確認" testId="m" onClose={vi.fn()}>
        <button type="button">好</button>
      </Modal>,
    )
    const dialog = screen.getByTestId('m')
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(screen.getByRole('dialog', { name: '確認' })).toBe(dialog)
  })

  it('Esc（瀏覽器對原生對話框送出的 cancel）會關閉，並且不讓瀏覽器自己關', () => {
    const onClose = vi.fn()
    render(
      <Modal label="確認" testId="m" onClose={onClose}>
        內容
      </Modal>,
    )
    const cancelled = !fireEvent(
      screen.getByTestId('m'),
      new Event('cancel', { cancelable: true, bubbles: false }),
    )
    expect(cancelled).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('點背景會關閉；點到裡面的內容不會', () => {
    const onClose = vi.fn()
    render(
      <Modal label="確認" testId="m" onClose={onClose}>
        <p>內容</p>
      </Modal>,
    )
    fireEvent.click(screen.getByText('內容'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('m'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('處理中（dismissible 為 false）：Esc 與點背景都不會關', () => {
    const onClose = vi.fn()
    render(
      <Modal label="確認" testId="m" dismissible={false} onClose={onClose}>
        內容
      </Modal>,
    )
    fireEvent(screen.getByTestId('m'), new Event('cancel', { cancelable: true }))
    fireEvent.click(screen.getByTestId('m'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
