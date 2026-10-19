import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KEYS, appError, installFakeSvs } from '../../test/fake-svs'
import { KeysSection } from './keys-section'

afterEach(cleanup)

const STORAGE = { available: true, kind: 'os' } as const

function renderSection(
  keys = KEYS,
  storage: { available: boolean; kind: 'os' | 'memory'; reason?: string } = STORAGE,
) {
  const onChanged = vi.fn()
  render(<KeysSection keys={keys} storage={storage} onChanged={onChanged} />)
  return { onChanged }
}

describe('KeysSection', () => {
  it('列出每家服務與狀態；已設定的顯示結尾四碼', () => {
    installFakeSvs()
    renderSection([
      { provider: 'fal', configured: true, last4: 'abcd' },
      { provider: 'openrouter', configured: false },
    ])
    expect(screen.getByTestId('key-fal-status').textContent).toBe('已設定（結尾 abcd）')
    expect(screen.getByTestId('key-openrouter-status').textContent).toBe('尚未設定')
  })

  it('Key 輸入框是密碼欄位；沒輸入前不能儲存', () => {
    installFakeSvs()
    renderSection()
    const input = screen.getByLabelText('fal.ai 的服務金鑰')
    expect(input.getAttribute('type')).toBe('password')
    const save = within(screen.getByTestId('key-fal')).getByRole('button', { name: '儲存' })
    expect(save.hasAttribute('disabled')).toBe(true)
  })

  it('儲存 → 送到主行程、清空輸入框、通知上層重新載入', async () => {
    const svs = installFakeSvs()
    const { onChanged } = renderSection()
    const input = screen.getByLabelText<HTMLInputElement>('fal.ai 的服務金鑰')
    fireEvent.change(input, { target: { value: 'fal-SECRET-123456' } })
    fireEvent.click(within(screen.getByTestId('key-fal')).getByRole('button', { name: '儲存' }))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('keys.set')).toEqual([{ provider: 'fal', key: 'fal-SECRET-123456' }])
    expect(input.value).toBe('')
    expect(screen.getByTestId('key-fal-feedback').textContent).toBe('已儲存。')
  })

  it('Key 格式被拒絕 → 顯示整理過的訊息，輸入框保留內容方便修改', async () => {
    installFakeSvs({
      'keys.set': () => {
        throw appError('API Key 格式不正確')
      },
    })
    const { onChanged } = renderSection()
    const input = screen.getByLabelText<HTMLInputElement>('fal.ai 的服務金鑰')
    fireEvent.change(input, { target: { value: 'bad key' } })
    fireEvent.click(within(screen.getByTestId('key-fal')).getByRole('button', { name: '儲存' }))
    await waitFor(() => {
      expect(screen.getByTestId('key-fal-feedback').textContent).toBe('API Key 格式不正確')
    })
    expect(input.value).toBe('bad key')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('測試連線：有效 → 顯示剩餘額度', async () => {
    installFakeSvs({
      'keys.test': () => ({ provider: 'openrouter', valid: true, balanceUsd: 12.5 }),
    })
    renderSection([
      { provider: 'fal', configured: false },
      { provider: 'openrouter', configured: true, last4: '1234' },
    ])
    fireEvent.click(screen.getByRole('button', { name: '測試連線' }))
    await waitFor(() => {
      expect(screen.getByTestId('key-openrouter-feedback').textContent).toContain('US$12.50')
    })
  })

  it('測試連線：無效 → 請重新複製；連不上 → 顯示錯誤訊息', async () => {
    let valid = false
    installFakeSvs({
      'keys.test': () => {
        if (valid) throw appError('連不上 fal.ai，請檢查網路。')
        valid = true
        return { provider: 'fal', valid: false }
      },
    })
    renderSection([
      { provider: 'fal', configured: true, last4: 'abcd' },
      { provider: 'openrouter', configured: false },
    ])
    fireEvent.click(screen.getByRole('button', { name: '測試連線' }))
    await waitFor(() => {
      expect(screen.getByTestId('key-fal-feedback').textContent).toContain('無效')
    })
    fireEvent.click(screen.getByRole('button', { name: '測試連線' }))
    await waitFor(() => {
      expect(screen.getByTestId('key-fal-feedback').textContent).toContain('連不上')
    })
  })

  it('移除金鑰要先確認；按「不移除」就什麼都不做', () => {
    const svs = installFakeSvs()
    renderSection([
      { provider: 'fal', configured: true, last4: 'abcd' },
      { provider: 'openrouter', configured: false },
    ])
    fireEvent.click(screen.getByRole('button', { name: '移除金鑰' }))
    expect(screen.getByText(/確定嗎/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '不移除' }))
    expect(screen.getByRole('button', { name: '移除金鑰' })).toBeTruthy()
    expect(svs.payloadsOf('keys.delete')).toHaveLength(0)
  })

  it('確定移除 → 送到主行程並通知上層', async () => {
    const svs = installFakeSvs()
    const { onChanged } = renderSection([
      { provider: 'fal', configured: true, last4: 'abcd' },
      { provider: 'openrouter', configured: false },
    ])
    fireEvent.click(screen.getByRole('button', { name: '移除金鑰' }))
    fireEvent.click(screen.getByTestId('key-fal-remove-confirm'))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('keys.delete')).toEqual([{ provider: 'fal' }])
  })

  it('這台電腦無法加密保存時：顯示原因並停用輸入', () => {
    installFakeSvs()
    renderSection(KEYS, { available: false, kind: 'os', reason: '請先設定系統金鑰圈。' })
    expect(screen.getByRole('alert').textContent).toBe('請先設定系統金鑰圈。')
    expect(screen.getByLabelText('fal.ai 的服務金鑰').hasAttribute('disabled')).toBe(true)
  })

  it('取得 Key 的連結用新視窗開（主行程會改用系統瀏覽器）', () => {
    installFakeSvs()
    renderSection()
    const link = screen.getByRole('link', { name: '到 fal.ai 取得金鑰' })
    expect(link.getAttribute('href')).toBe('https://fal.ai/dashboard/keys')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })
})
