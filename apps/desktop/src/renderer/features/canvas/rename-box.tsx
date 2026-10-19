import { useEffect, useRef, useState } from 'react'

export interface RenameTarget {
  key: string
  /** 輸入框一開始的字（目前的名字）。 */
  initial: string
  /** 蓋在哪裡（螢幕座標，通常是格子的標題列）。 */
  rect: { left: number; top: number; width: number; height: number }
}

/** 哪些格子可以改名（場、角色、地點、群組）。 */
export const isRenamable = (key: string, kind?: string): boolean =>
  kind === 'group' || /^(scene|character|location):/.test(key)

/**
 * F2 改名：蓋在標題列上的輸入框。Enter 或點別的地方就存，Esc 取消；
 * 沒改或改成空的就不送出。
 */
export function RenameBox({
  target,
  onCommit,
  onCancel,
}: {
  target: RenameTarget
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(target.initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    const next = value.trim()
    if (commit && next !== '' && next !== target.initial) onCommit(next)
    else onCancel()
  }
  return (
    <input
      ref={ref}
      data-testid="rename-box"
      aria-label="新的名字"
      value={value}
      maxLength={100}
      className="fixed z-50 rounded-md border border-accent bg-surface-raised px-2 text-sm font-semibold text-fg shadow-lg outline-none"
      style={{
        left: target.rect.left,
        top: target.rect.top,
        width: Math.max(target.rect.width, 160),
        height: target.rect.height,
      }}
      onChange={(event) => {
        setValue(event.target.value)
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => {
        finish(true)
      }}
    />
  )
}
