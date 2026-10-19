import type { ReactNode } from 'react'

import { cn } from '../lib/cn'

/** 原生下拉選單的統一樣子（表格儲存格、篩選）：和按鈕同高、同圓角。 */
export const SELECT_CLASS =
  'h-8 rounded-lg border border-border bg-surface px-2 text-sm text-fg disabled:opacity-50'

/**
 * 分頁的共同外框，跟畫布一樣：上方一條 56px 的列（左邊是頁名與一句說明，右邊放這頁的動作），
 * 捲動時留在上面；下面是有固定左右邊界的內容。
 */
export function Page({
  title,
  hint,
  actions,
  width = 'wide',
  testId,
  children,
}: {
  title: string
  /** 一句話說明這頁做什麼（太長會截斷，滑過看全文）。 */
  hint?: string
  /** 上方列右邊：這一頁的動作或篩選。 */
  actions?: ReactNode
  /** narrow：表單類（設定）；wide：清單類；full：表格、故事板要用滿寬度。 */
  width?: 'narrow' | 'wide' | 'full'
  testId?: string
  children: ReactNode
}) {
  return (
    <div data-testid={testId} className="flex min-h-full flex-col">
      <header
        data-testid="page-header"
        className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface-raised/85 px-6 backdrop-blur"
      >
        <h1 className="shrink-0 text-[15px] font-semibold">{title}</h1>
        {hint ? (
          <p className="min-w-0 truncate text-xs text-fg-muted" title={hint}>
            {hint}
          </p>
        ) : null}
        <span className="flex-1" />
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div
        className={cn(
          'w-full px-6 py-5',
          width === 'narrow' && 'max-w-3xl',
          width === 'wide' && 'max-w-6xl',
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** 一組互斥的篩選（「全部／圖片／影片」）：和檔案頁、生成紀錄頁同一個樣子。 */
export function FilterChips<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  showLabel = false,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  testId: string
  /** 一列有好幾組篩選時，在前面寫出這組是什麼（「種類」「結果」）。 */
  showLabel?: boolean
}) {
  const group = (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-testid={`${testId}-${option.value === '' ? 'all' : option.value}`}
          aria-pressed={value === option.value}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs',
            value === option.value ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-fg/10',
          )}
          onClick={() => {
            onChange(option.value)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
  if (!showLabel) return group
  return (
    <span className="flex items-center gap-1.5 text-xs text-fg-muted">
      {label}
      {group}
    </span>
  )
}
