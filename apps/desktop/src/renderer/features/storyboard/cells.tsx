import { useRef, useState, type KeyboardEvent } from 'react'

const BASE =
  'w-full truncate rounded border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-accent focus:bg-surface focus:outline-none'

/** 在表格裡上下移動：Enter 往下一列、Shift+Enter 往上一列（同一欄）。 */
export function moveFocus(from: HTMLElement, column: string, step: 1 | -1): void {
  const table = from.closest('table')
  if (!table) return
  const cells = [...table.querySelectorAll<HTMLElement>(`[data-column="${column}"]`)]
  const target = cells[cells.indexOf(from) + step]
  target?.focus()
  // 跳過去就能直接打字覆蓋，像試算表一樣
  if (target instanceof HTMLInputElement) target.select()
}

interface TextCellProps {
  column: string
  label: string
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  type?: 'text' | 'number'
  min?: number
  max?: number
}

/** 表格裡的輸入格：離開（或按 Enter）才存；Esc 放棄這次的修改。 */
export function TextCell({ column, label, value, ...rest }: TextCellProps) {
  // 外面的值變了（別處改了、AI 重拆了）就重新開始
  return <TextCellInner key={value} column={column} label={label} value={value} {...rest} />
}

function TextCellInner({
  column,
  label,
  value,
  onCommit,
  placeholder,
  type = 'text',
  min,
  max,
}: TextCellProps) {
  const [draft, setDraft] = useState(value)
  // 按 Enter 存了之後輸入框會失焦、又觸發一次離開：同一份內容只送一次
  const sent = useRef(value)
  const commit = (): void => {
    if (draft === value || draft === sent.current) return
    sent.current = draft
    onCommit(draft)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      moveFocus(event.currentTarget, column, event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      setDraft(value)
    }
  }
  return (
    <input
      data-testid={`cell-${column}`}
      data-column={column}
      aria-label={label}
      type={type}
      value={draft}
      title={draft === '' ? undefined : draft}
      placeholder={placeholder}
      {...(min === undefined ? {} : { min })}
      {...(max === undefined ? {} : { max })}
      onChange={(event) => {
        sent.current = value
        setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={BASE}
    />
  )
}

interface SelectCellProps {
  column: string
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onCommit: (value: string) => void
}

export function SelectCell({ column, label, value, options, onCommit }: SelectCellProps) {
  return (
    <select
      data-testid={`cell-${column}`}
      data-column={column}
      aria-label={label}
      value={value}
      title={options.find((option) => option.value === value)?.label}
      onChange={(event) => {
        onCommit(event.target.value)
      }}
      className={`${BASE} cursor-pointer`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
