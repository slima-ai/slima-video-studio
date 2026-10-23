import type { ChatPrereq } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'
import { t } from '@svs/schema'

const INSTALL_URL = 'https://code.claude.com/docs/en/overview'

/** 句子裡要放一小段指令（`<code>`）的位置：訊息裡用 `{code}`，傳進來的是這個記號，畫的時候換成指令。 */
const CODE_MARK = '\u0001'
function Rich({ text, code }: { text: string; code: string }) {
  const [before = '', after = ''] = text.split(CODE_MARK)
  return (
    <>
      {before}
      <code className="rounded bg-surface-overlay px-1">{code}</code>
      {after}
    </>
  )
}

/**
 * 還不能開始對話時的說明卡（不是錯誤對話框）：哪一項沒準備好就說哪一項，附上能做的下一步。
 * 沒裝 Claude Code、版本太舊、沒登入——我們不代為安裝、不代為登入、不碰他的憑證。
 */
export function PrereqCard({
  prereq,
  onRecheck,
}: {
  prereq: Exclude<ChatPrereq, { state: 'ready' }>
  /** `fresh:false`：只有 AI 工具連線的開關變了，Claude Code 本身沒變，用已經查好的結果。 */
  onRecheck: (options?: { fresh?: boolean }) => void
}) {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const enableMcp = (): void => {
    setBusy(true)
    setError(undefined)
    call('settings.update', { mcp: { enabled: true } })
      .then(() => {
        onRecheck({ fresh: false })
      })
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
          <h3 className="font-semibold">{t('chat.claudeChatIsOff')}</h3>
          <p className="text-fg-muted">{t('chat.thisIsAnExperimentalFeature')}</p>
        </>
      ) : prereq.state === 'mcp_off' ? (
        <>
          <h3 className="font-semibold">{t('chat.turnOnAllowAiTools')}</h3>
          <p className="text-fg-muted">{t('chat.claudeEditsYourProjectThrough')}</p>
          <Button variant="primary" size="sm" disabled={busy} onClick={enableMcp}>
            {t('chat.turnOnAiTools')}
          </Button>
        </>
      ) : prereq.state === 'not_installed' ? (
        <>
          <h3 className="font-semibold">{t('chat.claudeCodeIsNeededOn')}</h3>
          <p className="text-fg-muted">{t('chat.claudeCodeIsAnthropicS')}</p>
          <p>
            <a
              href={INSTALL_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              {t('chat.howToInstallClaudeCode')}
            </a>
          </p>
        </>
      ) : prereq.state === 'too_old' ? (
        <>
          <h3 className="font-semibold">{t('chat.yourClaudeCodeIsToo2')}</h3>
          <p className="text-fg-muted">
            <Rich
              text={t('chat.tooOld', {
                version: prereq.version,
                minVersion: prereq.minVersion,
                code: CODE_MARK,
              })}
              code="claude update"
            />
          </p>
        </>
      ) : (
        <>
          <h3 className="font-semibold">{t('chat.signInToClaudeCode')}</h3>
          <p className="text-fg-muted">
            <Rich text={t('chat.signIn', { code: CODE_MARK })} code="claude" />
          </p>
        </>
      )}
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      {prereq.state === 'mcp_off' || prereq.state === 'disabled' ? null : (
        <Button
          size="sm"
          onClick={() => {
            onRecheck()
          }}
          data-testid="chat-recheck"
        >
          {prereq.state === 'not_logged_in' ? t('chat.iMSignedIn') : t('chat.recheck')}
        </Button>
      )}
    </div>
  )
}
