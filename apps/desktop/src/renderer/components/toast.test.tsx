import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RESUME_MIN_MS,
  TOAST_MS,
  ToastProvider,
  useSuspendToasts,
  useToast,
  type ToastOptions,
} from './toast'

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

  it('背景的通知不會吃掉使用者剛做的事的回饋：帶按鈕的提示先留著，收掉之後才輪到它', () => {
    function Both() {
      const { show } = useToast()
      return (
        <>
          <button
            type="button"
            onClick={() => {
              show({ message: '已改這一鏡的旁白', action: { label: '復原', onAction: vi.fn() } })
            }}
          >
            user
          </button>
          <button
            type="button"
            onClick={() => {
              show({ message: '旁白加好了', background: true })
            }}
          >
            background
          </button>
        </>
      )
    }
    render(
      <ToastProvider>
        <Both />
      </ToastProvider>,
    )
    // 沒有別的提示時，背景通知照常顯示
    fireEvent.click(screen.getByText('background'))
    expect(screen.getByTestId('toast').textContent).toContain('旁白加好了')
    fireEvent.click(screen.getByText('user'))
    expect(screen.getByTestId('toast').textContent).toContain('已改這一鏡的旁白')
    fireEvent.click(screen.getByText('background'))
    expect(screen.getAllByTestId('toast')).toHaveLength(1)
    expect(screen.getByTestId('toast').textContent).toContain('已改這一鏡的旁白')
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10)
    })
    expect(screen.getByTestId('toast').textContent).toContain('旁白加好了')
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10)
    })
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

describe('Toast：對話框開著時先收起來', () => {
  function Dialog({ open }: { open: boolean }) {
    return open ? <Suspender /> : null
  }
  function Suspender() {
    useSuspendToasts()
    return <p>對話框</p>
  }
  function App({ open }: { open: boolean }) {
    return (
      <ToastProvider>
        <Trigger toast={{ message: '分鏡寫好了', action: { label: '復原', onAction: vi.fn() } }} />
        <Dialog open={open} />
      </ToastProvider>
    )
  }
  const region = () => screen.getByTestId('toast-region')

  it('框開著：提示收起來（不蓋在框上）、計時暫停，不會在框後面到期', () => {
    const view = render(<App open={false} />)
    fireEvent.click(screen.getByText('show'))
    expect(region().getAttribute('data-suspended')).toBe('false')
    view.rerender(<App open />)
    expect(region().getAttribute('data-suspended')).toBe('true')
    expect(region().className).toContain('invisible')
    act(() => {
      vi.advanceTimersByTime(TOAST_MS * 5)
    })
    // 暫停中：過了很久還在
    expect(screen.getByTestId('toast')).toBeTruthy()
  })

  it('框關掉：還沒到時間的提示回來，「復原」找得到，而且至少再停一下才收', () => {
    const view = render(<App open={false} />)
    fireEvent.click(screen.getByText('show'))
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 500) // 只剩 0.5 秒
    })
    view.rerender(<App open />)
    view.rerender(<App open={false} />)
    expect(region().getAttribute('data-suspended')).toBe('false')
    expect(screen.getByTestId('toast-action').textContent).toBe('復原')
    act(() => {
      vi.advanceTimersByTime(RESUME_MIN_MS - 100)
    })
    expect(screen.getByTestId('toast')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('框開著時新跳出來的提示也先不顯示、不計時，框關掉才顯示', () => {
    const view = render(<App open />)
    fireEvent.click(screen.getByText('show'))
    act(() => {
      vi.advanceTimersByTime(TOAST_MS * 3)
    })
    expect(region().className).toContain('invisible')
    expect(screen.getByTestId('toast')).toBeTruthy()
    view.rerender(<App open={false} />)
    expect(region().className).not.toContain('invisible')
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 100)
    })
    expect(screen.getByTestId('toast')).toBeTruthy()
  })

  it('好幾個對話框同時開著：都關掉才回來', () => {
    function Two({ a, b }: { a: boolean; b: boolean }) {
      return (
        <ToastProvider>
          <Trigger toast={{ message: '提示' }} />
          <Dialog open={a} />
          <Dialog open={b} />
        </ToastProvider>
      )
    }
    const view = render(<Two a b />)
    fireEvent.click(screen.getByText('show'))
    view.rerender(<Two a={false} b />)
    expect(region().getAttribute('data-suspended')).toBe('true')
    view.rerender(<Two a={false} b={false} />)
    expect(region().getAttribute('data-suspended')).toBe('false')
  })
})
