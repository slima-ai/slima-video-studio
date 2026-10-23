import { Monitor, Terminal } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/button'
import { SettingCard } from '../../../components/setting-card'
import { codeLight, desktopLight } from './connection-state'
import { claudeCodeCommand, type McpConnection } from './use-mcp'
import { t } from '@svs/schema'

function Note({ mcp, kind }: { mcp: McpConnection; kind: 'desktop' | 'code' }) {
  const { note } = mcp
  if (note?.kind !== kind) return null
  return (
    <div>
      <p
        role={note.ok ? 'status' : 'alert'}
        data-testid="mcp-connect-note"
        className={`text-sm ${note.ok ? 'text-success' : 'text-danger'}`}
      >
        {note.text}
      </p>
      {kind === 'code' && mcp.codeFallback ? (
        <pre
          data-testid="mcp-code-fallback"
          className="mt-2 overflow-x-auto rounded-md border border-border bg-surface p-3 text-xs"
        >
          {mcp.codeFallback}
        </pre>
      ) : null}
    </div>
  )
}

/** Claude Desktop：一鍵把這個 App 加進它的設定檔。 */
export function ClaudeDesktopCard({ mcp }: { mcp: McpConnection }) {
  const { info } = mcp
  return (
    <SettingCard
      testId="connect-desktop"
      icon={Monitor}
      title="Claude Desktop"
      status={{ ...desktopLight(info), testId: 'connect-desktop-status' }}
      summary={t('settings.connectClaudeDesktopInOne')}
      action={
        info?.claudeDesktop.supported ? (
          <Button
            data-testid="mcp-connect-desktop"
            variant="secondary"
            disabled={mcp.connecting !== undefined}
            onClick={() => {
              mcp.connect('desktop')
            }}
          >
            {mcp.connecting === 'desktop'
              ? t('settings.connecting')
              : info.claudeDesktop.connected
                ? t('settings.reconnect')
                : t('settings.connect')}
          </Button>
        ) : undefined
      }
      body={<Note mcp={mcp} kind="desktop" />}
      details={
        info ? (
          <div className="space-y-2 text-sm text-fg-muted">
            <p>{t('settings.connectTurnsOnAllowAi')}</p>
            {info.claudeDesktop.supported && !info.claudeDesktop.installed ? (
              <p>{t('settings.claudeDesktopDoesnTSeem')}</p>
            ) : null}
            {info.claudeDesktop.configPath ? (
              <p className="break-all text-xs">
                {t('settings.configFile', { configPath: info.claudeDesktop.configPath })}
              </p>
            ) : null}
          </div>
        ) : undefined
      }
    />
  )
}

/** Claude Code：一鍵連接；連不上時改貼指令。手動連線的指令（含 token）收在「更多」裡。 */
export function ClaudeCodeCard({ mcp }: { mcp: McpConnection }) {
  const { info, status } = mcp
  const [reveal, setReveal] = useState(false)
  const [copied, setCopied] = useState(false)
  const command = status?.url && status.token ? claudeCodeCommand(status.url, status.token) : ''
  const masked = command.replace(status?.token ?? '', '••••••••')
  return (
    <SettingCard
      testId="connect-code"
      icon={Terminal}
      title="Claude Code"
      status={{ ...codeLight(info), testId: 'connect-code-status' }}
      summary={t('settings.connectThisAppToClaude')}
      action={
        <Button
          data-testid="mcp-connect-code"
          variant="secondary"
          disabled={mcp.connecting !== undefined}
          onClick={() => {
            mcp.connect('code')
          }}
        >
          {mcp.connecting === 'code'
            ? t('settings.connecting')
            : info?.claudeCode.connected
              ? t('settings.reconnect')
              : t('settings.connect')}
        </Button>
      }
      body={<Note mcp={mcp} kind="code" />}
      details={
        <div className="space-y-2 text-sm text-fg-muted">
          <p>
            {t('settings.onceConnectedOpenANew', {
              value: info && !info.claudeCode.installed ? t('settings.claudeCodeDoesnTSeemTo') : '',
            })}
          </p>
          {status?.enabled && status.running && command ? (
            <div data-testid="mcp-connect">
              <p className="font-medium text-fg">{t('settings.manualSetupPasteThisLine')}</p>
              <pre
                data-testid="mcp-command"
                className="mt-1 overflow-x-auto rounded-md border border-border bg-surface p-3 text-xs"
              >
                {reveal ? command : masked}
              </pre>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setReveal((v) => !v)
                  }}
                >
                  {reveal ? t('settings.hideToken') : t('settings.showToken')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(command).then(() => {
                      setCopied(true)
                    })
                  }}
                >
                  {t('settings.copyCommand')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCopied(false)
                    mcp.regenerateToken()
                  }}
                >
                  {t('settings.makeANewToken')}
                </Button>
                {copied ? (
                  <span role="status" className="self-center text-success">
                    {t('settings.copied')}
                  </span>
                ) : null}
              </div>
              <p className="mt-1">{t('settings.theTokenOnlyWorksOn')}</p>
            </div>
          ) : null}
        </div>
      }
    />
  )
}
