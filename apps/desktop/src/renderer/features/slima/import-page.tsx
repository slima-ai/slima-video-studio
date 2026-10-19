import type {
  SlimaBook,
  SlimaFileUse,
  SlimaImportCheck,
  SlimaImportResult,
  SlimaTree,
} from '@svs/schema'
import { useEffect, useState } from 'react'

import type { AppView } from '../../components/app-layout'
import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'
import { useSlimaStatus } from './use-slima-status'
import { Page, SELECT_CLASS } from '../../components/page'

export interface SlimaImportPageProps {
  onOpenSettings: () => void
  onNavigate: (view: AppView) => void
}

export const USE_LABELS: Record<SlimaFileUse, string> = {
  story: '故事內容（拆成分場）',
  character: '角色',
  location: '地點',
  scene: '一場戲',
}

const KIND_LABELS: Record<SlimaBook['kind'], string> = {
  writing: '小說',
  script: '劇本',
  knowledge: '團隊資料庫',
}

const usd = (n: number): string => `US$${n.toFixed(2)}`

function Names({ label, names }: { label: string; names: readonly string[] }) {
  if (names.length === 0) return null
  return (
    <li>
      {label}：{names.join('、')}
    </li>
  )
}

function CheckPanel({
  check,
  busy,
  onConfirm,
  onCancel,
}: {
  check: SlimaImportCheck
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="space-y-3 rounded-lg border border-border bg-surface-raised shadow-card p-4"
      data-testid="slima-import-check"
    >
      {check.issue ? (
        <p className="text-sm text-danger" data-testid="slima-import-issue">
          {check.issue}
        </p>
      ) : null}
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {check.storyFiles > 0 ? (
          <li data-testid="slima-import-story">
            把 {check.storyFiles} 個檔案（約 {check.storyChars.toLocaleString()} 字）交給 AI
            拆成分場
            {check.demoMode ? '，示範模式不花錢' : `，預估約 ${usd(check.estimatedUsd)}`}
            {check.modelName ? `（${check.modelName}）` : ''}
          </li>
        ) : null}
        <Names label="新增角色" names={check.characters} />
        <Names label="新增地點" names={check.locations} />
        <Names label="新增場" names={check.scenes} />
      </ul>
      {check.replacesOutline && check.storyFiles > 0 ? (
        <p className="text-sm text-warning" data-testid="slima-import-replaces">
          拆成分場會換掉目前的大綱（已經生成的鏡頭不受影響）。
        </p>
      ) : null}
      {check.skipped.length > 0 ? (
        <div className="text-sm text-fg-muted" data-testid="slima-import-skipped">
          <p>會略過：</p>
          <ul className="list-disc pl-5">
            {check.skipped.map((item) => (
              <li key={item.path}>
                {item.path}（{item.reason}）
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex gap-2">
        {check.ok ? (
          <Button
            variant="primary"
            data-testid="slima-import-confirm"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? '匯入中…' : '確定匯入'}
          </Button>
        ) : null}
        <Button data-testid="slima-import-cancel" disabled={busy} onClick={onCancel}>
          {check.ok ? '先不要' : '返回'}
        </Button>
      </div>
    </div>
  )
}

function ResultPanel({
  result,
  onNavigate,
  onAgain,
}: {
  result: SlimaImportResult
  onNavigate: (view: AppView) => void
  onAgain: () => void
}) {
  const parts = [
    result.actsFromStory > 0 ? `拆出 ${String(result.actsFromStory)} 幕` : '',
    result.characters.length > 0 ? `${String(result.characters.length)} 個角色` : '',
    result.locations.length > 0 ? `${String(result.locations.length)} 個地點` : '',
    result.scenes.length > 0 ? `${String(result.scenes.length)} 場戲` : '',
  ].filter((part) => part !== '')
  return (
    <div
      className="space-y-3 rounded-lg border border-success/40 bg-success-soft p-4"
      data-testid="slima-import-result"
    >
      <p className="font-medium">匯入完成了。</p>
      <p className="text-sm text-fg-muted" data-testid="slima-import-summary">
        {parts.length > 0 ? `新增：${parts.join('、')}。` : '沒有新增任何東西。'}
        {result.skipped.length > 0 ? `略過了 ${String(result.skipped.length)} 個檔案。` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {result.actsFromStory > 0 || result.scenes.length > 0 ? (
          <Button
            size="sm"
            data-testid="slima-go-outline"
            onClick={() => {
              onNavigate('outline')
            }}
          >
            看大綱
          </Button>
        ) : null}
        {result.characters.length > 0 ? (
          <Button
            size="sm"
            data-testid="slima-go-characters"
            onClick={() => {
              onNavigate('characters')
            }}
          >
            看角色
          </Button>
        ) : null}
        {result.locations.length > 0 ? (
          <Button
            size="sm"
            data-testid="slima-go-locations"
            onClick={() => {
              onNavigate('locations')
            }}
          >
            看場景卡
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" data-testid="slima-import-again" onClick={onAgain}>
          再匯入別的
        </Button>
      </div>
    </div>
  )
}

/** 選一本書 → 勾選要匯入的檔案與用途 → 看過預估與會建立的東西 → 確定匯入。只讀取 Slima，不會改動書裡的內容。 */
export function SlimaImportPage({ onOpenSettings, onNavigate }: SlimaImportPageProps) {
  const status = useSlimaStatus()
  const ready = status?.state === 'ready'
  const [books, setBooks] = useState<SlimaBook[] | undefined>()
  const [tree, setTree] = useState<SlimaTree | undefined>()
  const [uses, setUses] = useState<Record<string, SlimaFileUse>>({})
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [check, setCheck] = useState<SlimaImportCheck | undefined>()
  const [result, setResult] = useState<SlimaImportResult | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!ready) return
    let alive = true
    call('slima.books', {})
      .then((next) => {
        if (alive) setBooks(next.books)
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e))
      })
    return () => {
      alive = false
    }
  }, [ready])

  const run = (work: () => Promise<void>): void => {
    setBusy(true)
    setError(undefined)
    work()
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const openBook = (book: SlimaBook): void => {
    run(async () => {
      const next = await call('slima.tree', { bookToken: book.token })
      setTree(next)
      setUses(Object.fromEntries(next.files.map((f) => [f.path, f.suggestedUse])))
      setPicked(new Set())
      setCheck(undefined)
      setResult(undefined)
    })
  }

  const request = () => ({
    bookToken: tree?.book.token ?? '',
    items: (tree?.files ?? [])
      .filter((f) => picked.has(f.path))
      .map((f) => ({ path: f.path, use: uses[f.path] ?? f.suggestedUse })),
  })

  const toggle = (path: string): void => {
    setCheck(undefined)
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  return (
    <Page
      title="從 Slima 匯入"
      hint="把 Slima 裡的小說或劇本變成大綱、角色和場景。只會讀取，不會改動 Slima 裡的內容。"
      width="narrow"
      testId="slima-import-page"
    >
      <div className="space-y-5">
        {status && !ready ? (
          <div
            className="rounded-lg border border-border bg-surface-raised shadow-card p-4"
            data-testid="slima-import-offline"
          >
            <p className="text-sm">{status.message ?? '還沒有連上 Slima。'}</p>
            <Button className="mt-3" size="sm" onClick={onOpenSettings}>
              到設定檢查 Slima 連線
            </Button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {ready && !tree ? (
          <section aria-label="我的書" data-testid="slima-import-books">
            {books === undefined ? <p className="text-sm text-fg-muted">讀取你的書…</p> : null}
            {books?.length === 0 ? (
              <p className="text-sm text-fg-muted">你的 Slima 裡還沒有書。</p>
            ) : null}
            <ul className="space-y-2">
              {books?.map((book) => (
                <li key={book.token}>
                  <button
                    type="button"
                    data-testid="slima-import-book"
                    disabled={busy}
                    onClick={() => {
                      openBook(book)
                    }}
                    className="w-full rounded-lg border border-border bg-surface-raised shadow-card p-3 text-left hover:bg-surface-overlay"
                  >
                    <span className="font-medium">{book.title}</span>
                    <span className="ml-2 text-sm text-fg-muted">
                      {KIND_LABELS[book.kind]}・{book.words.toLocaleString()} 字
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {tree && !result ? (
          <section
            className="space-y-3"
            aria-label="選擇要匯入的檔案"
            data-testid="slima-import-files"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-medium">
                《{tree.book.title}》
                <span className="ml-2 text-sm font-normal text-fg-muted">
                  {KIND_LABELS[tree.book.kind]}
                </span>
              </h2>
              <Button
                size="sm"
                variant="ghost"
                data-testid="slima-import-back"
                disabled={busy}
                onClick={() => {
                  setTree(undefined)
                  setCheck(undefined)
                }}
              >
                換一本書
              </Button>
            </div>
            {tree.files.length === 0 ? (
              <p className="text-sm text-fg-muted" data-testid="slima-import-nofiles">
                這本書裡沒有可以匯入的文字檔。
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface-raised shadow-card">
                {tree.files.map((file) => (
                  <li
                    key={file.path}
                    className="flex items-center gap-3 px-3 py-2"
                    data-testid="slima-import-file"
                  >
                    <input
                      type="checkbox"
                      aria-label={`選取 ${file.path}`}
                      checked={picked.has(file.path)}
                      onChange={() => {
                        toggle(file.path)
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm" title={file.path}>
                      {file.path}
                      <span className="ml-2 text-fg-muted">{file.words.toLocaleString()} 字</span>
                    </span>
                    <select
                      aria-label={`${file.path} 要當成`}
                      data-testid="slima-import-use"
                      className={SELECT_CLASS}
                      value={uses[file.path] ?? file.suggestedUse}
                      onChange={(event) => {
                        setCheck(undefined)
                        setUses({ ...uses, [file.path]: event.target.value as SlimaFileUse })
                      }}
                    >
                      {(Object.keys(USE_LABELS) as SlimaFileUse[]).map((use) => (
                        <option key={use} value={use}>
                          {USE_LABELS[use]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="primary"
              data-testid="slima-import-run"
              disabled={busy || picked.size === 0}
              onClick={() => {
                run(async () => {
                  setCheck(await call('slima.importCheck', request()))
                })
              }}
            >
              {picked.size > 0 ? `匯入選取的 ${String(picked.size)} 個檔案` : '先勾選要匯入的檔案'}
            </Button>
            {check ? (
              <CheckPanel
                check={check}
                busy={busy}
                onConfirm={() => {
                  run(async () => {
                    setResult(await call('slima.import', request()))
                    setCheck(undefined)
                  })
                }}
                onCancel={() => {
                  setCheck(undefined)
                }}
              />
            ) : null}
          </section>
        ) : null}

        {result ? (
          <ResultPanel
            result={result}
            onNavigate={onNavigate}
            onAgain={() => {
              setResult(undefined)
              setPicked(new Set())
            }}
          />
        ) : null}
      </div>
    </Page>
  )
}
