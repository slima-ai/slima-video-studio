import type { McpConnectInfo, McpStatus, SlimaStatus } from '@svs/schema'

import type { StatusLightProps } from '../../../components/status-light'
import { t } from '@svs/schema'

export type Light = Pick<StatusLightProps, 'tone' | 'label'>

/** App 這一端：「允許 AI 工具連線」的開關與伺服器有沒有真的在聽。 */
export function appLight(status: McpStatus | undefined): Light {
  if (!status) return { tone: 'off', label: t('settings.checking') }
  if (!status.enabled) return { tone: 'off', label: t('settings.off') }
  if (!status.running) return { tone: 'error', label: t('settings.notRunning') }
  return { tone: 'ok', label: t('settings.open') }
}

/** Claude Desktop：設定檔裡有沒有指到這個 App。 */
export function desktopLight(info: McpConnectInfo | undefined): Light {
  if (!info) return { tone: 'off', label: t('settings.checking') }
  const { supported, connected, installed } = info.claudeDesktop
  if (!supported) return { tone: 'off', label: t('settings.notAvailableOnThisSystem') }
  if (connected) return { tone: 'ok', label: t('settings.setUp') }
  return installed
    ? { tone: 'warn', label: t('settings.notConnected') }
    : { tone: 'off', label: t('settings.notFound') }
}

/** Claude Code：使用者層級的設定裡有沒有指到這個 App。 */
export function codeLight(info: McpConnectInfo | undefined): Light {
  if (!info) return { tone: 'off', label: t('settings.checking') }
  const { connected, installed } = info.claudeCode
  if (connected) return { tone: 'ok', label: t('settings.setUp') }
  return installed
    ? { tone: 'warn', label: t('settings.notConnected') }
    : { tone: 'off', label: t('settings.notFound') }
}

/** Slima 帳號：有沒有填 Token、連得上嗎。 */
export function slimaLight(status: SlimaStatus | undefined): Light {
  if (!status) return { tone: 'off', label: t('settings.checking') }
  switch (status.state) {
    case 'no_token':
      return { tone: 'off', label: t('settings.notConnected2') }
    case 'connecting':
      return { tone: 'warn', label: t('settings.connecting2') }
    case 'ready':
      return {
        tone: 'ok',
        label: status.last4
          ? t('settings.connectedTokenEndingIn', { last4: status.last4 })
          : t('settings.connected'),
      }
    case 'error':
      return { tone: 'error', label: t('settings.canTConnect') }
  }
}

/** 額度：0＝AI 工具現在什麼都不能花；用完了也一樣。 */
export function allowanceLight(status: McpStatus | undefined): Light {
  if (!status) return { tone: 'off', label: t('settings.checking') }
  const left = Math.max(status.allowanceUsd - status.committedUsd, 0)
  if (status.allowanceUsd === 0) return { tone: 'warn', label: t('settings.canTSpendYet') }
  if (left === 0) return { tone: 'warn', label: t('settings.usedUp') }
  return { tone: 'ok', label: t('settings.usLeft', { value: left.toFixed(2) }) }
}

/** 示意圖上一條線是不是「通的」：兩端都好才算。 */
export const toolLinkActive = (app: Light, tool: Light): boolean =>
  app.tone === 'ok' && tool.tone === 'ok'
