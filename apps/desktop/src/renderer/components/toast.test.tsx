import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TOAST_MS, ToastProvider, useToast, type ToastOptions } from './toast'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Trigger({ toast }: { toast: ToastOptions }) {
  const { show } = useToast()
  return (
    <button
      type="button"
      onClick={() => {
        show(toast)
      }}
    >
      show
    </button>
  )
}

describe('Toast', () => {
  it('顯示在可被螢幕閱讀器念出的區域，幾秒後自己消失', () => {
    render(
      <ToastProvider>
        <Trigger toast={{ message: '已復原：刪除這個場' }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('show'))
    expect(screen.getByTestId('toast-region').getAttribute('aria-live')).toBe('polite')
    expect(screen.getByTestId('toast').textContent).toContain('已復原：刪除這個場')
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10)
    })
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('按提示上的按鈕會執行動作並關掉這則提示', () => {
    const onAction = vi.fn()
    render(
      <ToastProvider>
        <Trigger toast={{ message: '已復原', action: { label: '重做', onAction } }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('show'))
    fireEvent.click(screen.getByTestId('toast-action'))
    expect(onAction).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('一次只顯示一則：新的提示取代舊的，不會疊在一起', () => {
    function Keyed() {
      const { show } = useToast()
      return (
        <button
          type="button"
          onClick={() => {
            show({ key: 'history', message: '已復原：A' })
            show({ key: 'history', message: '已復原：B' })
            show({ message: '別的提示' })
          }}
        >
          show
        </button>
      )
    }
    render(
      <ToastProvider>
        <Keyed />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('show'))
    const texts = screen.getAllByTestId('toast').map((t) => t.textContent)
    expect(texts).toEqual(['別的提示'])
  })

  it('連續好幾則時只留最新的一則；錯誤提示標成 danger', () => {
    function Many() {
      const { show } = useToast()
      return (
        <button
          type="button"
          onClick={() => {
            for (const n of [1, 2, 3, 4]) {
              show({
                message: `第 ${String(n)} 則`,
                ...(n === 4 ? { tone: 'danger' as const } : {}),
              })
            }
          }}
        >
          many
        </button>
      )
    }
    render(
      <ToastProvider>
        <Many />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('many'))
    const toasts = screen.getAllByTestId('toast')
    expect(toasts.map((t) => t.textContent)).toEqual(['第 4 則'])
    expect(toasts[0]?.dataset.tone).toBe('danger')
    // 被取代的提示計時器也清掉：最新的一則照樣停滿時間才消失
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 10)
    })
    expect(screen.getAllByTestId('toast')).toHaveLength(1)
  })

  it('沒有 ToastProvider 的地方 show 什麼都不做，不會壞掉', () => {
    render(<Trigger toast={{ message: 'x' }} />)
    fireEvent.click(screen.getByText('show'))
    expect(screen.queryByTestId('toast')).toBeNull()
  })
})
