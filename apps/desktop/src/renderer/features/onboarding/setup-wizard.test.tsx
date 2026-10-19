import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MODELS, SETTINGS, KEYS, appError, installFakeSvs } from '../../test/fake-svs'
import type { AppData } from '../settings/use-app-data'
import { SetupWizard } from './setup-wizard'

afterEach(cleanup)

const data = (keys = KEYS): AppData => ({
  keys,
  storage: { available: true, kind: 'os' },
  settings: { ...SETTINGS, onboardingDone: false },
  models: MODELS,
  selected: {},
  voices: {},
  locked: [],
  project: null,
})

describe('SetupWizard', () => {
  it('先試玩看看 → 開啟示範模式並完成引導', async () => {
    const svs = installFakeSvs()
    const onDone = vi.fn()
    render(<SetupWizard data={data()} reload={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByTestId('wizard-demo'))
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ onboardingDone: true, demoMode: true }])
  })

  it('我有 API Key → 進到填 Key 的步驟；沒有任何 Key 時不能按完成', () => {
    installFakeSvs()
    render(<SetupWizard data={data()} reload={vi.fn()} onDone={vi.fn()} />)
    fireEvent.click(screen.getByTestId('wizard-keys'))
    expect(screen.getByTestId('keys-section')).toBeTruthy()
    // 只引導 OpenRouter 一把；fal.ai 說明之後到設定再填
    expect(screen.queryByTestId('key-openrouter')).toBeTruthy()
    expect(screen.queryByTestId('key-fal')).toBeNull()
    expect(screen.getByTestId('wizard-more-keys').textContent).toContain('fal.ai')
    expect(screen.getByTestId('wizard-finish').hasAttribute('disabled')).toBe(true)
  })

  it('填好 Key 之後可以完成（不開示範模式）', async () => {
    const svs = installFakeSvs()
    const onDone = vi.fn()
    render(
      <SetupWizard
        data={data([
          { provider: 'fal', configured: true, last4: 'abcd' },
          { provider: 'openrouter', configured: false },
        ])}
        reload={vi.fn()}
        onDone={onDone}
      />,
    )
    fireEvent.click(screen.getByTestId('wizard-keys'))
    fireEvent.click(screen.getByTestId('wizard-finish'))
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ onboardingDone: true, demoMode: false }])
  })

  it('稍後再填 → 直接完成引導；返回 → 回到第一步', async () => {
    const svs = installFakeSvs()
    const onDone = vi.fn()
    render(<SetupWizard data={data()} reload={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByTestId('wizard-keys'))
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByTestId('wizard-demo')).toBeTruthy()
    fireEvent.click(screen.getByTestId('wizard-keys'))
    fireEvent.click(screen.getByTestId('wizard-skip'))
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ onboardingDone: true, demoMode: false }])
  })

  it('儲存設定失敗 → 顯示訊息，可以再試一次', async () => {
    installFakeSvs({
      'settings.update': () => {
        throw appError('寫不進設定檔。')
      },
    })
    const onDone = vi.fn()
    render(<SetupWizard data={data()} reload={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByTestId('wizard-demo'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('寫不進設定檔。')
    })
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByTestId('wizard-demo').hasAttribute('disabled')).toBe(false)
  })
})
