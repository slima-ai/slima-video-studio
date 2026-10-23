import type { MessageRef, SlimaBook, SlimaStatus } from '@svs/schema'
import { BookOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../../../components/button'
import { SettingCard } from '../../../components/setting-card'
import { call, errorText } from '../../../lib/svs'
import { slimaLight } from './connection-state'
import { t, msg } from '@svs/schema'

const KIND_LABELS: Record<SlimaBook['kind'], MessageRef> = {
  writing: msg('settings.novel'),
  script: msg('settings.script'),
  knowledge: msg('settings.teamKnowledgeBase'),
}

/** 已連線時列出 Slima 裡的書，讓使用者確認連對了帳號。 */
function BookList() {
  const [books, setBooks] = useState<SlimaBook[] | undefined>()
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    call('slima.books', {})
      .then((result) => {
        if (alive) setBooks(result.books)
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e))
      })
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <p role="alert" className="mt-2 text-sm text-danger">
        {error}
      </p>
    )
  }
  if (!books) return <p className="mt-2 text-sm text-fg-muted">{t('settings.readingYourBooks')}</p>
  if (books.length === 0) {
    return (
      <p className="mt-2 text-sm text-fg-muted" data-testid="slima-books-empty">
        {t('settings.thereAreNoBooksIn')}
      </p>
    )
  }
  return (
    <div className="mt-2" data-testid="slima-books">
      <p className="text-sm text-fg-muted">{t('settings.foundBooks', { count: books.length })}</p>
      <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-sm">
        {books.map((book) => (
          <li key={book.token} data-testid="slima-book">
            {book.title}
            <span className="ml-2 text-fg-muted">
              {t('settings.words', {
                value: t(KIND_LABELS[book.kind]),
                value2: book.words.toLocaleString(),
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Slima 帳號（選用）：貼上 API Token，就能把小說或劇本匯入成大綱、角色與場景。只讀取，不會改 Slima 裡的內容。 */
export function SlimaCard({
  status,
  storageAvailable,
}: {
  status: SlimaStatus | undefined
  storageAvailable: boolean
}) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const connected = status !== undefined && status.state !== 'no_token'

  const run = (work: () => Promise<unknown>, after?: () => void): void => {
    setBusy(true)
    setError(undefined)
    work()
      .then(after)
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <SettingCard
      testId="slima-section"
      icon={BookOpen}
      title={t('settings.slimaAccountOptional')}
      status={{ ...slimaLight(status), testId: 'slima-status' }}
      summary={t('settings.connectYourSlimaAccountTo')}
      body={
        <div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              run(
                () => call('slima.connect', { token }),
                () => {
                  setToken('')
                },
              )
            }}
          >
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label="Slima API Token"
              data-testid="slima-token"
              placeholder={
                connected ? t('settings.pasteANewTokenTo') : t('settings.pasteYourSlimaApiToken')
              }
              value={token}
              disabled={!storageAvailable || busy}
              onChange={(event) => {
                setToken(event.target.value)
              }}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm"
            />
            <Button
              type="submit"
              variant="primary"
              data-testid="slima-connect"
              disabled={!storageAvailable || busy || token.trim() === ''}
            >
              {busy ? t('settings.connecting3') : t('settings.connect2')}
            </Button>
          </form>
          {status &&
          (status.state === 'error' || status.state === 'connecting') &&
          status.message ? (
            <p
              role={status.state === 'error' ? 'alert' : 'status'}
              data-testid="slima-message"
              className={`mt-2 text-sm ${status.state === 'error' ? 'text-danger' : 'text-fg-muted'}`}
            >
              {status.message}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          {status?.state === 'ready' ? <BookList /> : null}
        </div>
      }
      details={
        <div className="space-y-2 text-sm text-fg-muted">
          <p>{t('settings.createTheTokenOnThe')}</p>
          {connected ? (
            <Button
              variant="ghost"
              size="sm"
              data-testid="slima-disconnect"
              disabled={busy}
              onClick={() => {
                run(() => call('slima.disconnect', {}))
              }}
            >
              {t('settings.disconnectAndRemoveToken')}
            </Button>
          ) : null}
        </div>
      }
    />
  )
}
