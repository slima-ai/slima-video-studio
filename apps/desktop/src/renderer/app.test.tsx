import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { App } from './app'
import { SETTINGS, appError, installFakeSvs, installFlowEnv } from './test/fake-svs'

beforeEach(installFlowEnv)
afterEach(cleanup)

describe('App', () => {
  it('第一次使用 → 先看到引導', async () => {
    installFakeSvs({ 'settings.get': () => ({ ...SETTINGS, onboardingDone: false }) })
    render(<App />)
    expect(await screen.findByTestId('setup-wizard')).toBeTruthy()
    expect(screen.queryByTestId('app-layout')).toBeNull()
  })

  it('已完成引導 → 直接進主畫面，導覽列可以切到設定頁再回來', async () => {
    installFakeSvs()
    render(<App />)
    expect(await screen.findByTestId('app-layout')).toBeTruthy()
    // 首頁是畫布
    expect(await screen.findByTestId('canvas-root')).toBeTruthy()
    expect(screen.getByRole('button', { name: '畫布' }).getAttribute('aria-current')).toBe('page')

    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    expect(await screen.findByTestId('settings-page')).toBeTruthy()
    expect(screen.getByTestId('keys-section')).toBeTruthy()
    expect(screen.getByTestId('models-section')).toBeTruthy()
    expect(screen.getByTestId('general-section')).toBeTruthy()
    expect(screen.getByRole('button', { name: '設定' }).getAttribute('aria-current')).toBe('page')

    fireEvent.click(screen.getByRole('button', { name: '畫布' }))
    expect(screen.queryByTestId('settings-page')).toBeNull()
    expect(await screen.findByTestId('canvas-root')).toBeTruthy()
  })

  it('沒有獨立的「快速開始」頁：一句話生成只在畫布上', async () => {
    installFakeSvs()
    render(<App />)
    await screen.findByTestId('app-layout')
    expect(screen.queryByRole('button', { name: '快速開始' })).toBeNull()
  })

  it('導覽列第一個是畫布，沒有「節點圖」，也沒有進階模式的開關', async () => {
    installFakeSvs({ 'settings.get': () => ({ ...SETTINGS, advancedMode: true }) })
    render(<App />)
    await screen.findByTestId('app-layout')
    const nav = within(screen.getByTestId('layout-nav')).getAllByRole('button')
    expect(nav[0]?.getAttribute('aria-label')).toBe('畫布')
    expect(screen.queryByRole('button', { name: '節點圖' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    await screen.findByTestId('general-section')
    expect(screen.queryByTestId('advanced-mode')).toBeNull()
  })

  it('畫布是空的 → 提示新增一句話，按下去就新增一個一句話節點', async () => {
    const fake = installFakeSvs({
      'canvas.add': () => ({ key: 'node:one', title: '一句話' }),
    })
    render(<App />)
    expect(await screen.findByTestId('canvas-empty')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新增一句話' }))
    await waitFor(() => {
      expect(fake.payloadsOf('canvas.add')).toEqual([expect.objectContaining({ kind: 'oneliner' })])
    })
  })

  it('依設定套用外觀：淺色與深色寫在 html，跟隨系統就不寫', async () => {
    installFakeSvs({ 'settings.get': () => ({ ...SETTINGS, theme: 'light' }) })
    const { unmount } = render(<App />)
    await screen.findByTestId('app-layout')
    expect(document.documentElement.dataset.theme).toBe('light')
    unmount()

    installFakeSvs()
    render(<App />)
    await screen.findByTestId('app-layout')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('完成引導後自動進到主畫面', async () => {
    let done = false
    installFakeSvs({
      'settings.get': () => ({ ...SETTINGS, onboardingDone: done }),
      'settings.update': () => {
        done = true
        return { ...SETTINGS, onboardingDone: true, demoMode: true }
      },
    })
    render(<App />)
    fireEvent.click(await screen.findByTestId('wizard-demo'))
    expect(await screen.findByTestId('app-layout')).toBeTruthy()
  })

  it('設定載入失敗 → 仍進得了主畫面，設定頁可以重試', async () => {
    let fail = true
    installFakeSvs({
      'keys.list': () => {
        if (fail) throw appError('讀取設定失敗。')
        return { keys: [], storage: { available: true, kind: 'os' } }
      },
    })
    render(<App />)
    expect(await screen.findByTestId('app-layout')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    expect((await screen.findByRole('alert')).textContent).toContain('讀取設定失敗。')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重試' }))
    await waitFor(() => {
      expect(screen.getByTestId('keys-section')).toBeTruthy()
    })
  })
})
