import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS, appError, installFakeSvs } from '../../test/fake-svs'
import { GeneralSection } from './general-section'

afterEach(cleanup)

describe('GeneralSection', () => {
  it('打開示範模式', async () => {
    const svs = installFakeSvs()
    const onChanged = vi.fn()
    render(<GeneralSection settings={SETTINGS} onChanged={onChanged} />)
    fireEvent.click(screen.getByTestId('demo-mode'))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ demoMode: true }])
  })

  it('外觀有三個選項，預設跟隨系統；選淺色就送出並馬上反應', async () => {
    const svs = installFakeSvs()
    const onChanged = vi.fn()
    render(<GeneralSection settings={SETTINGS} onChanged={onChanged} />)
    expect(screen.getByTestId<HTMLInputElement>('theme-system').checked).toBe(true)
    expect(screen.getByLabelText('淺色')).toBeTruthy()
    expect(screen.getByLabelText('深色')).toBeTruthy()
    fireEvent.click(screen.getByTestId('theme-light'))
    expect(screen.getByTestId<HTMLInputElement>('theme-light').checked).toBe(true)
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ theme: 'light' }])
  })

  it('外觀存檔失敗 → 換回原本的選項並顯示原因', async () => {
    installFakeSvs({
      'settings.update': () => {
        throw appError('寫不進設定檔')
      },
    })
    render(<GeneralSection settings={SETTINGS} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByTestId('theme-dark'))
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('theme-system').checked).toBe(true)
    })
    expect(screen.getByRole('alert').textContent).toContain('寫不進設定檔')
  })

  it('勾選框馬上反應，不用等主行程回應', () => {
    installFakeSvs({ 'settings.update': () => new Promise(() => undefined) })
    render(<GeneralSection settings={SETTINGS} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByTestId('demo-mode'))
    expect(screen.getByTestId<HTMLInputElement>('demo-mode').checked).toBe(true)
  })

  it('儲存花費上限（保留專案總上限）', async () => {
    const svs = installFakeSvs()
    render(
      <GeneralSection
        settings={{ ...SETTINGS, budget: { perRunLimitUsd: 5, projectLimitUsd: 40 } }}
        onChanged={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('per-run-limit'), { target: { value: '12.5' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('已儲存。')
    })
    expect(svs.payloadsOf('settings.update')).toEqual([
      { budget: { perRunLimitUsd: 12.5, projectLimitUsd: 40 } },
    ])
  })

  it('不是正數 → 不能儲存並提示', () => {
    const svs = installFakeSvs()
    render(<GeneralSection settings={SETTINGS} onChanged={vi.fn()} />)
    for (const bad of ['0', '-3', 'abc', '']) {
      fireEvent.change(screen.getByTestId('per-run-limit'), { target: { value: bad } })
      expect(screen.getByRole('button', { name: '儲存' }).hasAttribute('disabled')).toBe(true)
      expect(screen.getByText('請輸入大於 0 的數字。')).toBeTruthy()
    }
    expect(svs.payloadsOf('settings.update')).toEqual([])
  })

  it('儲存失敗時顯示訊息', async () => {
    installFakeSvs({
      'settings.update': () => {
        throw appError('單次花費上限要大於 0。')
      },
    })
    render(<GeneralSection settings={SETTINGS} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByTestId('demo-mode'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('單次花費上限要大於 0。')
    })
    // 失敗時勾選框還原
    expect(screen.getByTestId<HTMLInputElement>('demo-mode').checked).toBe(false)
  })
})
