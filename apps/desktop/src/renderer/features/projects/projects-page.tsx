import type { ProjectSummary } from '@svs/schema'
import { Clapperboard, FolderOpen, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { AppView } from '../../components/app-layout'
import { Button } from '../../components/button'
import { EmptyState } from '../../components/empty-state'
import { Page } from '../../components/page'
import { call, errorText } from '../../lib/svs'
import { pickAndOpenProject } from './home-page'
import { NewProjectDialog } from './new-project-dialog'
import { timeAgo } from '../../lib/usage'
import { t } from '@svs/schema'

interface Library {
  folder: string
  projects: ProjectSummary[]
}

/**
 * 專案頁：現在開著哪個專案、資料夾裡還有哪些專案（最近改過的在前），可以打開、開新的、
 * 在檔案總管裡找到它。打開或開新的之後回到畫布。
 */
export function ProjectsPage({ onNavigate }: { onNavigate: (view: AppView) => void }) {
  const [library, setLibrary] = useState<Library>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback((): void => {
    call('project.list', {})
      .then((next) => {
        setLibrary(next)
        setError(undefined)
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }, [])
  useEffect(load, [load])

  const act = (work: () => Promise<unknown>, thenCanvas: boolean): void => {
    setBusy(true)
    setError(undefined)
    work()
      .then(() => {
        if (thenCanvas) onNavigate('canvas')
        else load()
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(false)
      })
  }
  const open = (dir: string): void => {
    act(() => call('project.open', { dir }), true)
  }
  const reveal = (dir: string): void => {
    act(() => call('project.reveal', { dir }), false)
  }

  const current = library?.projects.find((p) => p.current)
  const others = library?.projects.filter((p) => !p.current) ?? []

  return (
    <Page
      title={t('projects.project')}
      hint={t('projects.eachProjectIsAFolder')}
      width="narrow"
      testId="projects-page"
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            data-testid="project-open-old"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(undefined)
              pickAndOpenProject()
                .then((opened) => {
                  if (opened) onNavigate('canvas')
                })
                .catch((e: unknown) => {
                  setError(errorText(e))
                })
                .finally(() => {
                  setBusy(false)
                })
            }}
          >
            <FolderOpen className="size-4" />
            {t('projects.openProject')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            data-testid="project-new"
            disabled={busy}
            onClick={() => {
              setCreating(true)
            }}
          >
            <Plus className="size-4" />
            {t('projects.newProject2')}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {creating ? (
          <NewProjectDialog
            onClose={() => {
              setCreating(false)
            }}
            onCreated={() => {
              setCreating(false)
              onNavigate('canvas')
            }}
          />
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-fg-muted">{t('projects.openNow')}</h2>
          {current ? (
            <div
              data-testid="project-current"
              className="flex items-center gap-3 rounded-lg border border-accent/60 bg-surface-raised p-4 shadow-card"
            >
              <Clapperboard className="size-5 shrink-0 text-accent" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{current.name}</p>
                <p className="text-xs text-fg-muted">
                  {t('projects.lastEdited', { value: timeAgo(current.updatedAt) })}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  reveal(current.dir)
                }}
              >
                <FolderOpen className="size-4" />
                {t('projects.showInFolder')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  onNavigate('canvas')
                }}
              >
                {t('projects.backToTheCanvas')}
              </Button>
            </div>
          ) : library ? (
            <p className="text-sm text-fg-muted" data-testid="project-none">
              {t('projects.noProjectIsOpenAdd')}
            </p>
          ) : null}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-fg-muted">{t('projects.otherProjects')}</h2>
          {library && others.length === 0 ? (
            <EmptyState
              testId="project-others-empty"
              icon={FolderOpen}
              message={t('projects.noOtherProjectsInThis')}
            />
          ) : null}
          <ul className="space-y-2">
            {others.map((project) => (
              <li
                key={project.dir}
                data-testid="project-item"
                className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-3 shadow-card"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{project.name}</p>
                  <p className="text-xs text-fg-muted">
                    {t('projects.lastEdited', { value: timeAgo(project.updatedAt) })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    reveal(project.dir)
                  }}
                >
                  {t('projects.showInFolder')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="project-open"
                  disabled={busy}
                  onClick={() => {
                    open(project.dir)
                  }}
                >
                  {t('projects.open')}
                </Button>
              </li>
            ))}
          </ul>
        </section>

        {library ? (
          <p className="truncate text-xs text-fg-subtle" title={library.folder}>
            {t('projects.keptInFolder', { folder: library.folder })}
          </p>
        ) : null}
      </div>
    </Page>
  )
}
