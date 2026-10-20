import type { RecentProject } from '@svs/schema'
import { Clapperboard, FolderOpen, FolderPlus, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { AppView } from '../../components/app-layout'
import { Button } from '../../components/button'
import { Page } from '../../components/page'
import { call, errorText } from '../../lib/svs'
import { timeAgo } from '../../lib/usage'
import { NewProjectDialog } from './new-project-dialog'

/** 選一個舊專案的資料夾打開；回傳有沒有打開（取消是 false）。錯誤丟給呼叫的人顯示。 */
export async function pickAndOpenProject(): Promise<boolean> {
  return (await call('project.pickAndOpen', {})) !== null
}

/**
 * 首頁：還沒有專案可以接的時候（第一次用、或上次的專案找不到了）開 App 先到這裡。
 * 三件事一眼看到：新專案、開啟舊專案、最近的專案；也可以先不建專案，直接進畫布
 * （之後新增任何東西會自動建一個）。有專案開著時，從專案選單的「首頁」也回得來。
 */
export function HomePage({ onNavigate }: { onNavigate: (view: AppView) => void }) {
  const [recent, setRecent] = useState<RecentProject[]>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback((): void => {
    call('project.recent', {})
      .then(({ projects }) => {
        setRecent(projects)
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }, [])
  useEffect(load, [load])

  const run = (work: Promise<boolean>): void => {
    setBusy(true)
    setError(undefined)
    work
      .then((opened) => {
        if (opened) onNavigate('canvas')
      })
      .catch((e: unknown) => {
        setError(errorText(e))
        // 打不開的（例如剛被搬走）：重新讀清單，會標成「找不到」
        load()
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const current = recent?.find((p) => p.current)
  const others = recent?.filter((p) => !p.current) ?? []

  return (
    <Page title="首頁" hint="新專案、開啟舊專案、最近的專案。" width="narrow" testId="home-page">
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

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            data-testid="home-new"
            disabled={busy}
            onClick={() => {
              setCreating(true)
            }}
            className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-4 text-left shadow-card hover:border-accent disabled:opacity-50"
          >
            <FolderPlus className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="block font-medium">新專案</span>
              <span className="block text-sm text-fg-muted">取個名字，就開始做一支新的短片。</span>
            </span>
          </button>
          <button
            type="button"
            data-testid="home-open"
            disabled={busy}
            onClick={() => {
              run(pickAndOpenProject())
            }}
            className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-4 text-left shadow-card hover:border-accent disabled:opacity-50"
          >
            <FolderOpen className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="block font-medium">開啟舊專案…</span>
              <span className="block text-sm text-fg-muted">
                選專案的資料夾（名字以 .svsproj 結尾）。
              </span>
            </span>
          </button>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger" data-testid="home-error">
            {error}
          </p>
        ) : null}

        {current ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-fg-muted">現在開著的</h2>
            <div
              data-testid="home-current"
              className="flex items-center gap-3 rounded-lg border border-accent/60 bg-surface-raised p-3 shadow-card"
            >
              <Clapperboard className="size-5 shrink-0 text-accent" aria-hidden />
              <p className="min-w-0 flex-1 truncate font-medium">{current.name}</p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  onNavigate('canvas')
                }}
              >
                回到畫布
              </Button>
            </div>
          </section>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-fg-muted">最近的專案</h2>
          {recent && others.length === 0 ? (
            <p className="text-sm text-fg-muted" data-testid="home-recent-empty">
              還沒有。建好第一個專案，它就會出現在這裡。
            </p>
          ) : null}
          <ul className="space-y-2">
            {others.map((project) => (
              <li
                key={project.dir}
                data-testid="home-recent"
                data-missing={project.missing}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-3 shadow-card"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{project.name}</p>
                  <p className="truncate text-xs text-fg-muted" title={project.dir}>
                    {project.missing
                      ? '找不到：它可能被移走或刪掉了'
                      : `上次修改：${timeAgo(project.updatedAt ?? project.lastOpenedAt ?? '')}`}
                  </p>
                </div>
                {project.missing ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="home-forget"
                    aria-label={`從清單移除「${project.name}」`}
                    disabled={busy}
                    onClick={() => {
                      setError(undefined)
                      call('project.forgetRecent', { dir: project.dir })
                        .then(load)
                        .catch((e: unknown) => {
                          setError(errorText(e))
                        })
                    }}
                  >
                    <X className="size-4" />
                    從清單移除
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid="home-recent-open"
                    disabled={busy}
                    onClick={() => {
                      run(call('project.openRecent', { dir: project.dir }).then(() => true))
                    }}
                  >
                    打開
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <div className="border-t border-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            data-testid="home-skip"
            onClick={() => {
              onNavigate('canvas')
            }}
          >
            先不建專案，直接進畫布
          </Button>
          <p className="mt-1 text-xs text-fg-muted">之後新增任何東西時，會自動建一個專案。</p>
        </div>
      </div>
    </Page>
  )
}
