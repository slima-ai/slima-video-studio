import { t, type ProjectInfo } from '@svs/schema'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button'
import { Modal } from '../../components/modal'
import { call, errorText } from '../../lib/svs'

/** 新專案預設的名字（依目前的語言；不是常數：切換語言之後要跟著變）。 */
export const defaultProjectName = (): string => t('projects.myShortFilm')

/**
 * 新專案：只問一件事——名字。存在哪裡用一行小字說清楚，要換再按「更改…」。
 * Enter 就建。建好之後呼叫 onCreated（上層回到畫布）。
 */
export function NewProjectDialog({
  onClose,
  onCreated,
  mode = 'new',
  initialName = defaultProjectName(),
}: {
  onClose: () => void
  onCreated: (project: ProjectInfo) => void
  /** new：新專案；saveAs：另存為（複製目前的專案，名字與位置另外選）。 */
  mode?: 'new' | 'saveAs'
  initialName?: string
}) {
  const saveAs = mode === 'saveAs'
  const [name, setName] = useState(initialName)
  // 預設的專案資料夾；使用者按「更改…」選了別處就換成那裡
  const [defaultFolder, setDefaultFolder] = useState<string>()
  const [chosenFolder, setChosenFolder] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
    let alive = true
    call('project.list', {})
      .then((library) => {
        if (alive) setDefaultFolder(library.folder)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const folder = chosenFolder ?? defaultFolder
  const trimmed = name.trim()

  const create = (): void => {
    if (trimmed === '' || busy) return
    setBusy(true)
    setError(undefined)
    const where = chosenFolder === undefined ? {} : { parentDir: chosenFolder }
    ;(saveAs
      ? call('project.saveAs', { name: trimmed, ...where })
      : call('project.createAt', { name: trimmed, ...where })
    )
      .then(onCreated)
      .catch((e: unknown) => {
        setError(errorText(e))
        setBusy(false)
      })
  }

  const change = (): void => {
    setError(undefined)
    call('project.pickFolder', {})
      .then(({ dir }) => {
        if (dir !== null) setChosenFolder(dir)
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }

  return (
    <Modal
      label={saveAs ? t('projects.saveAs') : t('projects.newProject')}
      onClose={onClose}
      dismissible={!busy}
      testId={saveAs ? 'save-as-dialog' : 'new-project-dialog'}
    >
      <form
        className="w-[28rem] max-w-full space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault()
          create()
        }}
      >
        <h2 className="text-base font-semibold">
          {saveAs ? t('projects.saveAs') : t('projects.newProject')}
        </h2>
        {saveAs ? (
          <p className="text-sm text-fg-muted">{t('projects.copyThisProjectWithIts')}</p>
        ) : null}
        <div className="space-y-1">
          <label className="block text-sm font-medium" htmlFor="new-project-name">
            {saveAs ? t('projects.nameOfTheNewCopy') : t('projects.projectName')}
          </label>
          <input
            id="new-project-name"
            ref={input}
            data-testid="new-project-name"
            value={name}
            maxLength={60}
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm"
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        </div>
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="min-w-0 flex-1 truncate" title={folder} data-testid="new-project-folder">
            {t('projects.savedInFolder', { folder: folder ?? '…' })}
          </span>
          <button
            type="button"
            data-testid="new-project-change-folder"
            disabled={busy}
            className="shrink-0 rounded-md px-2 py-1 text-accent hover:bg-surface-overlay disabled:opacity-50"
            onClick={change}
          >
            {t('projects.change')}
          </button>
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger" data-testid="new-project-error">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {t('projects.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            data-testid="new-project-create"
            disabled={busy || trimmed === ''}
          >
            {saveAs ? t('projects.save') : t('projects.create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
