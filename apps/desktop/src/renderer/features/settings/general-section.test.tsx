import { DEFAULT_LOCALE, setLocale } from '@svs/schema'
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
      // 寫明存到哪一張、存了多少（不是只說「已儲存」）
      expect(screen.getByRole('status').textContent).toBe('單次花費上限已存為 US$12.5')
    })
    expect(svs.payloadsOf('settings.update')).toEqual([
      { budget: { perRunLimitUsd: 12.5, projectLimitUsd: 40 } },
    ])
  })

  it('單次花費上限那張卡：開頭一句講「每按一次生成最多花多少」，並指到另一張卡（頁籤＋卡名），旁邊有「前往」', () => {
    installFakeSvs()
    render(<GeneralSection settings={SETTINGS} onChanged={vi.fn()} />)
    const card = screen.getByTestId('per-run-limit').closest('[data-testid]')
    expect(document.body.textContent).toContain('每按一次生成，最多花多少')
    expect(screen.getByTestId('per-run-pointer').textContent).toBe(
      '想調「AI 工具一共能花多少」？那是另一張卡：設定 → AI 工具連線的「AI 工具的總額度」。 前往',
    )
    expect(card).toBeTruthy()
    // 「前往」捲到 AI 工具那一區
    const target = document.createElement('div')
    target.id = 'connections'
    const scrolled = vi.fn()
    target.scrollIntoView = scrolled
    document.body.append(target)
    fireEvent.click(screen.getByRole('button', { name: '前往' }))
    expect(scrolled).toHaveBeenCalledOnce()
    target.remove()
  })

  it('英文介面：存好的提示與指到另一張卡的那行都是英文，寫明頁籤與卡名', async () => {
    setLocale('en')
    try {
      installFakeSvs()
      render(<GeneralSection settings={SETTINGS} onChanged={vi.fn()} />)
      fireEvent.change(screen.getByTestId('per-run-limit'), { target: { value: '30' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => {
        expect(screen.getByRole('status').textContent).toBe('Per-run spending limit saved as US$30')
      })
      expect(screen.getByTestId('per-run-pointer').textContent).toBe(
        'Looking for how much AI tools can spend in total? That’s a different card: “Total allowance for AI tools” in Settings → AI tools. Go there',
      )
      expect(document.body.textContent).toContain('The most a single generation can cost')
    } finally {
      setLocale(DEFAULT_LOCALE)
    }
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
