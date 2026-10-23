import { Plug } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/button'
import { SettingCard } from '../../../components/setting-card'
import { Switch } from '../../../components/switch'
import { appLight } from './connection-state'
import type { McpConnection } from './use-mcp'
import { t } from '@svs/schema'

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
      title={t('settings.allowAiToolsToConnect')}
      status={{ ...appLight(status), testId: 'mcp-status' }}
      summary={t('settings.offByDefaultTurningIt')}
      action={
        <Switch
          data-testid="mcp-enabled"
          aria-label={t('settings.allowAiToolsToConnect')}
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
            {t('settings.port')}
          </label>
          <p className="text-xs text-fg-muted">{t('settings.youUsuallyDonTNeed')}</p>
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
              {t('settings.save')}
            </Button>
          </div>
          {portValid ? null : (
            <p className="mt-1 text-sm text-danger">{t('settings.enterAWholeNumberFrom')}</p>
          )}
        </form>
      }
    />
  )
}
