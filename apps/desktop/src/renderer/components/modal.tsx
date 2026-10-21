import { useEffect, useRef, type ReactNode } from 'react'

import { useSuspendToasts } from './toast'

export interface ModalProps {
  /** 螢幕閱讀器念的對話框名稱。 */
  label: string
  /** 按 Esc 或點背景時呼叫；不給或 dismissible 為 false 就不能這樣關。 */
  onClose: () => void
  /** 處理中（例如送出請求）不讓使用者用 Esc 或點背景關掉。 */
  dismissible?: boolean
  testId?: string
  children: ReactNode
}

/**
 * 置中的對話框。用瀏覽器原生的 `<dialog>` 的 showModal()：
 * 焦點留在對話框裡（Tab 不會跑到後面的頁面）、Esc 可以關、背景自動不能操作，
 * 而且不需要在執行時插入樣式，不會被正式版的內容安全政策（CSP）擋下。
 * 要顯示時才放進畫面（放進去就打開），不要時就不渲染。
 */
export function Modal({ label, onClose, dismissible = true, testId, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  // 對話框開著，提示先收起來（背景擋著點不到，還可能在這時到期）
  useSuspendToasts()

  useEffect(() => {
    const dialog = ref.current
    // 關掉之後把焦點還給原本按下去的那個按鈕（鍵盤使用者才不會被丟回頁面最前面）
    const opener = document.activeElement
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-label={label}
      data-testid={testId}
      // Esc：交給 React 決定要不要關（處理中就不關）
      onCancel={(event) => {
        event.preventDefault()
        if (dismissible) onClose()
      }}
      // 點到背景（事件目標是 dialog 本身，而不是裡面的內容）
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose()
      }}
      className="m-auto max-w-[calc(100vw-3rem)] border-0 bg-transparent p-0 text-fg backdrop:animate-fade-in backdrop:bg-scrim"
    >
      <div className="animate-dialog-in rounded-lg border border-border bg-surface-raised shadow-panel">
        {children}
      </div>
    </dialog>
  )
}
