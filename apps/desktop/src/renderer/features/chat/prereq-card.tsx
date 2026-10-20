import type { ChatPrereq } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'

const INSTALL_URL = 'https://code.claude.com/docs/en/overview'

/**
 * 還不能開始對話時的說明卡（不是錯誤對話框）：哪一項沒準備好就說哪一項，附上能做的下一步。
 * 沒裝 Claude Code、版本太舊、沒登入——我們不代為安裝、不代為登入、不碰他的憑證。
 */
export function PrereqCard({
  prereq,
  onRecheck,
}: {
  prereq: Exclude<ChatPrereq, { state: 'ready' }>
  onRecheck: () => void
}) {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const enableMcp = (): void => {
    setBusy(true)
    setError(undefined)
    call('settings.update', { mcp: { enabled: true } })
      .then(onRecheck)
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(false)
      })
  }
  return (
    <div className="space-y-3 p-4 text-sm" data-testid="chat-prereq" data-state={prereq.state}>
      {prereq.state === 'disabled' ? (
        <>
          <h3 className="font-semibold">Claude 對話現在是關著的</h3>
          <p className="text-fg-muted">
            這是實驗功能。到「設定」→「實驗功能」，打開「畫布右下角的 Claude 對話」就能用。
          </p>
        </>
      ) : prereq.state === 'mcp_off' ? (
        <>
          <h3 className="font-semibold">先打開「AI 工具連線」</h3>
          <p className="text-fg-muted">
            Claude 是透過 App 的「AI 工具連線」直接改你的專案。打開之後，它只能用 App 提供的工具。
            會花錢的步驟（生成圖片、影片…）受「AI 工具的總額度」限制，預設是 US$0——
            示範模式不花錢；要在真實模式讓 Claude 生成，請到「設定 → AI 工具連線」調高「AI
            工具的總額度」。
          </p>
          <Button variant="primary" size="sm" disabled={busy} onClick={enableMcp}>
            打開 AI 工具連線
          </Button>
        </>
      ) : prereq.state === 'not_installed' ? (
        <>
          <h3 className="font-semibold">需要你電腦上的 Claude Code</h3>
          <p className="text-fg-muted">
            Claude Code 是 Anthropic 的命令列工具。這裡的對話是用你自己的 Claude Code 在跑，App
            不會代你安裝。裝好之後回來按「重新檢查」。
          </p>
          <p>
            <a
              href={INSTALL_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              Claude Code 的安裝說明（英文）
            </a>
          </p>
        </>
      ) : prereq.state === 'too_old' ? (
        <>
          <h3 className="font-semibold">Claude Code 的版本太舊</h3>
          <p className="text-fg-muted">
            你的是 {prereq.version}，需要 {prereq.minVersion} 以上。在終端機執行{' '}
            <code className="rounded bg-surface-overlay px-1">claude update</code>{' '}
            更新，再回來按「重新檢查」。
          </p>
        </>
      ) : (
        <>
          <h3 className="font-semibold">請先登入 Claude Code</h3>
          <p className="text-fg-muted">
            在終端機（macOS：打開「終端機」App）執行{' '}
            <code className="rounded bg-surface-overlay px-1">claude</code> 並照畫面登入。App
            不會碰你的登入資料。登入好了回來按「我登入好了」。
          </p>
        </>
      )}
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      {prereq.state === 'mcp_off' || prereq.state === 'disabled' ? null : (
        <Button size="sm" onClick={onRecheck} data-testid="chat-recheck">
          {prereq.state === 'not_logged_in' ? '我登入好了' : '重新檢查'}
        </Button>
      )}
    </div>
  )
}
