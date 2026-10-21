import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { cn } from '../../lib/cn'
import { KIND_LABEL, type NodeKind } from './canvas-model'
import type { AddChoice } from './connection-rules'
import { KindBadge } from './kind-icon'

export interface AddItem {
  kind: AddChoice['kind']
  label: string
  desc: string
}

/** 新增節點的種類與一行說明（左側節點面板、新增選單共用）。 */
export const ADD_ITEMS: readonly AddItem[] = [
  {
    kind: 'oneliner',
    label: '一句話',
    desc: '寫一句話，先看分鏡再決定要不要生成（會花錢，按之前先給預估）',
  },
  { kind: 'scene', label: '場', desc: '一段故事：地點、時間、氣氛' },
  { kind: 'shot', label: '鏡頭', desc: '一個畫面：描述、台詞、運鏡' },
  { kind: 'character', label: '角色', desc: '人物或動物：外貌、服裝' },
  { kind: 'location', label: '地點', desc: '常出現的場景' },
  { kind: 'freeImage', label: '圖片或影片', desc: '上傳一張圖或一段影片' },
  { kind: 'note', label: '便條', desc: '寫備註給自己' },
  { kind: 'group', label: '群組', desc: '框住幾格，一起搬動' },
]

export const itemFor = (kind: NodeKind): AddItem | undefined =>
  ADD_ITEMS.find((item) => item.kind === kind)

const MENU_W = 248
/** 右鍵選單寬度：最長的一項（「重做（產生新的一版）」＋快捷鍵）放得下一行。 */
export const CONTEXT_W = 248

/** 讓浮出的選單不要跑出視窗。 */
function clamp(at: { x: number; y: number }, height: number): { left: number; top: number } {
  return {
    left: Math.max(8, Math.min(at.x, window.innerWidth - MENU_W - 8)),
    top: Math.max(8, Math.min(at.y, window.innerHeight - height - 8)),
  }
}

function useDismiss(onClose: () => void): void {
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const onDown = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-floating-menu]')) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [onClose])
}

export interface AddMenuProps {
  at: { x: number; y: number }
  /** 從連接點拉線／按「＋」開的選單：只列接得上的種類。 */
  choices?: readonly AddChoice[]
  title: string
  /** 這個畫布能新增的種類；沒給就是全部。 */
  kinds?: readonly AddChoice['kind'][]
  onPick: (choice: AddChoice) => void
  onClose: () => void
}

/** 新增節點選單：搜尋框＋清單，方向鍵與 Enter 可用。 */
export function AddMenu({ at, choices, title, kinds, onPick, onClose }: AddMenuProps) {
  useDismiss(onClose)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const items = useMemo(() => {
    const pool = choices
      ? choices.flatMap((choice) => {
          // 從輸入點的「＋」選圖：選好就直接接上去
          if (choice.kind === 'freeImage') {
            return [{ choice, label: '上傳圖片', desc: '選一張圖，直接接上去' }]
          }
          const base = itemFor(choice.kind)
          const label = base?.label ?? KIND_LABEL[choice.kind]
          return [{ choice, label, desc: base?.desc ?? '' }]
        })
      : ADD_ITEMS.map((item): { choice: AddChoice; label: string; desc: string } => ({
          choice: { kind: item.kind },
          label: item.label,
          desc: item.desc,
        }))
    const allowed = pool.filter((p) => kinds === undefined || kinds.includes(p.choice.kind))
    const text = query.trim()
    // 名稱有符合就只列名稱符合的；名稱都不符合才看說明（打「地點」不該連「場」也跑出來）
    const byLabel = allowed.filter((p) => p.label.includes(text))
    return byLabel.length > 0 ? byLabel : allowed.filter((p) => p.desc.includes(text))
  }, [choices, kinds, query])
  const ref = useRef<HTMLDivElement>(null)
  const pos = clamp(at, 120 + items.length * 52)

  return (
    <div
      ref={ref}
      data-floating-menu
      data-testid="add-menu"
      role="dialog"
      aria-label="新增"
      className="fixed z-50 flex flex-col gap-1 rounded-xl border border-border bg-surface-raised p-2 shadow-panel animate-scale-in"
      style={{ ...pos, width: MENU_W }}
    >
      <p className="px-2 pt-1 text-xs text-fg-muted">{title}</p>
      <input
        // 開啟時直接可以打字搜尋
        autoFocus
        aria-label="搜尋要新增的種類"
        placeholder="輸入名稱，例如「鏡頭」"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setIndex(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setIndex((i) => Math.min(i + 1, items.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setIndex((i) => Math.max(i - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const picked = items[index]
            if (picked) onPick(picked.choice)
          }
        }}
        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
      />
      <ul role="listbox" aria-label="可以新增的種類" className="flex flex-col">
        {items.map((item, i) => (
          <li
            key={`${item.choice.kind}-${item.choice.port ?? ''}`}
            role="option"
            aria-selected={i === index}
          >
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent/10',
                i === index && 'bg-accent/10',
              )}
              onMouseEnter={() => {
                setIndex(i)
              }}
              onClick={() => {
                onPick(item.choice)
              }}
            >
              <KindBadge kind={item.choice.kind} />
              <span className="flex flex-col">
                <b className="text-[13px] font-medium">{item.label}</b>
                <small className="text-[11px] text-fg-muted">{item.desc}</small>
              </span>
            </button>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="px-2 py-2 text-xs text-fg-muted">沒有符合的種類</li>
        ) : null}
      </ul>
    </div>
  )
}

export interface MenuEntry {
  label: string
  onSelect: () => void
  danger?: boolean
  /** 分隔線放在這一項前面。 */
  separated?: boolean
  hint?: string
  /** 現在做不了：標淡，滑過寫原因；按下去照樣呼叫 `onSelect`（由它說明原因）。 */
  disabled?: boolean
  why?: string
}

/** 右鍵選單（節點上、空白處各一組）。 */
export function ContextMenu({
  at,
  entries,
  onClose,
}: {
  at: { x: number; y: number }
  entries: readonly MenuEntry[]
  onClose: () => void
}) {
  useDismiss(onClose)
  const pos = clamp(at, 16 + entries.length * 34)
  return (
    <div
      data-floating-menu
      data-testid="context-menu"
      role="menu"
      className="fixed z-50 flex flex-col rounded-xl border border-border bg-surface-raised p-1.5 shadow-panel animate-scale-in"
      style={{ ...pos, width: CONTEXT_W }}
    >
      {entries.map((entry) => (
        <div key={entry.label}>
          {entry.separated ? <hr className="my-1 border-border" /> : null}
          <button
            type="button"
            role="menuitem"
            aria-disabled={entry.disabled === true ? true : undefined}
            title={entry.why}
            className={cn(
              'flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-accent/10',
              entry.danger && 'text-danger',
              entry.disabled === true && 'opacity-45',
            )}
            onClick={() => {
              entry.onSelect()
              onClose()
            }}
          >
            {entry.label}
            {entry.hint ? <small className="shrink-0 text-fg-subtle">{entry.hint}</small> : null}
          </button>
        </div>
      ))}
    </div>
  )
}
