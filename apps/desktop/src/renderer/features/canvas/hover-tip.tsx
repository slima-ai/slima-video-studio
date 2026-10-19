import { useEffect, useState, type RefObject } from 'react'

/** 滑過多久才出現說明。 */
const TIP_DELAY_MS = 350

interface Tip {
  text: string
  x: number
  y: number
}

/**
 * 畫布上按鈕的說明（`data-tip`）：滑過一下才出現，貼在按鈕下方。
 * 不用瀏覽器的 title：那個收不起來，確認面板打開了還壓在上面。`hidden` 時（例如確認面板打開）立刻收起來；
 * 按下按鈕也收起來。
 */
export function HoverTip({
  root,
  hidden,
}: {
  root: RefObject<HTMLElement | null>
  hidden: boolean
}) {
  const [tip, setTip] = useState<Tip>()
  useEffect(() => {
    const el = root.current
    if (!el) return undefined
    let timer: number | undefined
    const clear = (): void => {
      window.clearTimeout(timer)
      timer = undefined
      setTip(undefined)
    }
    const onOver = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null
      if (!target) return
      const text = target.getAttribute('data-tip') ?? ''
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const box = target.getBoundingClientRect()
        // 靠近視窗左右邊緣時往內收，說明不會被切掉
        const x = Math.min(Math.max(box.left + box.width / 2, 150), window.innerWidth - 150)
        setTip({ text, x, y: box.bottom + 6 })
      }, TIP_DELAY_MS)
    }
    const onOut = (event: MouseEvent): void => {
      const from = event.target instanceof Element ? event.target.closest('[data-tip]') : null
      const to =
        event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-tip]') : null
      if (from && from !== to) clear()
    }
    el.addEventListener('mouseover', onOver)
    el.addEventListener('mouseout', onOut)
    el.addEventListener('pointerdown', clear, true)
    el.addEventListener('wheel', clear, { passive: true })
    return () => {
      window.clearTimeout(timer)
      el.removeEventListener('mouseover', onOver)
      el.removeEventListener('mouseout', onOut)
      el.removeEventListener('pointerdown', clear, true)
      el.removeEventListener('wheel', clear)
    }
  }, [root])
  if (!tip || hidden) return null
  return (
    <p
      role="tooltip"
      data-testid="hover-tip"
      className="pointer-events-none fixed z-50 max-w-72 -translate-x-1/2 rounded-md bg-fg px-2.5 py-1 text-xs text-surface shadow-panel"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </p>
  )
}
