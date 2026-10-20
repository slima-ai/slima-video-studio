import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

export interface SwitchProps extends Omit<ComponentProps<'input'>, 'type' | 'role' | 'className'> {
  className?: string
}

/**
 * 開關：外觀是滑動的開關，底下仍是一個真的 checkbox（`role="switch"`），所以鍵盤、讀屏軟體與測試
 * （`checked`、`check()`、`uncheck()`）都照 checkbox 的方式運作。要有 `aria-label` 或被 `<label>` 包著。
 */
export function Switch({ className, ...props }: SwitchProps) {
  return (
    <span className={cn('relative inline-flex h-6 w-11 shrink-0 items-center', className)}>
      <input
        type="checkbox"
        role="switch"
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-border transition-colors duration-200 peer-checked:bg-accent peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-0.5 size-5 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-5"
      />
    </span>
  )
}
