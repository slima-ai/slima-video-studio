import { useState } from 'react'

const BASE = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal'

interface TextProps {
  label: string
  value: string
  testId: string
  onCommit: (value: string) => void
  /** 多行輸入框的行數；沒給就是單行。 */
  rows?: number
  maxLength?: number
  placeholder?: string
}

/**
 * 輸入的過程只改畫面上的字，離開輸入框（失焦）才真的存，
 * 這樣打字時不會一直重新整理整份大綱。
 */
export function CommitText({
  label,
  value,
  testId,
  onCommit,
  rows,
  maxLength,
  placeholder,
}: TextProps) {
  // 外面的值變了（例如重新拆過）就重新開始
  return (
    <CommitTextInner
      key={value}
      label={label}
      value={value}
      testId={testId}
      onCommit={onCommit}
      {...(rows === undefined ? {} : { rows })}
      {...(maxLength === undefined ? {} : { maxLength })}
      {...(placeholder === undefined ? {} : { placeholder })}
    />
  )
}

function CommitTextInner({
  label,
  value,
  testId,
  onCommit,
  rows,
  maxLength,
  placeholder,
}: TextProps) {
  const [draft, setDraft] = useState(value)
  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <label className="block text-sm font-medium">
      {label}
      {rows === undefined ? (
        <input
          data-testid={testId}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onBlur={commit}
          className={BASE}
        />
      ) : (
        <textarea
          data-testid={testId}
          rows={rows}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onBlur={commit}
          className={BASE}
        />
      )}
    </label>
  )
}

export const SELECT_CLASS = BASE
