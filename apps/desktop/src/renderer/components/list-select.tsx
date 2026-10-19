import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '../lib/cn'

export interface ListOption {
  value: string
  /** 給螢幕閱讀器與測試用的純文字名稱。 */
  label: string
  /** 選單與按鈕上實際顯示的內容（可以放徽章、價格）。 */
  content: ReactNode
  /** 看得到但不能選（例如還沒填金鑰的模型），畫成灰色。 */
  disabled?: boolean
}

export interface ListSelectProps {
  value: string | undefined
  options: ListOption[]
  onChange: (value: string) => void
  /** 沒有選中任何項目時顯示的字。 */
  placeholder?: string
  id?: string
  testId?: string
  /** 沒有可見文字標籤時，給螢幕閱讀器的名稱。 */
  label?: string
  disabled?: boolean
}

export interface SimpleOption {
  value: string
  label: string
}

/** 只有純文字選項的下拉（秒數、畫風這類）。 */
export function SimpleSelect({
  options,
  ...rest
}: Omit<ListSelectProps, 'options'> & { options: SimpleOption[] }) {
  return (
    <ListSelect
      {...rest}
      options={options.map((o) => ({ value: o.value, label: o.label, content: o.label }))}
    />
  )
}

/**
 * 自訂下拉選單：選項可以放徽章、價格等排版，深色主題下不會跳出系統的白色選單。
 * 鍵盤：↑↓ 移動、Home/End、Enter/空白選取、Esc 或 Tab 關閉。
 */
export function ListSelect({
  value,
  options,
  onChange,
  placeholder = '請選擇',
  id,
  testId,
  label,
  disabled = false,
}: ListSelectProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const selectedIndex = options.findIndex((o) => o.value === value)
  const [active, setActive] = useState(Math.max(selectedIndex, 0))
  const selected = options[selectedIndex]

  const show = (): void => {
    const rect = rootRef.current?.getBoundingClientRect()
    // 下方放不下（選單最高約 18rem）又有位置往上，就往上展開
    setOpenUp(rect !== undefined && window.innerHeight - rect.bottom < 300 && rect.top > 300)
    setActive(Math.max(selectedIndex, 0))
    setOpen(true)
  }

  const choose = (index: number): void => {
    const option = options[index]
    if (option?.disabled === true) return
    if (option) onChange(option.value)
    setOpen(false)
  }

  // 點選單外面就關閉
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  // 目前項目要在可見範圍內
  useEffect(() => {
    if (!open) return
    const item = rootRef.current?.querySelector(`[data-index="${String(active)}"]`)
    // jsdom 沒有 scrollIntoView
    if (item && typeof item.scrollIntoView === 'function') item.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const last = options.length - 1
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        if (!open) {
          show()
          return
        }
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((current) => Math.min(last, Math.max(0, current + step)))
        return
      }
      case 'Home':
      case 'End':
        if (!open) return
        event.preventDefault()
        setActive(event.key === 'Home' ? 0 : last)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (open) choose(active)
        else show()
        return
      case 'Escape':
        if (!open) return
        // 只關選單，不要連外面的面板一起關掉
        event.preventDefault()
        setOpen(false)
        return
      case 'Tab':
        setOpen(false)
        return
      default:
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        data-testid={testId}
        data-value={value ?? ''}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${String(active)}` : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) setOpen(false)
          else show()
        }}
        onKeyDown={onKeyDown}
        className="flex h-10 w-full items-center gap-2 rounded-md border border-border bg-surface px-3 text-left text-sm transition-colors duration-200 hover:border-fg-muted/50 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      >
        <span className="min-w-0 flex-1">
          {selected ? selected.content : <span className="text-fg-muted">{placeholder}</span>}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-fg-muted transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          data-testid={testId ? `${testId}-list` : undefined}
          className={cn(
            'absolute z-20 max-h-72 w-full animate-fade-in overflow-auto overscroll-contain rounded-md border border-fg-muted/40 bg-surface-raised p-1 shadow-[0_12px_32px_rgb(0_0_0/0.45)]',
            openUp ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${String(index)}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled === true ? true : undefined}
              aria-label={option.label}
              data-index={index}
              data-testid={testId ? `${testId}-option-${option.value}` : undefined}
              // 用 mousedown 選取，輸入焦點才不會離開按鈕
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={() => {
                choose(index)
              }}
              onMouseMove={() => {
                setActive(index)
              }}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-2 text-sm',
                option.disabled === true ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                index === active && 'bg-surface-overlay',
              )}
            >
              <span className="min-w-0 flex-1">{option.content}</span>
              {/* 每一列都留同寬的勾選欄，右邊的價格才會對齊 */}
              <span className="flex size-4 shrink-0 items-center justify-center">
                {option.value === value ? (
                  <Check className="size-4 text-accent" aria-hidden />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
