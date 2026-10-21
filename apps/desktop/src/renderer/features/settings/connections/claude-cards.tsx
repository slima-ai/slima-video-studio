import { Monitor, Terminal } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/button'
import { SettingCard } from '../../../components/setting-card'
import { codeLight, desktopLight } from './connection-state'
import { claudeCodeCommand, type McpConnection } from './use-mcp'

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
      summary="用 Claude 桌面版，一鍵連上這個 App，直接叫它幫你拆分鏡、做影片；按「連接」會一併打開「允許 AI 工具連線」。"
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
              ? '連接中…'
              : info.claudeDesktop.connected
                ? '重新連接'
                : '連接'}
          </Button>
        ) : undefined
      }
      body={<Note mcp={mcp} kind="desktop" />}
      details={
        info ? (
          <div className="space-y-2 text-sm text-fg-muted">
            <p>
              按「連接」會自動打開「允許 AI 工具連線」，並把這個 App 加進 Claude Desktop
              的設定檔（只加我們這一項，改之前先備份）。不需要另外安裝任何東西；寫好之後要完全關掉
              Claude Desktop 再打開。
            </p>
            {info.claudeDesktop.supported && !info.claudeDesktop.installed ? (
              <p>這台電腦好像還沒裝 Claude Desktop。</p>
            ) : null}
            {info.claudeDesktop.configPath ? (
              <p className="break-all text-xs">設定檔：{info.claudeDesktop.configPath}</p>
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
      summary="用終端機裡的 Claude Code 連上這個 App；按一下就設定好（按「連接」會一併打開「允許 AI 工具連線」），不用自己打指令。"
      action={
        <Button
          data-testid="mcp-connect-code"
          variant="secondary"
          disabled={mcp.connecting !== undefined}
          onClick={() => {
            mcp.connect('code')
          }}
        >
          {mcp.connecting === 'code' ? '連接中…' : info?.claudeCode.connected ? '重新連接' : '連接'}
        </Button>
      }
      body={<Note mcp={mcp} kind="code" />}
      details={
        <div className="space-y-2 text-sm text-fg-muted">
          <p>
            連好之後，開一個新的 Claude Code，輸入 /mcp 就看得到 slima-video-studio。
            {info && !info.claudeCode.installed ? '這台電腦好像還沒裝 Claude Code。' : ''}
          </p>
          {status?.enabled && status.running && command ? (
            <div data-testid="mcp-connect">
              <p className="font-medium text-fg">手動連線：在 Claude Code 貼上這一行</p>
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
                  {reveal ? '隱藏 token' : '顯示 token'}
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
                  複製指令
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCopied(false)
                    mcp.regenerateToken()
                  }}
                >
                  換一組新的 token
                </Button>
                {copied ? (
                  <span role="status" className="self-center text-success">
                    已複製。
                  </span>
                ) : null}
              </div>
              <p className="mt-1">token 只在這台電腦上有效；換一組之後，舊的指令立刻失效。</p>
            </div>
          ) : null}
        </div>
      }
    />
  )
}
