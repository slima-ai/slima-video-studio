import { DEFAULT_MCP_PORT, type McpConnectInfo, type McpStatus } from '@svs/schema'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { Section } from '../../components/section'
import { call, errorText } from '../../lib/svs'

/** 給 Claude Code 貼的連線指令（token 要整串帶進去，所以預設只顯示遮蔽版，按鈕複製的是完整版）。 */
export function claudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http slima-video-studio ${url} --header "Authorization: Bearer ${token}"`
}

const usd = (value: number): string => `US$${value.toFixed(2)}`

/** AI 工具連線（MCP）：開關、連線指令、AI 工具可以花的額度。預設全關、額度 0。 */
export function McpSection({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<McpStatus | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [reveal, setReveal] = useState(false)
  const [copied, setCopied] = useState(false)
  const [port, setPort] = useState(String(DEFAULT_MCP_PORT))
  const [allowance, setAllowance] = useState('0')
  // 勾選框先照使用者的操作反應，不用等主行程回應；失敗時還原
  const [enabled, setEnabled] = useState(false)
  const [info, setInfo] = useState<McpConnectInfo | undefined>()
  const [connecting, setConnecting] = useState<'desktop' | 'code' | undefined>()
  const [connectNote, setConnectNote] = useState<{ ok: boolean; text: string } | undefined>()
  const [codeFallback, setCodeFallback] = useState<string | undefined>()

  const apply = useCallback((next: McpStatus) => {
    setStatus(next)
    setEnabled(next.enabled)
    setPort(String(next.port))
    setAllowance(String(next.allowanceUsd))
  }, [])

  useEffect(() => {
    call('mcp.status', {})
      .then(apply)
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }, [apply])

  const loadInfo = useCallback(() => {
    call('mcp.connectInfo', {})
      .then(setInfo)
      .catch(() => {
        // 拿不到連接資訊就不顯示一鍵按鈕，手動連線還是可以用
      })
  }, [])
  useEffect(loadInfo, [loadInfo])

  /** 一鍵連接：還沒開「允許 AI 工具連線」就先替使用者打開（他按了連接就是要用）。 */
  const connect = (kind: 'desktop' | 'code'): void => {
    setError(undefined)
    setConnectNote(undefined)
    setCodeFallback(undefined)
    setConnecting(kind)
    const task = async (): Promise<void> => {
      if (!status?.enabled) {
        await call('settings.update', { mcp: { enabled: true } })
        apply(await call('mcp.status', {}))
        onChanged()
      }
      if (kind === 'desktop') {
        const result = await call('mcp.connectClaudeDesktop', {})
        setConnectNote({
          ok: true,
          text: `已寫進 Claude Desktop 的設定檔。請完全關掉 Claude Desktop 再重新打開（Mac：⌘Q）。${
            result.backupPath ? '原本的設定檔已備份在同一個資料夾。' : ''
          }`,
        })
      } else {
        await call('mcp.connectClaudeCode', {})
        setConnectNote({
          ok: true,
          text: '已連接 Claude Code。開一個新的 Claude Code，輸入 /mcp 就看得到 slima-video-studio。',
        })
      }
      loadInfo()
    }
    task()
      .catch((e: unknown) => {
        setConnectNote({ ok: false, text: errorText(e) })
        if (kind === 'code' && info) setCodeFallback(info.claudeCodeCommand)
      })
      .finally(() => {
        setConnecting(undefined)
      })
  }

  const run = (task: () => Promise<McpStatus>): void => {
    setError(undefined)
    setCopied(false)
    task()
      .then((next) => {
        apply(next)
        onChanged()
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }
  const update = (mcp: { enabled?: boolean; port?: number; allowanceUsd?: number }): void => {
    run(async () => {
      try {
        await call('settings.update', { mcp })
        return await call('mcp.status', {})
      } catch (e) {
        if (status) setEnabled(status.enabled)
        throw e
      }
    })
  }

  const portNumber = Number(port)
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535
  const allowanceNumber = Number(allowance)
  const allowanceValid = Number.isFinite(allowanceNumber) && allowanceNumber >= 0
  const command = status?.url && status.token ? claudeCodeCommand(status.url, status.token) : ''
  const masked = command.replace(status?.token ?? '', '••••••••')

  return (
    <Section
      testId="mcp-section"
      title="AI 工具連線（MCP）"
      description="讓 Claude Code 這類 AI 工具連到這個 App，幫你建專案、拆分鏡、做影片。只在這台電腦上連線，要帶連線 token；AI 工具看不到你的服務金鑰，花錢也受下面的額度限制。App 要開著才連得上。"
    >
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          data-testid="mcp-enabled"
          checked={enabled}
          disabled={status === undefined}
          onChange={(event) => {
            setEnabled(event.target.checked)
            update({ enabled: event.target.checked })
          }}
          className="mt-1 size-4"
        />
        <span>
          <span className="block text-sm font-medium">允許 AI 工具連線</span>
          <span className="block text-sm text-fg-muted">預設是關的。關掉之後連線立刻中斷。</span>
        </span>
      </label>

      <div className="mt-4" data-testid="mcp-oneclick">
        <p className="text-sm font-medium">一鍵連接</p>
        <p className="text-sm text-fg-muted">
          按下去會自動打開上面的「允許 AI 工具連線」，並把這個 App 加進 Claude
          的設定。不需要另外安裝任何東西；之後換 token 也不用重連。App 要開著才連得上。
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {info?.claudeDesktop.supported ? (
            <Button
              data-testid="mcp-connect-desktop"
              variant="secondary"
              disabled={connecting !== undefined}
              onClick={() => {
                connect('desktop')
              }}
            >
              {info.claudeDesktop.connected ? '重新連接 Claude Desktop' : '連接 Claude Desktop'}
            </Button>
          ) : null}
          <Button
            data-testid="mcp-connect-code"
            variant="secondary"
            disabled={connecting !== undefined}
            onClick={() => {
              connect('code')
            }}
          >
            連接 Claude Code
          </Button>
        </div>
        {info?.claudeDesktop.supported && !info.claudeDesktop.installed ? (
          <p className="mt-1 text-sm text-fg-muted">這台電腦好像還沒裝 Claude Desktop。</p>
        ) : null}
        {info?.claudeDesktop.connected && !connectNote ? (
          <p className="mt-1 text-sm text-success">Claude Desktop 已經連接。</p>
        ) : null}
        {connectNote ? (
          <p
            role={connectNote.ok ? 'status' : 'alert'}
            data-testid="mcp-connect-note"
            className={`mt-2 text-sm ${connectNote.ok ? 'text-success' : 'text-danger'}`}
          >
            {connectNote.text}
          </p>
        ) : null}
        {codeFallback ? (
          <pre
            data-testid="mcp-code-fallback"
            className="mt-1 overflow-x-auto rounded-md border border-border bg-surface p-3 text-xs"
          >
            {codeFallback}
          </pre>
        ) : null}
      </div>

      {status?.enabled && status.running && command ? (
        <div className="mt-4" data-testid="mcp-connect">
          <p className="text-sm font-medium">手動連線：在 Claude Code 貼上這一行</p>
          <pre
            data-testid="mcp-command"
            className="mt-1 overflow-x-auto rounded-md border border-border bg-surface p-3 text-xs"
          >
            {reveal ? command : masked}
          </pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setReveal((v) => !v)
              }}
            >
              {reveal ? '隱藏 token' : '顯示 token'}
            </Button>
            <Button
              variant="secondary"
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
              onClick={() => {
                run(() => call('mcp.regenerateToken', {}))
              }}
            >
              換一組新的 token
            </Button>
            {copied ? (
              <span role="status" className="self-center text-sm text-success">
                已複製。
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            token 只在這台電腦上有效；換一組之後，舊的指令立刻失效。
          </p>
        </div>
      ) : null}

      {status?.enabled && !status.running && status.error ? (
        <p role="alert" data-testid="mcp-error" className="mt-3 text-sm text-danger">
          {status.error}
        </p>
      ) : null}

      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (portValid) update({ port: portNumber })
        }}
      >
        <label className="block text-sm font-medium" htmlFor="mcp-port">
          連線埠
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="mcp-port"
            data-testid="mcp-port"
            inputMode="numeric"
            value={port}
            onChange={(event) => {
              setPort(event.target.value)
            }}
            className="w-32 rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
          <Button type="submit" variant="secondary" disabled={!portValid}>
            儲存
          </Button>
        </div>
        {portValid ? null : (
          <p className="mt-1 text-sm text-danger">請輸入 1024 到 65535 之間的整數。</p>
        )}
      </form>

      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (allowanceValid) update({ allowanceUsd: allowanceNumber })
        }}
      >
        <label className="block text-sm font-medium" htmlFor="mcp-allowance">
          AI 工具可以花多少（美金）
        </label>
        <p className="text-sm text-fg-muted">
          只有你能改這個數字；AI
          工具改不了。要花錢的步驟（文字、圖片、影片）會先用預估金額預留，超過就拒絕。預設
          0：示範模式不花錢，真實模式下 AI 工具什麼錢都不能花。
        </p>
        <div className="mt-1 flex gap-2">
          <input
            id="mcp-allowance"
            data-testid="mcp-allowance"
            inputMode="decimal"
            value={allowance}
            onChange={(event) => {
              setAllowance(event.target.value)
            }}
            className="w-32 rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
          <Button type="submit" variant="secondary" disabled={!allowanceValid}>
            儲存
          </Button>
        </div>
        {allowanceValid ? null : (
          <p className="mt-1 text-sm text-danger">請輸入 0 或更大的數字。</p>
        )}
        {status ? (
          <p data-testid="mcp-committed" className="mt-2 text-sm text-fg-muted">
            已預留 {usd(status.committedUsd)}，還能花{' '}
            {usd(Math.max(status.allowanceUsd - status.committedUsd, 0))}
            （預留的金額不會因為實際花得比較少而退回）。
            <Button
              className="ml-2"
              variant="secondary"
              disabled={status.committedUsd === 0}
              onClick={() => {
                run(() => call('mcp.resetCommitted', {}))
              }}
            >
              重新計算
            </Button>
          </p>
        ) : null}
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Section>
  )
}
