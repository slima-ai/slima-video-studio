import { useLayoutEffect, useRef } from 'react'

/**
 * 啟用時，按 Esc 就呼叫 onEscape（用在「確定刪除？」這種行內確認，Esc 等於「不要」）。
 * 在捕獲階段處理並標記 preventDefault，所以外面的側面板不會同時被關掉。
 */
export function useEscape(enabled: boolean, onEscape: () => void): void {
  const handler = useRef(onEscape)
  useLayoutEffect(() => {
    handler.current = onEscape
  }, [onEscape])

  // 一出現就要能按 Esc（畫出來之前就掛好監聽）
  useLayoutEffect(() => {
    if (!enabled) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      handler.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [enabled])
}
