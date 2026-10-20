import { Plug } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/button'
import { SettingCard } from '../../../components/setting-card'
import { Switch } from '../../../components/switch'
import { appLight } from './connection-state'
import type { McpConnection } from './use-mcp'

/** 總開關：允許 AI 工具連線（預設關）。連線埠是進階設定，收在「更多」裡。 */
export function AccessCard({ mcp }: { mcp: McpConnection }) {
  const { status } = mcp
  // 開關先照使用者的操作反應，不用等主行程回應；失敗時還原
  const [pending, setPending] = useState<boolean | undefined>()
  const enabled = pending ?? status?.enabled ?? false
  const [port, setPort] = useState<string | undefined>()
  const portText = port ?? String(status?.port ?? '')
  const portNumber = Number(portText)
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535

  return (
    <SettingCard
      testId="mcp-section"
      className="md:col-span-2"
      icon={Plug}
      title="允許 AI 工具連線"
      status={{ ...appLight(status), testId: 'mcp-status' }}
      summary="預設是關的，關掉之後連線立刻中斷。只能從這台電腦連進來，AI 工具看不到你的服務金鑰；App 要開著才連得上。"
      action={
        <Switch
          data-testid="mcp-enabled"
          aria-label="允許 AI 工具連線"
          checked={enabled}
          disabled={status === undefined}
          onChange={(event) => {
            const next = event.target.checked
            setPending(next)
            void mcp.update({ enabled: next }).finally(() => {
              setPending(undefined)
            })
          }}
        />
      }
      body={
        status?.enabled && !status.running && status.error ? (
          <p role="alert" data-testid="mcp-error" className="text-sm text-danger">
            {status.error}
          </p>
        ) : mcp.error ? (
          <p role="alert" className="text-sm text-danger">
            {mcp.error}
          </p>
        ) : undefined
      }
      details={
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (portValid) void mcp.update({ port: portNumber })
          }}
        >
          <label className="block text-sm font-medium" htmlFor="mcp-port">
            連線埠
          </label>
          <p className="text-xs text-fg-muted">一般不用改；被別的程式佔住了才換一個。</p>
          <div className="mt-1 flex gap-2">
            <input
              id="mcp-port"
              data-testid="mcp-port"
              inputMode="numeric"
              value={portText}
              onChange={(event) => {
                setPort(event.target.value)
              }}
              className="h-9 w-32 rounded-md border border-border bg-surface px-3 text-sm"
            />
            <Button type="submit" variant="secondary" disabled={!portValid}>
              儲存
            </Button>
          </div>
          {portValid ? null : (
            <p className="mt-1 text-sm text-danger">請輸入 1024 到 65535 之間的整數。</p>
          )}
        </form>
      }
    />
  )
}
