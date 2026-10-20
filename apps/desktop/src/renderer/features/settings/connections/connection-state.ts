import type { McpConnectInfo, McpStatus, SlimaStatus } from '@svs/schema'

import type { StatusLightProps } from '../../../components/status-light'

export type Light = Pick<StatusLightProps, 'tone' | 'label'>

/** App 這一端：「允許 AI 工具連線」的開關與伺服器有沒有真的在聽。 */
export function appLight(status: McpStatus | undefined): Light {
  if (!status) return { tone: 'off', label: '檢查中…' }
  if (!status.enabled) return { tone: 'off', label: '已關閉' }
  if (!status.running) return { tone: 'error', label: '沒有啟動' }
  return { tone: 'ok', label: '開放中' }
}

/** Claude Desktop：設定檔裡有沒有指到這個 App。 */
export function desktopLight(info: McpConnectInfo | undefined): Light {
  if (!info) return { tone: 'off', label: '檢查中…' }
  const { supported, connected, installed } = info.claudeDesktop
  if (!supported) return { tone: 'off', label: '這個系統沒有' }
  if (connected) return { tone: 'ok', label: '已設定' }
  return installed ? { tone: 'warn', label: '還沒連接' } : { tone: 'off', label: '沒偵測到' }
}

/** Claude Code：使用者層級的設定裡有沒有指到這個 App。 */
export function codeLight(info: McpConnectInfo | undefined): Light {
  if (!info) return { tone: 'off', label: '檢查中…' }
  const { connected, installed } = info.claudeCode
  if (connected) return { tone: 'ok', label: '已設定' }
  return installed ? { tone: 'warn', label: '還沒連接' } : { tone: 'off', label: '沒偵測到' }
}

/** Slima 帳號：有沒有填 Token、連得上嗎。 */
export function slimaLight(status: SlimaStatus | undefined): Light {
  if (!status) return { tone: 'off', label: '檢查中…' }
  switch (status.state) {
    case 'no_token':
      return { tone: 'off', label: '尚未連線' }
    case 'connecting':
      return { tone: 'warn', label: '連線中' }
    case 'ready':
      return {
        tone: 'ok',
        label: `已連線${status.last4 ? `（Token 結尾 ${status.last4}）` : ''}`,
      }
    case 'error':
      return { tone: 'error', label: '連不上' }
  }
}

/** 額度：0＝AI 工具現在什麼都不能花；用完了也一樣。 */
export function allowanceLight(status: McpStatus | undefined): Light {
  if (!status) return { tone: 'off', label: '檢查中…' }
  const left = Math.max(status.allowanceUsd - status.committedUsd, 0)
  if (status.allowanceUsd === 0) return { tone: 'warn', label: '還不能花錢' }
  if (left === 0) return { tone: 'warn', label: '用完了' }
  return { tone: 'ok', label: `還能花 US$${left.toFixed(2)}` }
}

/** 示意圖上一條線是不是「通的」：兩端都好才算。 */
export const toolLinkActive = (app: Light, tool: Light): boolean =>
  app.tone === 'ok' && tool.tone === 'ok'
