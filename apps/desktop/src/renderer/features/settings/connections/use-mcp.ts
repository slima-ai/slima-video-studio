import { type McpConnectInfo, type McpStatus, t } from '@svs/schema'
import { useCallback, useEffect, useState } from 'react'

import { call, errorText } from '../../../lib/svs'

/** 給 Claude Code 貼的連線指令（token 要整串帶進去，所以預設只顯示遮蔽版，按鈕複製的是完整版）。 */
export function claudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http slima-video-studio ${url} --header "Authorization: Bearer ${token}"`
}

export type ConnectKind = 'desktop' | 'code'
export interface ConnectNote {
  kind: ConnectKind
  ok: boolean
  text: string
}

/** 狀態每幾秒重讀一次：連線區的燈要反映「剛剛有 AI 工具連進來」。 */
const POLL_MS = 5000

export interface McpConnection {
  status: McpStatus | undefined
  info: McpConnectInfo | undefined
  error: string | undefined
  /** 一鍵連接進行中的是哪一個。 */
  connecting: ConnectKind | undefined
  note: ConnectNote | undefined
  /** 一鍵連接 Claude Code 失敗時，改給使用者貼的指令。 */
  codeFallback: string | undefined
  connect: (kind: ConnectKind) => void
  /** 改 mcp 設定（開關、埠、額度）；失敗時錯誤放在 `error`，開關由呼叫端還原。 */
  update: (mcp: { enabled?: boolean; port?: number; allowanceUsd?: number }) => Promise<boolean>
  regenerateToken: () => void
  resetCommitted: () => void
}

/** 連線區共用的 MCP 狀態與動作：三張連線卡、額度卡、示意圖都讀這一份。 */
export function useMcpConnection(onChanged: () => void): McpConnection {
  const [status, setStatus] = useState<McpStatus | undefined>()
  const [info, setInfo] = useState<McpConnectInfo | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [connecting, setConnecting] = useState<ConnectKind | undefined>()
  const [note, setNote] = useState<ConnectNote | undefined>()
  const [codeFallback, setCodeFallback] = useState<string | undefined>()

  const refresh = useCallback((): Promise<McpStatus | undefined> => {
    return call('mcp.status', {})
      .then((next) => {
        setStatus(next)
        return next
      })
      .catch((e: unknown) => {
        setError(errorText(e))
        return undefined
      })
  }, [])

  const loadInfo = useCallback(() => {
    call('mcp.connectInfo', {})
      .then(setInfo)
      .catch(() => {
        // 拿不到連接資訊就不顯示一鍵按鈕與「已連接」的燈，手動連線還是可以用
      })
  }, [])

  useEffect(() => {
    void refresh()
    loadInfo()
    const timer = setInterval(() => {
      void refresh()
    }, POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [refresh, loadInfo])

  const connect = (kind: ConnectKind): void => {
    setError(undefined)
    setNote(undefined)
    setCodeFallback(undefined)
    setConnecting(kind)
    const task = async (): Promise<void> => {
      // 還沒開「允許 AI 工具連線」就先替使用者打開（他按了連接就是要用）
      if (!status?.enabled) {
        await call('settings.update', { mcp: { enabled: true } })
        await refresh()
        onChanged()
      }
      if (kind === 'desktop') {
        const result = await call('mcp.connectClaudeDesktop', {})
        setNote({
          kind,
          ok: true,
          text: t('settings.writtenToClaudeDesktopS', {
            value: result.backupPath ? t('settings.theOriginalConfigFileWas') : '',
          }),
        })
      } else {
        await call('mcp.connectClaudeCode', {})
        setNote({
          kind,
          ok: true,
          text: t('settings.connectedToClaudeCodeOpen'),
        })
      }
      loadInfo()
    }
    task()
      .catch((e: unknown) => {
        setNote({ kind, ok: false, text: errorText(e) })
        if (kind === 'code' && info) setCodeFallback(info.claudeCodeCommand)
      })
      .finally(() => {
        setConnecting(undefined)
      })
  }

  const run = (task: () => Promise<McpStatus>): void => {
    setError(undefined)
    task()
      .then((next) => {
        setStatus(next)
        onChanged()
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }

  return {
    status,
    info,
    error,
    connecting,
    note,
    codeFallback,
    connect,
    update: async (mcp) => {
      setError(undefined)
      try {
        await call('settings.update', { mcp })
        setStatus(await call('mcp.status', {}))
        onChanged()
        return true
      } catch (e) {
        setError(errorText(e))
        return false
      }
    },
    regenerateToken: () => {
      run(() => call('mcp.regenerateToken', {}))
    },
    resetCommitted: () => {
      run(() => call('mcp.resetCommitted', {}))
    },
  }
}
