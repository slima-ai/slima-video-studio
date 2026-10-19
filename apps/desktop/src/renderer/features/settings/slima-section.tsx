import type { SlimaBook, SlimaStatus } from '@svs/schema'
import { useEffect, useState } from 'react'

import { Badge, type BadgeTone } from '../../components/badge'
import { Button } from '../../components/button'
import { Section } from '../../components/section'
import { call, errorText } from '../../lib/svs'
import { useSlimaStatus } from '../slima/use-slima-status'

const KIND_LABELS: Record<SlimaBook['kind'], string> = {
  writing: '小說',
  script: '劇本',
  knowledge: '團隊資料庫',
}

function statusText(status: SlimaStatus | undefined): string {
  if (!status) return '檢查中…'
  switch (status.state) {
    case 'no_token':
      return '尚未連線'
    case 'connecting':
      return status.message ?? '正在連線…'
    case 'ready':
      return `已連線${status.last4 ? `（Token 結尾 ${status.last4}）` : ''}`
    case 'error':
      return status.message ?? '連不上 Slima。'
  }
}

const STATUS_TONE: Record<SlimaStatus['state'], BadgeTone> = {
  no_token: 'neutral',
  connecting: 'info',
  ready: 'success',
  error: 'danger',
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
  if (!books) return <p className="mt-2 text-sm text-fg-muted">讀取你的書…</p>
  if (books.length === 0) {
    return (
      <p className="mt-2 text-sm text-fg-muted" data-testid="slima-books-empty">
        你的 Slima 裡還沒有書。
      </p>
    )
  }
  return (
    <div className="mt-2" data-testid="slima-books">
      <p className="text-sm text-fg-muted">找到 {books.length} 本書：</p>
      <ul className="mt-1 space-y-1 text-sm">
        {books.map((book) => (
          <li key={book.token} data-testid="slima-book">
            {book.title}
            <span className="ml-2 text-fg-muted">
              {KIND_LABELS[book.kind]}・{book.words.toLocaleString()} 字
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 連上 Slima：貼上 API Token，之後可以把小說或劇本匯入成大綱、角色與場景。只讀取，不會改 Slima 裡的內容。 */
export function SlimaSection({ storageAvailable }: { storageAvailable: boolean }) {
  const status = useSlimaStatus()
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
    <Section
      testId="slima-section"
      title="Slima 連線（選用）"
      description="連上你的 Slima 帳號，就能把小說或劇本直接匯入成大綱、角色和場景。只會讀取，不會修改 Slima 裡的任何內容。"
    >
      <Badge
        tone={status ? STATUS_TONE[status.state] : 'neutral'}
        className="whitespace-normal"
        data-testid="slima-status"
        data-state={status?.state}
        aria-live="polite"
      >
        {statusText(status)}
      </Badge>

      <form
        className="mt-3 flex gap-2"
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
          placeholder={connected ? '貼上新的 Token 可以替換' : '貼上你的 Slima API Token'}
          value={token}
          disabled={!storageAvailable || busy}
          onChange={(event) => {
            setToken(event.target.value)
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <Button
          type="submit"
          variant="primary"
          data-testid="slima-connect"
          disabled={!storageAvailable || busy || token.trim() === ''}
        >
          {busy ? '連線中…' : '連線'}
        </Button>
      </form>
      <p className="mt-1 text-xs text-fg-muted">
        Token 到 Slima 網站（app.slima.ai）的 API Token
        設定頁產生。它會用系統的加密功能保存在這台電腦。
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {status?.state === 'ready' ? <BookList /> : null}

      {connected ? (
        <Button
          className="mt-3"
          variant="ghost"
          size="sm"
          data-testid="slima-disconnect"
          disabled={busy}
          onClick={() => {
            run(() => call('slima.disconnect', {}))
          }}
        >
          中斷連線並清除 Token
        </Button>
      ) : null}
    </Section>
  )
}
