import type { McpStatus } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS, installFakeSvs } from '../../test/fake-svs'
import { McpSection, claudeCodeCommand } from './mcp-section'

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

describe('McpSection', () => {
  it('預設是關的、額度 0；關著的時候不顯示連線指令與 token', async () => {
    installFakeSvs({ 'mcp.status': () => OFF })
    render(<McpSection onChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('mcp-enabled').disabled).toBe(false)
    })
    expect(screen.getByTestId<HTMLInputElement>('mcp-enabled').checked).toBe(false)
    expect(screen.getByTestId<HTMLInputElement>('mcp-allowance').value).toBe('0')
    expect(screen.queryByTestId('mcp-connect')).toBeNull()
    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it('打開：送出 settings.update 的 mcp.enabled，並顯示連線指令（token 預設被遮蔽）', async () => {
    let status = OFF
    const svs = installFakeSvs({
      'mcp.status': () => status,
      'settings.update': () => {
        status = ON
        return SETTINGS
      },
    })
    const onChanged = vi.fn()
    render(<McpSection onChanged={onChanged} />)
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('mcp-enabled').disabled).toBe(false)
    })
    fireEvent.click(screen.getByTestId('mcp-enabled'))
    await waitFor(() => {
      expect(screen.getByTestId('mcp-connect')).toBeTruthy()
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ mcp: { enabled: true } }])
    const shown = screen.getByTestId('mcp-command').textContent
    expect(shown).toContain(
      'claude mcp add --transport http slima-video-studio http://127.0.0.1:47821/mcp',
    )
    expect(shown).not.toContain(TOKEN)
    expect(onChanged).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '顯示 token' }))
    expect(screen.getByTestId('mcp-command').textContent).toContain(TOKEN)
  })

  it('複製指令：複製的是完整的（含 token）', async () => {
    installFakeSvs({ 'mcp.status': () => ON })
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<McpSection onChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('mcp-connect')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '複製指令' }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('已複製。')
    })
    expect(writeText).toHaveBeenCalledWith(claudeCodeCommand(ON.url ?? '', TOKEN))
  })

  it('額度：儲存的是人輸入的數字；顯示已預留與還能花；可以歸零；不合法的不能儲存', async () => {
    const svs = installFakeSvs({
      'mcp.status': () => ON,
      'mcp.resetCommitted': () => ({ ...ON, committedUsd: 0 }),
    })
    render(<McpSection onChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('mcp-committed').textContent).toContain('已預留 US$0.50')
    })
    expect(screen.getByTestId('mcp-committed').textContent).toContain('還能花 US$1.50')
    fireEvent.change(screen.getByTestId('mcp-allowance'), { target: { value: '3.5' } })
    fireEvent.submit(screen.getByTestId('mcp-allowance'))
    await waitFor(() => {
      expect(svs.payloadsOf('settings.update')).toEqual([{ mcp: { allowanceUsd: 3.5 } }])
    })
    fireEvent.change(screen.getByTestId('mcp-allowance'), { target: { value: '-1' } })
    expect(screen.getByText('請輸入 0 或更大的數字。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新計算' }))
    await waitFor(() => {
      expect(svs.payloadsOf('mcp.resetCommitted')).toHaveLength(1)
    })
  })

  it('埠被佔用時顯示原因；埠不合法不能儲存', async () => {
    installFakeSvs({
      'mcp.status': () => ({
        ...OFF,
        enabled: true,
        error: '埠 47821 已經被別的程式用了，請換一個埠。',
      }),
    })
    render(<McpSection onChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('mcp-error').textContent).toContain('已經被別的程式用了')
    })
    fireEvent.change(screen.getByTestId('mcp-port'), { target: { value: '80' } })
    expect(screen.getByText('請輸入 1024 到 65535 之間的整數。')).toBeTruthy()
  })
})
