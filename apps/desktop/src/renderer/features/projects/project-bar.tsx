import type { ProjectSummary } from '@svs/schema'
import { ChevronDown, Clapperboard, FolderOpen, FolderPlus, Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { AppView } from '../../components/app-layout'
import { call, errorText } from '../../lib/svs'
import { clockTime, useProjectStatus } from './use-project-status'

const RECENT_COUNT = 5

const usd = (n: number): string => `US$${n.toFixed(2)}`

const barButton =
  'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] hover:bg-surface-overlay focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50'
const menuItem =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-overlay focus-visible:bg-surface-overlay focus-visible:outline-none disabled:opacity-50'

export interface ProjectBarProps {
  onNavigate: (view: AppView) => void
  /** 設定載入好了才有：現在是示範模式嗎？沒有就不顯示徽章。 */
  demoMode?: boolean | undefined
  /** 有沒有填任何服務金鑰（真的 AI 模式下，沒填就提醒）。 */
  hasKey?: boolean | undefined
}

/**
 * 每一頁最上面的一條：現在是哪個專案（點名字就能改名）、專案選單、有沒有存好、
 * 示範還是真的 AI、花了多少。專案是自動儲存的，所以這裡只「說」存好了，沒有儲存鈕。
 */
export function ProjectBar({ onNavigate, demoMode, hasKey }: ProjectBarProps) {
  const { status, refresh } = useProjectStatus()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [recent, setRecent] = useState<ProjectSummary[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const name = status?.name ?? ''
  const hasProject = status !== null && status !== undefined

  const finishWith = (work: Promise<unknown>, thenCanvas: boolean): void => {
    setBusy(true)
    setError(undefined)
    work
      .then(() => {
        setMenuOpen(false)
        if (thenCanvas) onNavigate('canvas')
        refresh()
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <div
      data-testid="project-bar"
      className="relative z-40 flex h-10 shrink-0 items-center gap-1 border-b border-border bg-surface-raised px-3"
    >
      <Clapperboard className="mr-1 size-4 shrink-0 text-accent" aria-hidden />
      {renaming && hasProject ? (
        <RenameField
          initial={name}
          onCancel={() => {
            setRenaming(false)
          }}
          onCommit={(next) => {
            setRenaming(false)
            if (next !== name) finishWith(call('project.rename', { name: next }), false)
          }}
        />
      ) : (
        <button
          type="button"
          data-testid="project-name"
          disabled={!hasProject}
          title={hasProject ? '點一下改名' : '新增內容時會自動建立專案'}
          className="max-w-[24rem] truncate rounded-md px-2 py-0.5 text-sm font-semibold hover:bg-surface-overlay disabled:cursor-default disabled:hover:bg-transparent"
          onClick={() => {
            setRenaming(true)
          }}
        >
          {hasProject && name !== '' ? name : '未命名專案'}
        </button>
      )}

      <div className="relative">
        <button
          type="button"
          data-testid="project-menu-button"
          aria-label="專案選單"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={barButton}
          onClick={() => {
            if (!menuOpen) {
              call('project.list', {})
                .then((library) => {
                  setRecent(library.projects.filter((p) => !p.current).slice(0, RECENT_COUNT))
                })
                .catch(() => {
                  setRecent([])
                })
            }
            setMenuOpen(!menuOpen)
          }}
        >
          <ChevronDown className="size-4" aria-hidden />
        </button>
        {menuOpen ? (
          <ProjectMenu
            busy={busy}
            hasProject={hasProject}
            recent={recent}
            onClose={() => {
              setMenuOpen(false)
            }}
            onNew={() => {
              finishWith(call('project.createNew', {}), true)
            }}
            onOpen={(dir) => {
              finishWith(call('project.open', { dir }), true)
            }}
            onAll={() => {
              setMenuOpen(false)
              onNavigate('projects')
            }}
            onRename={() => {
              setMenuOpen(false)
              setRenaming(true)
            }}
            onReveal={() => {
              finishWith(call('project.reveal', {}), false)
            }}
          />
        ) : null}
      </div>

      <span className="flex-1" />

      {error ? (
        <span role="alert" className="truncate text-xs text-danger" data-testid="project-bar-error">
          {error}
        </span>
      ) : null}

      {hasProject ? (
        <span
          data-testid="save-status"
          className="text-xs text-fg-muted"
          title="專案會自動儲存，不需要按儲存"
        >
          已自動儲存・{clockTime(status.savedAt)}
        </span>
      ) : null}

      {demoMode === undefined ? null : (
        <button
          type="button"
          data-testid="mode-badge"
          data-mode={demoMode ? 'demo' : 'real'}
          title={
            demoMode
              ? '用假的結果跑完整個流程，不會花錢。到設定可以改成真的 AI。'
              : hasKey === false
                ? '用真的 AI 生成，會花錢。你還沒填服務金鑰，到設定填。'
                : '用真的 AI 生成，會花錢。'
          }
          className={`ml-2 rounded-full border px-3 py-0.5 text-xs ${
            demoMode
              ? 'border-border text-fg-muted'
              : hasKey === false
                ? 'border-danger/50 text-danger'
                : 'border-accent/50 text-accent'
          }`}
          onClick={() => {
            onNavigate('settings')
          }}
        >
          {demoMode ? '示範模式・不花錢' : hasKey === false ? '真的 AI・還沒填金鑰' : '真的 AI'}
        </button>
      )}

      {hasProject ? (
        <span
          data-testid="spent"
          title="這個專案到目前為止花的錢（示範模式不花錢）"
          className="ml-2 rounded-full border border-border bg-surface-raised px-3 py-0.5 text-xs text-success"
        >
          已花 {usd(status.spentUsd)}
        </span>
      ) : null}
    </div>
  )
}

/** 改名用的輸入框：Enter 或點到別處就存，Esc 取消；空的或沒改就不送出。 */
function RenameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
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
    if (commit && next !== '') onCommit(next)
    else onCancel()
  }
  return (
    <input
      ref={ref}
      data-testid="project-rename"
      aria-label="專案的新名字"
      value={value}
      maxLength={60}
      className="h-7 w-64 rounded-md border border-accent bg-surface px-2 text-sm font-semibold outline-none"
      onChange={(event) => {
        setValue(event.target.value)
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish(true)
        if (event.key === 'Escape') finish(false)
      }}
      onBlur={() => {
        finish(true)
      }}
    />
  )
}

function ProjectMenu({
  busy,
  hasProject,
  recent,
  onClose,
  onNew,
  onOpen,
  onAll,
  onRename,
  onReveal,
}: {
  busy: boolean
  hasProject: boolean
  recent: ProjectSummary[]
  onClose: () => void
  onNew: () => void
  onOpen: (dir: string) => void
  onAll: () => void
  onRename: () => void
  onReveal: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // 每次重畫 onClose 都是新的函式；用 ref 拿最新的，監聽才不會一直重掛、焦點也不會一直被搶回第一項
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const away = (event: PointerEvent): void => {
      if (event.target instanceof Node && !ref.current?.parentElement?.contains(event.target)) {
        close.current()
      }
    }
    document.addEventListener('pointerdown', away)
    return () => {
      document.removeEventListener('pointerdown', away)
    }
  }, [])
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="專案"
      data-testid="project-menu"
      className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-surface-raised p-1 shadow-lg"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <button
        type="button"
        role="menuitem"
        data-testid="menu-new"
        className={menuItem}
        disabled={busy}
        onClick={onNew}
      >
        <FolderPlus className="size-4" aria-hidden />
        新專案
      </button>
      {recent.length > 0 ? (
        <>
          <p className="px-2.5 pb-0.5 pt-2 text-xs text-fg-muted">最近的專案</p>
          {recent.map((project) => (
            <button
              key={project.dir}
              type="button"
              role="menuitem"
              data-testid="menu-recent"
              className={menuItem}
              disabled={busy}
              onClick={() => {
                onOpen(project.dir)
              }}
            >
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </button>
          ))}
        </>
      ) : null}
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        role="menuitem"
        data-testid="menu-all"
        className={menuItem}
        onClick={onAll}
      >
        <Clapperboard className="size-4" aria-hidden />
        全部專案
      </button>
      {hasProject ? (
        <>
          <button
            type="button"
            role="menuitem"
            data-testid="menu-rename"
            className={menuItem}
            onClick={onRename}
          >
            <Pencil className="size-4" aria-hidden />
            改名
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="menu-reveal"
            className={menuItem}
            disabled={busy}
            onClick={onReveal}
          >
            <FolderOpen className="size-4" aria-hidden />
            在資料夾中顯示
          </button>
        </>
      ) : null}
    </div>
  )
}
