import type { McpConnectInfo, McpStatus, SlimaStatus } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS, appError, installFakeSvs } from '../../../test/fake-svs'
import { ConnectionsArea } from '.'
import { allowanceLight, appLight, codeLight, desktopLight, slimaLight } from './connection-state'
import { claudeCodeCommand } from './use-mcp'

afterEach(cleanup)

const OFF: McpStatus = {
  enabled: false,
  running: false,
  port: 47821,
  allowanceUsd: 0,
  committedUsd: 0,
}
const TOKEN = 'svs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const ON: McpStatus = {
  ...OFF,
  enabled: true,
  running: true,
  url: 'http://127.0.0.1:47821/mcp',
  token: TOKEN,
  allowanceUsd: 2,
  committedUsd: 0.5,
}
const INFO: McpConnectInfo = {
  claudeDesktop: {
    supported: true,
    configPath: '/x/claude_desktop_config.json',
    installed: true,
    connected: false,
  },
  claudeCode: { installed: true, connected: false },
  desktopSnippet: '{}',
  claudeCodeCommand: "claude mcp add --scope user slima-video-studio -- '/app'",
}
const READY: SlimaStatus = { state: 'ready', toolCount: 9, last4: 'abcd' }

const area = (storageAvailable = true) =>
  render(<ConnectionsArea onChanged={vi.fn()} storageAvailable={storageAvailable} />)

/** 把一張卡的「更多」展開。 */
const openMore = (testId: string): void => {
  fireEvent.click(within(screen.getByTestId(testId)).getByTestId('setting-card-more'))
}

describe('狀態燈怎麼判斷', () => {
  it('App 端：沒開＝已關閉、開了沒在聽＝沒有啟動、在聽＝開放中', () => {
    expect(appLight(undefined).tone).toBe('off')
    expect(appLight(OFF)).toEqual({ tone: 'off', label: '已關閉' })
    expect(appLight({ ...OFF, enabled: true })).toEqual({ tone: 'error', label: '沒有啟動' })
    expect(appLight(ON)).toEqual({ tone: 'ok', label: '開放中' })
  })

  it('Claude Desktop／Claude Code：有設定＝已設定；裝了沒設定＝還沒連接；沒裝＝沒偵測到', () => {
    expect(desktopLight(INFO).label).toBe('還沒連接')
    expect(
      desktopLight({ ...INFO, claudeDesktop: { ...INFO.claudeDesktop, connected: true } }),
    ).toEqual({
      tone: 'ok',
      label: '已設定',
    })
    expect(
      desktopLight({
        ...INFO,
        claudeDesktop: { supported: false, installed: false, connected: false },
      }).label,
    ).toBe('這個系統沒有')
    expect(codeLight(INFO).label).toBe('還沒連接')
    expect(codeLight({ ...INFO, claudeCode: { installed: false, connected: false } }).label).toBe(
      '沒偵測到',
    )
    expect(codeLight({ ...INFO, claudeCode: { installed: true, connected: true } }).tone).toBe('ok')
  })

  it('Slima：四種狀態各有燈；連不上只寫「連不上」（原因放在卡片裡）', () => {
    expect(slimaLight({ state: 'no_token' }).label).toBe('尚未連線')
    expect(slimaLight({ state: 'connecting' }).tone).toBe('warn')
    expect(slimaLight(READY).label).toBe('已連線（Token 結尾 abcd）')
    expect(slimaLight({ state: 'error', message: '很長的原因' })).toEqual({
      tone: 'error',
      label: '連不上',
    })
  })

  it('額度：0 或用完都是「不能花」，有剩才是綠燈', () => {
    expect(allowanceLight(OFF).label).toBe('還不能花錢')
    expect(allowanceLight({ ...ON, allowanceUsd: 2, committedUsd: 2 }).label).toBe('用完了')
    expect(allowanceLight(ON)).toEqual({ tone: 'ok', label: '還能花 US$1.50' })
  })
})

describe('連線示意圖', () => {
  it('預設：四個節點都在，App 與 AI 工具的燈都是灰的，線是虛線', async () => {
    installFakeSvs({ 'mcp.status': () => OFF, 'mcp.connectInfo': () => INFO })
    area()
    const diagram = await screen.findByTestId('connection-diagram')
    await waitFor(() => {
      expect(within(diagram).getByTestId('diagram-app-status').textContent).toBe('已關閉')
    })
    expect(within(diagram).getByTestId('diagram-desktop-status').textContent).toBe('還沒連接')
    expect(within(diagram).getByTestId('diagram-code-status').textContent).toBe('還沒連接')
    expect(within(diagram).getByTestId('diagram-slima-status').textContent).toBe('尚未連線')
    expect(diagram.querySelectorAll('[data-active="true"]')).toHaveLength(0)
    expect(diagram.textContent).toContain('要先打開「允許 AI 工具連線」')
  })

  it('App 開著、Claude Code 已設定：那一條線通了；最近有人連進來會說多久以前', async () => {
    installFakeSvs({
      'mcp.status': () => ({
        ...ON,
        lastSeen: { at: new Date().toISOString(), client: 'claude-code' },
      }),
      'mcp.connectInfo': () => ({ ...INFO, claudeCode: { installed: true, connected: true } }),
      'slima.status': () => READY,
    })
    area()
    const diagram = await screen.findByTestId('connection-diagram')
    await waitFor(() => {
      expect(within(diagram).getByTestId('diagram-code-status').textContent).toBe('已設定')
    })
    // Claude Code 一條、Slima 一條；窄視窗用的合併線（Desktop 沒連，但 Code 通了）也是通的
    await waitFor(() => {
      expect(diagram.querySelectorAll('[data-active="true"]').length).toBeGreaterThanOrEqual(2)
    })
    expect(diagram.textContent).toContain('最近有 AI 工具連進來：剛剛')
  })

  it('每 5 秒重讀一次狀態：之後才有 AI 工具連進來，燈旁的字會跟著變', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let status: McpStatus = ON
      installFakeSvs({ 'mcp.status': () => status, 'mcp.connectInfo': () => INFO })
      area()
      await screen.findByTestId('connection-diagram')
      await waitFor(() => {
        expect(screen.getByTestId('diagram-app').textContent).toContain('還沒有 AI 工具連進來')
      })
      status = { ...ON, lastSeen: { at: new Date().toISOString() } }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100)
      })
      await waitFor(() => {
        expect(screen.getByTestId('diagram-app').textContent).toContain('最近有 AI 工具連進來')
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('允許 AI 工具連線（總開關）', () => {
  it('預設是關的、額度 0；關著的時候不顯示連線指令與 token', async () => {
    installFakeSvs({ 'mcp.status': () => OFF })
    area()
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('mcp-enabled').disabled).toBe(false)
    })
    expect(screen.getByTestId<HTMLInputElement>('mcp-enabled').checked).toBe(false)
    expect(screen.getByTestId<HTMLInputElement>('mcp-allowance').value).toBe('0')
    expect(screen.queryByTestId('mcp-connect')).toBeNull()
    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it('打開：送出 settings.update 的 mcp.enabled；Claude Code 卡的「更多」裡出現連線指令（token 預設被遮蔽）', async () => {
    let status = OFF
    const svs = installFakeSvs({
      'mcp.status': () => status,
      'settings.update': () => {
        status = ON
        return SETTINGS
      },
    })
    const onChanged = vi.fn()
    render(<ConnectionsArea onChanged={onChanged} storageAvailable />)
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('mcp-enabled').disabled).toBe(false)
    })
    fireEvent.click(screen.getByTestId('mcp-enabled'))
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('mcp-enabled').checked).toBe(true)
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ mcp: { enabled: true } }])
    expect(onChanged).toHaveBeenCalled()
    openMore('connect-code')
    const shown = screen.getByTestId('mcp-command').textContent
    expect(shown).toContain(
      'claude mcp add --transport http slima-video-studio http://127.0.0.1:47821/mcp',
    )
    expect(shown).not.toContain(TOKEN)
    fireEvent.click(screen.getByRole('button', { name: '顯示 token' }))
    expect(screen.getByTestId('mcp-command').textContent).toContain(TOKEN)
  })

  it('改設定失敗：開關還原，並顯示原因', async () => {
    installFakeSvs({
      'mcp.status': () => OFF,
      'settings.update': () => {
        throw appError('存不起來')
      },
    })
    area()
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('mcp-enabled').disabled).toBe(false)
    })
    fireEvent.click(screen.getByTestId('mcp-enabled'))
    expect((await screen.findByRole('alert')).textContent).toContain('存不起來')
    expect(screen.getByTestId<HTMLInputElement>('mcp-enabled').checked).toBe(false)
  })

  it('埠被佔用時顯示原因；埠不合法不能儲存', async () => {
    installFakeSvs({
      'mcp.status': () => ({
        ...OFF,
        enabled: true,
        error: '埠 47821 已經被別的程式用了，請換一個埠。',
      }),
    })
    area()
    await waitFor(() => {
      expect(screen.getByTestId('mcp-error').textContent).toContain('已經被別的程式用了')
    })
    expect(screen.getByTestId('mcp-status').textContent).toBe('沒有啟動')
    openMore('mcp-section')
    fireEvent.change(screen.getByTestId('mcp-port'), { target: { value: '80' } })
    expect(screen.getByText('請輸入 1024 到 65535 之間的整數。')).toBeTruthy()
  })
})

describe('Claude Code 卡', () => {
  it('複製指令：複製的是完整的（含 token）', async () => {
    installFakeSvs({ 'mcp.status': () => ON, 'mcp.connectInfo': () => INFO })
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    area()
    await screen.findByTestId('connect-code')
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('mcp-enabled').checked).toBe(true)
    })
    openMore('connect-code')
    fireEvent.click(screen.getByRole('button', { name: '複製指令' }))
    await waitFor(() => {
      expect(screen.getByText('已複製。')).toBeTruthy()
    })
    expect(writeText).toHaveBeenCalledWith(claudeCodeCommand(ON.url ?? '', TOKEN))
  })

  it('連不上時顯示白話原因，並給可貼的指令', async () => {
    installFakeSvs({
      'mcp.status': () => ON,
      'mcp.connectInfo': () => INFO,
      'mcp.connectClaudeCode': () => {
        throw appError('沒辦法自己執行 claude 指令。請把下面的指令貼到終端機。')
      },
    })
    area()
    await waitFor(() => {
      expect(screen.getByTestId('diagram-code-status').textContent).toBe('還沒連接')
    })
    fireEvent.click(screen.getByTestId('mcp-connect-code'))
    await waitFor(() => {
      expect(screen.getByTestId('mcp-connect-note').textContent).toContain('貼到終端機')
    })
    expect(screen.getByTestId('mcp-code-fallback').textContent).toBe(INFO.claudeCodeCommand)
  })
})

describe('Claude Desktop 卡', () => {
  it('還沒開允許連線時，按「連接」會先替使用者打開，再寫設定；成功說明要重開 Claude Desktop', async () => {
    let status = OFF
    const svs = installFakeSvs({
      'mcp.status': () => status,
      'mcp.connectInfo': () => INFO,
      'settings.update': () => {
        status = ON
        return SETTINGS
      },
      'mcp.connectClaudeDesktop': () => ({
        configPath: INFO.claudeDesktop.configPath ?? '',
        backupPath: '/x/backup',
      }),
    })
    area()
    fireEvent.click(await screen.findByTestId('mcp-connect-desktop'))
    await waitFor(() => {
      expect(screen.getByTestId('mcp-connect-note').textContent).toContain('重新打開')
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ mcp: { enabled: true } }])
    expect(svs.payloadsOf('mcp.connectClaudeDesktop')).toHaveLength(1)
    expect(screen.getByTestId('mcp-connect-note').textContent).toContain('已備份')
    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it('沒有 Claude Desktop 的系統沒有那顆按鈕；已設定就顯示「重新連接」', async () => {
    installFakeSvs({
      'mcp.status': () => ON,
      'mcp.connectInfo': () => ({
        ...INFO,
        claudeDesktop: { supported: false, installed: false, connected: false },
      }),
    })
    area()
    await screen.findByTestId('mcp-connect-code')
    await waitFor(() => {
      expect(screen.getByTestId('connect-desktop-status').textContent).toBe('這個系統沒有')
    })
    expect(screen.queryByTestId('mcp-connect-desktop')).toBeNull()
    cleanup()
    installFakeSvs({
      'mcp.status': () => ON,
      'mcp.connectInfo': () => ({
        ...INFO,
        claudeDesktop: { ...INFO.claudeDesktop, connected: true },
      }),
    })
    area()
    await waitFor(() => {
      expect(screen.getByTestId('mcp-connect-desktop').textContent).toBe('重新連接')
    })
    expect(screen.getByTestId('connect-desktop-status').textContent).toBe('已設定')
  })
})

describe('AI 工具的總額度', () => {
  it('儲存的是人輸入的數字；顯示已預留與還能花；可以「已用的歸零」；不合法的不能儲存', async () => {
    const svs = installFakeSvs({
      'mcp.status': () => ON,
      'mcp.resetCommitted': () => ({ ...ON, committedUsd: 0 }),
    })
    area()
    await waitFor(() => {
      expect(screen.getByTestId('mcp-committed').textContent).toContain('已預留 US$0.50')
    })
    expect(screen.getByTestId('mcp-committed').textContent).toContain('還能花 US$1.50')
    expect(screen.getByTestId('mcp-allowance-status').textContent).toBe('還能花 US$1.50')
    fireEvent.change(screen.getByTestId('mcp-allowance'), { target: { value: '3.5' } })
    fireEvent.submit(screen.getByTestId('mcp-allowance'))
    await waitFor(() => {
      expect(svs.payloadsOf('settings.update')).toEqual([{ mcp: { allowanceUsd: 3.5 } }])
    })
    fireEvent.change(screen.getByTestId('mcp-allowance'), { target: { value: '-1' } })
    expect(screen.getByText('請輸入 0 或更大的數字。')).toBeTruthy()
    openMore('mcp-allowance-card')
    expect(screen.queryByRole('button', { name: '重新計算' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '已用的歸零' }))
    await waitFor(() => {
      expect(svs.payloadsOf('mcp.resetCommitted')).toHaveLength(1)
    })
  })

  it('用字：說清楚是累計、花服務金鑰帳戶的錢、也受單次花費上限管', async () => {
    installFakeSvs({ 'mcp.status': () => OFF })
    area()
    const card = await screen.findByTestId('mcp-allowance-card')
    expect(card.textContent).toContain('預設 US$0')
    expect(card.textContent).toContain('服務金鑰帳戶')
    openMore('mcp-allowance-card')
    expect(card.textContent).toContain('單次花費上限')
  })
})

describe('Slima 卡', () => {
  it('還沒連線：顯示「尚未連線」，沒有輸入前不能按連線，也沒有中斷按鈕', async () => {
    installFakeSvs()
    area()
    await waitFor(() => {
      expect(screen.getByTestId('slima-status').textContent).toBe('尚未連線')
    })
    expect(screen.getByTestId('slima-token').getAttribute('type')).toBe('password')
    expect(screen.getByTestId('slima-connect').hasAttribute('disabled')).toBe(true)
    openMore('slima-section')
    expect(screen.queryByTestId('slima-disconnect')).toBeNull()
  })

  it('貼上 Token 連線：送到主行程、清空輸入框；連上後列出書名與類型', async () => {
    const svs = installFakeSvs({
      'slima.connect': () => READY,
      'slima.books': () => ({
        books: [
          { token: 'bk_1', title: '雨夜的貓', kind: 'writing', author: '小林', words: 12345 },
          { token: 'bk_2', title: '鐵與花', kind: 'script', words: 3200 },
        ],
      }),
    })
    area()
    await screen.findByTestId('slima-status')
    fireEvent.change(screen.getByTestId('slima-token'), { target: { value: 'slima_token_123456' } })
    fireEvent.click(screen.getByTestId('slima-connect'))
    await waitFor(() => {
      expect(svs.payloadsOf('slima.connect')).toEqual([{ token: 'slima_token_123456' }])
    })
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('slima-token').value).toBe('')
    })
    act(() => {
      svs.emit('slima.status', READY)
    })
    expect(screen.getByTestId('slima-status').textContent).toBe('已連線（Token 結尾 abcd）')
    expect(screen.getByTestId('diagram-slima-status').textContent).toBe('已連線（Token 結尾 abcd）')
    const books = await screen.findAllByTestId('slima-book')
    expect(books.map((b) => b.textContent)).toEqual([
      '雨夜的貓小說・12,345 字',
      '鐵與花劇本・3,200 字',
    ])
  })

  it('Token 無效：燈寫「連不上」、原因在卡片裡；可以中斷連線', async () => {
    const svs = installFakeSvs({
      'slima.status': () => ({ state: 'error', message: 'Slima 不接受這組 Token' }),
      'slima.disconnect': () => ({ state: 'no_token' }),
    })
    area()
    await waitFor(() => {
      expect(screen.getByTestId('slima-status').textContent).toBe('連不上')
    })
    expect(screen.getByTestId('slima-message').textContent).toBe('Slima 不接受這組 Token')
    expect(screen.queryByTestId('slima-books')).toBeNull()

    openMore('slima-section')
    fireEvent.click(screen.getByTestId('slima-disconnect'))
    await waitFor(() => {
      expect(svs.payloadsOf('slima.disconnect')).toHaveLength(1)
    })
    act(() => {
      svs.emit('slima.status', { state: 'no_token' })
    })
    expect(screen.getByTestId('slima-status').textContent).toBe('尚未連線')
    expect(screen.queryByTestId('slima-disconnect')).toBeNull()
  })

  it('連線失敗（例如 Token 格式不對）顯示錯誤；金鑰庫不能用時整個輸入區停用', async () => {
    installFakeSvs({
      'slima.connect': () => {
        throw appError('API Key 格式不正確')
      },
    })
    area()
    await screen.findByTestId('slima-status')
    fireEvent.change(screen.getByTestId('slima-token'), { target: { value: 'bad token' } })
    fireEvent.click(screen.getByTestId('slima-connect'))
    expect((await screen.findByRole('alert')).textContent).toContain('格式不正確')
    cleanup()

    installFakeSvs()
    area(false)
    expect(screen.getByTestId('slima-token').hasAttribute('disabled')).toBe(true)
  })
})
