import { useEffect, useRef } from 'react'

/**
 * 換了專案（或關了專案）時做一件事（主程序發 `queue.reset`）：
 * 畫布上上一個專案留下的東西（浮動面板、確認面板、進行中的執行）要跟著清掉。
 */
export function useProjectReset(onReset: () => void): void {
  const latest = useRef(onReset)
  latest.current = onReset
  useEffect(
    () =>
      window.svs.on('queue.reset', () => {
        latest.current()
      }),
    [],
  )
}
