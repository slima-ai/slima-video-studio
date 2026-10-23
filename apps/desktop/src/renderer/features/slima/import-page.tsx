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
import { formatNumber } from '@svs/schema'
import { t, msg, type MessageRef } from '@svs/schema'

export interface SlimaImportPageProps {
  onOpenSettings: () => void
  onNavigate: (view: AppView) => void
}

export const USE_LABELS: Record<SlimaFileUse, MessageRef> = {
  story: msg('slima.storySplitIntoScenes'),
  character: msg('slima.character'),
  location: msg('slima.location'),
  scene: msg('slima.aScene'),
}

const KIND_LABELS: Record<SlimaBook['kind'], MessageRef> = {
  writing: msg('slima.novel'),
  script: msg('slima.script'),
  knowledge: msg('slima.teamKnowledgeBase'),
}

const usd = (n: number): string => `US$${n.toFixed(2)}`

function Names({ label, names }: { label: string; names: readonly string[] }) {
  if (names.length === 0) return null
  return <li>{t('slima.nameList', { label, names: names.join(t('list.comma')) })}</li>
}

/** 「把 3 個檔案（約 1,234 字）交給 AI 拆成分場，預估約 US$0.05（模型名）」：示範模式與有沒有模型名各一句。 */
function storyLine(check: SlimaImportCheck): string {
  const files = t('slima.fileCount', { count: check.storyFiles })
  const words = t('slima.wordCount', { formatted: formatNumber(check.storyChars) })
  if (check.demoMode) {
    return check.modelName
      ? t('slima.haveAiSplitAboutInto', { files, words, modelName: check.modelName })
      : t('slima.haveAiSplitAboutInto2', { files, words })
  }
  const cost = usd(check.estimatedUsd)
  return check.modelName
    ? t('slima.haveAiSplitAboutInto3', { files, words, cost, modelName: check.modelName })
    : t('slima.haveAiSplitAboutInto4', { files, words, cost })
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
        {check.storyFiles > 0 ? <li data-testid="slima-import-story">{storyLine(check)}</li> : null}
        <Names label={t('slima.newCharacters')} names={check.characters} />
        <Names label={t('slima.newLocations')} names={check.locations} />
        <Names label={t('slima.newScenes')} names={check.scenes} />
      </ul>
      {check.replacesOutline && check.storyFiles > 0 ? (
        <p className="text-sm text-warning" data-testid="slima-import-replaces">
          {t('slima.splittingIntoScenesReplacesThe')}
        </p>
      ) : null}
      {check.skipped.length > 0 ? (
        <div className="text-sm text-fg-muted" data-testid="slima-import-skipped">
          <p>{t('slima.willBeSkipped')}</p>
          <ul className="list-disc pl-5">
            {check.skipped.map((item) => (
              <li key={item.path}>
                {t('slima.skippedItem', { path: item.path, reason: item.reason })}
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
            {busy ? t('slima.importing') : t('slima.import')}
          </Button>
        ) : null}
        <Button data-testid="slima-import-cancel" disabled={busy} onClick={onCancel}>
          {check.ok ? t('slima.notNow') : t('slima.back')}
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
    result.actsFromStory > 0 ? t('slima.partActs', { count: result.actsFromStory }) : '',
    result.characters.length > 0
      ? t('slima.partCharacters', { count: result.characters.length })
      : '',
    result.locations.length > 0 ? t('slima.partLocations', { count: result.locations.length }) : '',
    result.scenes.length > 0 ? t('slima.partScenes', { count: result.scenes.length }) : '',
  ].filter((part) => part !== '')
  return (
    <div
      className="space-y-3 rounded-lg border border-success/40 bg-success-soft p-4"
      data-testid="slima-import-result"
    >
      <p className="font-medium">{t('slima.importFinished')}</p>
      <p className="text-sm text-fg-muted" data-testid="slima-import-summary">
        {[
          parts.length > 0
            ? t('slima.added', { value: parts.join(t('list.comma')) })
            : t('slima.nothingWasAdded'),
          ...(result.skipped.length > 0
            ? [t('slima.skippedFiles', { count: result.skipped.length })]
            : []),
        ].join(t('list.sentence'))}
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
            {t('slima.seeTheOutline')}
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
            {t('slima.seeTheCharacters')}
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
            {t('slima.seeTheLocations')}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" data-testid="slima-import-again" onClick={onAgain}>
          {t('slima.importSomethingElse')}
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
      title={t('slima.importFromSlima')}
      hint={t('slima.turnANovelOrScript')}
      width="narrow"
      testId="slima-import-page"
    >
      <div className="space-y-5">
        {status && !ready ? (
          <div
            className="rounded-lg border border-border bg-surface-raised shadow-card p-4"
            data-testid="slima-import-offline"
          >
            <p className="text-sm">{status.message ?? t('slima.notConnectedToSlimaYet')}</p>
            <Button className="mt-3" size="sm" onClick={onOpenSettings}>
              {t('slima.checkTheSlimaConnectionIn')}
            </Button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {ready && !tree ? (
          <section aria-label={t('slima.myBooks')} data-testid="slima-import-books">
            {books === undefined ? (
              <p className="text-sm text-fg-muted">{t('slima.loadingYourBooks')}</p>
            ) : null}
            {books?.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('slima.yourSlimaHasNoBooks')}</p>
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
                      {`${t(KIND_LABELS[book.kind])}${t('list.dot')}${t('slima.wordCount', { formatted: formatNumber(book.words) })}`}
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
            aria-label={t('slima.chooseTheFilesToImport')}
            data-testid="slima-import-files"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-medium">
                {t('slima.bookTitle', { title: tree.book.title })}
                <span className="ml-2 text-sm font-normal text-fg-muted">
                  {t(KIND_LABELS[tree.book.kind])}
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
                {t('slima.pickAnotherBook')}
              </Button>
            </div>
            {tree.files.length === 0 ? (
              <p className="text-sm text-fg-muted" data-testid="slima-import-nofiles">
                {t('slima.thisBookHasNoText')}
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
                      aria-label={t('slima.select', { path: file.path })}
                      checked={picked.has(file.path)}
                      onChange={() => {
                        toggle(file.path)
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm" title={file.path}>
                      {file.path}
                      <span className="ml-2 text-fg-muted">
                        {t('slima.wordCount', { formatted: formatNumber(file.words) })}
                      </span>
                    </span>
                    <select
                      aria-label={t('slima.useAs', { path: file.path })}
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
                          {t(USE_LABELS[use])}
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
              {picked.size > 0
                ? t('slima.importPicked', { count: picked.size })
                : t('slima.tickTheFilesToImport')}
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
