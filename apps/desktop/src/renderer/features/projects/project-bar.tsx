import type { MenuAction, ProjectStatus, RecentProject } from '@svs/schema'
import {
  ChevronDown,
  Clapperboard,
  Copy,
  FolderOpen,
  FolderPlus,
  House,
  Pencil,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { AppView } from '../../components/app-layout'
import { call, errorText } from '../../lib/svs'
import { pickAndOpenProject } from './home-page'
import { NewProjectDialog } from './new-project-dialog'
import { useToast } from '../../components/toast'
import { clockTime, useProjectStatus } from './use-project-status'
import { t } from '@svs/schema'

const RECENT_COUNT = 5

const usd = (n: number): string => `US$${n.toFixed(2)}`

/** 「儲存」的提示：專案是自動儲存的，告訴使用者最後一次是幾點。⌘S 與（之後）檔案選單的「儲存」都用它。 */
export function saveHint(status: ProjectStatus | null | undefined): string {
  return status
    ? t('projects.projectsSaveThemselvesLastSaved', { value: clockTime(status.savedAt) })
    : t('projects.noProjectYetAddingAnything')
}

const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')

/** 選單項目右邊的快捷鍵提示；只有 macOS 有「檔案」選單，別的系統沒有這些快捷鍵就不顯示。 */
function Shortcut({ keys }: { keys: string }) {
  return IS_MAC ? <span className="ml-auto text-xs text-fg-muted">{keys}</span> : null
}

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
  const [creating, setCreating] = useState(false)
  const [savingAs, setSavingAs] = useState(false)
  const toast = useToast()
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const name = status?.name ?? ''
  const hasProject = status !== null && status !== undefined

  // 視窗上方選單（macOS 的「檔案」）選了哪一項：做的跟這一列的選單、快捷鍵是同一批動作。
  // 用 ref 拿最新的版本，訂閱才不用每次重畫都重掛
  const onMenuAction = useRef<(menu: MenuAction) => void>(() => undefined)
  onMenuAction.current = (menu) => {
    if (creating || savingAs) return
    const noProject = (what: 'saveAs' | 'rename' | 'reveal'): void => {
      const message = {
        saveAs: t('projects.noProjectToSaveAs'),
        rename: t('projects.noProjectToRename'),
        reveal: t('projects.noProjectToReveal'),
      }[what]
      toast.show({ message })
    }
    switch (menu.action) {
      case 'new':
        setCreating(true)
        break
      case 'open':
        finishWith(pickAndOpenProject(), true)
        break
      case 'openRecent':
        if (menu.dir !== undefined) finishWith(call('project.openRecent', { dir: menu.dir }), true)
        break
      case 'save':
        toast.show({ message: saveHint(status), key: 'save-hint' })
        break
      case 'saveAs':
        if (hasProject) setSavingAs(true)
        else noProject('saveAs')
        break
      case 'rename':
        if (hasProject) setRenaming(true)
        else noProject('rename')
        break
      case 'reveal':
        if (hasProject) finishWith(call('project.reveal', {}), false)
        else noProject('reveal')
        break
      case 'home':
        onNavigate('home')
        break
    }
  }
  useEffect(
    () =>
      window.svs.on('menu.action', (menu) => {
        onMenuAction.current(menu)
      }),
    [],
  )

  // ⌘S／Ctrl+S：專案是自動儲存的，沒有東西要存；習慣按的人會看到這句，知道已經存好了。
  // 用 useLayoutEffect：畫面一更新（讀到存檔時間）處理函式就同步換成新的；用 useEffect 的話，
  // 兩者之間有一小段空檔，這時按下去會讀到舊的狀態（顯示「還沒有專案」）——電腦忙的時候測試會撞到
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault()
        toast.show({ message: saveHint(status), key: 'save-hint' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [status, toast])

  const finishWith = (work: Promise<unknown>, thenCanvas: boolean): void => {
    setBusy(true)
    setError(undefined)
    work
      .then((result) => {
        setMenuOpen(false)
        // false ＝ 使用者在選資料夾的視窗按了取消：不跳到畫布
        if (thenCanvas && result !== false) onNavigate('canvas')
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
          title={hasProject ? t('projects.clickToRename') : t('projects.aProjectIsCreatedWhen')}
          className="max-w-[24rem] truncate rounded-md px-2 py-0.5 text-sm font-semibold hover:bg-surface-overlay disabled:cursor-default disabled:hover:bg-transparent"
          onClick={() => {
            setRenaming(true)
          }}
        >
          {!hasProject
            ? t('projects.noProjectYet')
            : name !== ''
              ? name
              : t('projects.untitledProject')}
        </button>
      )}

      <div className="relative">
        <button
          type="button"
          data-testid="project-menu-button"
          aria-label={t('projects.projectMenu')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={barButton}
          onClick={() => {
            if (!menuOpen) {
              call('project.recent', {})
                .then(({ projects }) => {
                  setRecent(projects.filter((p) => !p.current && !p.missing).slice(0, RECENT_COUNT))
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
              setMenuOpen(false)
              setCreating(true)
            }}
            onOpen={(dir) => {
              finishWith(call('project.openRecent', { dir }), true)
            }}
            onOpenOld={() => {
              finishWith(pickAndOpenProject(), true)
            }}
            onHome={() => {
              setMenuOpen(false)
              onNavigate('home')
            }}
            onAll={() => {
              setMenuOpen(false)
              onNavigate('projects')
            }}
            onSaveAs={() => {
              setMenuOpen(false)
              setSavingAs(true)
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

      {creating ? (
        <NewProjectDialog
          onClose={() => {
            setCreating(false)
          }}
          onCreated={() => {
            setCreating(false)
            onNavigate('canvas')
            refresh()
          }}
        />
      ) : null}

      {savingAs ? (
        <NewProjectDialog
          mode="saveAs"
          initialName={t('projects.copy', { name })}
          onClose={() => {
            setSavingAs(false)
          }}
          onCreated={(saved) => {
            setSavingAs(false)
            refresh()
            toast.show({ message: t('projects.savedAsThisIsThe', { name: saved.name }) })
          }}
        />
      ) : null}

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
          title={t('projects.projectsSaveThemselvesNoNeed')}
        >
          {t('projects.autoSavedAt', { time: clockTime(status.savedAt) })}
        </span>
      ) : null}

      {demoMode === undefined ? null : (
        <button
          type="button"
          data-testid="mode-badge"
          data-mode={demoMode ? 'demo' : 'real'}
          title={
            demoMode
              ? t('projects.runsTheWholeProcessWith')
              : hasKey === false
                ? t('projects.usesRealAiAndCosts')
                : t('projects.usesRealAiAndCosts2')
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
          {demoMode
            ? t('projects.demoModeFree')
            : hasKey === false
              ? t('projects.realAiNoKeyYet')
              : t('projects.realAi')}
        </button>
      )}

      {hasProject ? (
        <span
          data-testid="spent"
          title={t('projects.whatThisProjectHasCost')}
          className="ml-2 rounded-full border border-border bg-surface-raised px-3 py-0.5 text-xs text-success"
        >
          {t('projects.spent')} {usd(status.spentUsd)}
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
      aria-label={t('projects.newProjectName')}
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
  onOpenOld,
  onHome,
  onAll,
  onSaveAs,
  onRename,
  onReveal,
}: {
  busy: boolean
  hasProject: boolean
  recent: RecentProject[]
  onClose: () => void
  onNew: () => void
  onOpen: (dir: string) => void
  onOpenOld: () => void
  onHome: () => void
  onAll: () => void
  onSaveAs: () => void
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
      aria-label={t('projects.project')}
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
        {t('projects.newProject')}
        <Shortcut keys="⌘N" />
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="menu-open-old"
        className={menuItem}
        disabled={busy}
        onClick={onOpenOld}
      >
        <FolderOpen className="size-4" aria-hidden />
        {t('projects.openProject')}
        <Shortcut keys="⌘O" />
      </button>
      {recent.length > 0 ? (
        <>
          <p className="px-2.5 pb-0.5 pt-2 text-xs text-fg-muted">{t('projects.recentProjects')}</p>
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
        data-testid="menu-home"
        className={menuItem}
        onClick={onHome}
      >
        <House className="size-4" aria-hidden />
        {t('projects.home')}
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="menu-all"
        className={menuItem}
        onClick={onAll}
      >
        <Clapperboard className="size-4" aria-hidden />
        {t('projects.allProjects')}
      </button>
      {hasProject ? (
        <>
          <button
            type="button"
            role="menuitem"
            data-testid="menu-save-as"
            className={menuItem}
            disabled={busy}
            onClick={onSaveAs}
          >
            <Copy className="size-4" aria-hidden />
            {t('projects.saveAs2')}
            <Shortcut keys="⇧⌘S" />
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="menu-rename"
            className={menuItem}
            onClick={onRename}
          >
            <Pencil className="size-4" aria-hidden />
            {t('projects.rename')}
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
            {t('projects.showInFolder')}
          </button>
        </>
      ) : null}
    </div>
  )
}
