import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ToastProvider } from '../components/toast'
import { UndoRedoButtons } from '../components/undo-redo-buttons'
import { appError, installFakeSvs } from '../test/fake-svs'
import { HistoryProvider, useHistory } from './history'

afterEach(cleanup)

const CAN_UNDO = { canUndo: true, canRedo: false, undoLabel: '刪除這個場' }

function Page({ enabled = true }: { enabled?: boolean }) {
  return (
    <ToastProvider>
      <HistoryProvider enabled={enabled}>
        <UndoRedoButtons />
        <input data-testid="text" defaultValue="原本" />
        <Revision />
      </HistoryProvider>
    </ToastProvider>
  )
}
function Revision() {
  return <span data-testid="revision">{useHistory().revision}</span>
}

const press = (init: KeyboardEventInit, target: Element = document.body): boolean =>
  fireEvent.keyDown(target, init)

// 單元測試的環境不是 Mac，所以用 Ctrl
const CTRL_Z = { key: 'z', ctrlKey: true }

describe('HistoryProvider', () => {
  it('一開始向主行程要狀態；按鈕標出要復原什麼，沒有可做的就停用', async () => {
    installFakeSvs({ 'history.state': () => CAN_UNDO })
    render(<Page />)
    const undo = await screen.findByTestId('history-undo')
    await waitFor(() => {
      expect(undo.getAttribute('aria-label')).toBe('復原：刪除這個場')
    })
    expect(undo.hasAttribute('disabled')).toBe(false)
    expect(screen.getByTestId('history-redo').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('history-redo').getAttribute('aria-label')).toBe('沒有可以重做的動作')
  })

  it('history.changed 事件更新按鈕與 revision', async () => {
    const svs = installFakeSvs()
    render(<Page />)
    await screen.findByTestId('history-undo')
    act(() => {
      svs.emit('history.changed', { ...CAN_UNDO, revision: 3 })
    })
    expect(screen.getByTestId('history-undo').hasAttribute('disabled')).toBe(false)
    expect(screen.getByTestId('revision').textContent).toBe('3')
  })

  it('按「復原」→ 呼叫主行程、提示「已復原：…」並附「重做」；按提示上的「重做」會重做', async () => {
    const svs = installFakeSvs({
      'history.state': () => CAN_UNDO,
      'history.undo': () => ({
        applied: true,
        label: '刪除這個場',
        state: { canUndo: false, canRedo: true, redoLabel: '刪除這個場' },
      }),
      'history.redo': () => ({
        applied: true,
        label: '刪除這個場',
        state: CAN_UNDO,
      }),
    })
    render(<Page />)
    const undo = await screen.findByTestId('history-undo')
    await waitFor(() => {
      expect(undo.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(undo)
    const toast = await screen.findByTestId('toast')
    expect(toast.textContent).toContain('已復原：刪除這個場')
    expect(svs.payloadsOf('history.undo')).toHaveLength(1)

    fireEvent.click(screen.getByTestId('toast-action'))
    await waitFor(() => {
      expect(svs.payloadsOf('history.redo')).toHaveLength(1)
    })
    expect((await screen.findAllByTestId('toast')).at(-1)?.textContent).toContain(
      '已重做：刪除這個場',
    )
  })

  it('Ctrl+Z 復原、Ctrl+Shift+Z 與 Ctrl+Y 重做；沒有可做的動作時提示一聲', async () => {
    const svs = installFakeSvs()
    render(<Page />)
    await screen.findByTestId('history-undo')

    expect(press(CTRL_Z)).toBe(false) // 已接管：preventDefault
    await waitFor(() => {
      expect(svs.payloadsOf('history.undo')).toHaveLength(1)
    })
    expect((await screen.findByTestId('toast')).textContent).toBe('沒有可以復原的動作')

    press({ key: 'z', ctrlKey: true, shiftKey: true })
    press({ key: 'y', ctrlKey: true })
    await waitFor(() => {
      expect(svs.payloadsOf('history.redo')).toHaveLength(2)
    })
  })

  it('不在大綱／分鏡表（enabled 為 false）時不接管快捷鍵', async () => {
    const svs = installFakeSvs()
    render(<Page enabled={false} />)
    await screen.findByTestId('history-undo')
    expect(press(CTRL_Z)).toBe(true)
    expect(svs.payloadsOf('history.undo')).toHaveLength(0)
  })

  it('輸入框裡剛打了字：Ctrl+Z 留給輸入框自己；沒打字（或離開後）就是復原整個動作', async () => {
    const svs = installFakeSvs()
    render(<Page />)
    await screen.findByTestId('history-undo')
    const input = screen.getByTestId<HTMLInputElement>('text')

    input.focus()
    fireEvent.change(input, { target: { value: '改過了' } })
    expect(press(CTRL_Z, input)).toBe(true)
    expect(svs.payloadsOf('history.undo')).toHaveLength(0)

    // 重新聚焦（例如 Enter 存好後跳到下一格）：內容沒有未存的修改，Ctrl+Z 就是復原
    input.blur()
    input.focus()
    expect(press(CTRL_Z, input)).toBe(false)
    await waitFor(() => {
      expect(svs.payloadsOf('history.undo')).toHaveLength(1)
    })
  })

  it('打開的對話框裡不接管 Ctrl+Z', async () => {
    const svs = installFakeSvs()
    render(<Page />)
    await screen.findByTestId('history-undo')
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    expect(press(CTRL_Z)).toBe(true)
    dialog.remove()
    expect(svs.payloadsOf('history.undo')).toHaveLength(0)
  })

  it('主行程回報不能復原（資料對不上）→ 用 danger 提示顯示白話訊息', async () => {
    installFakeSvs({
      'history.undo': () => {
        throw appError('資料已經和當時不一樣了，沒辦法復原這個動作。')
      },
    })
    render(<Page />)
    await screen.findByTestId('history-undo')
    press(CTRL_Z)
    const toast = await screen.findByTestId('toast')
    expect(toast.dataset.tone).toBe('danger')
    expect(toast.textContent).toContain('沒辦法復原')
  })
})

describe('沒有 HistoryProvider', () => {
  it('復原與重做鈕停用、按了什麼都不發生', () => {
    installFakeSvs()
    render(<UndoRedoButtons />)
    expect(screen.getByTestId('history-undo').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('history-redo').hasAttribute('disabled')).toBe(true)
  })
})
