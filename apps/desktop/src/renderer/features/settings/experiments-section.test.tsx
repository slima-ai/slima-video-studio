import type { AppSettings } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS, appError, installFakeSvs } from '../../test/fake-svs'
import { ExperimentsSection } from './experiments-section'

afterEach(cleanup)

const info = (packaged: boolean) => () => ({
  name: 'x',
  version: '0',
  platform: 'darwin',
  packaged,
})
const withFlag = (claudeChat?: boolean): AppSettings => ({
  ...SETTINGS,
  experiments: claudeChat === undefined ? {} : { claudeChat },
})

describe('ExperimentsSection：Claude 對話開關', () => {
  it('沒設過：開發版勾著、打包版沒勾；設過就照設的', async () => {
    installFakeSvs({ 'app.getInfo': info(false) })
    render(<ExperimentsSection settings={withFlag()} onChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('experiment-claude-chat').checked).toBe(true)
    })
    cleanup()
    installFakeSvs({ 'app.getInfo': info(true) })
    render(<ExperimentsSection settings={withFlag()} onChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('experiment-claude-chat').checked).toBe(false)
    })
    cleanup()
    installFakeSvs({ 'app.getInfo': info(true) })
    render(<ExperimentsSection settings={withFlag(true)} onChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('experiment-claude-chat').checked).toBe(true)
    })
  })

  it('勾選就存起來（只送 experiments.claudeChat）；存失敗就還原並說明', async () => {
    const onChanged = vi.fn()
    const fake = installFakeSvs({ 'app.getInfo': info(true), 'settings.update': () => ({}) })
    render(<ExperimentsSection settings={withFlag()} onChanged={onChanged} />)
    fireEvent.click(await screen.findByTestId('experiment-claude-chat'))
    await waitFor(() => {
      expect(fake.calls.find((c) => c.channel === 'settings.update')?.payload).toEqual({
        experiments: { claudeChat: true },
      })
    })
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled()
    })
    cleanup()
    installFakeSvs({
      'app.getInfo': info(true),
      'settings.update': () => {
        throw appError('存不了')
      },
    })
    render(<ExperimentsSection settings={withFlag()} onChanged={vi.fn()} />)
    const box = await screen.findByTestId<HTMLInputElement>('experiment-claude-chat')
    fireEvent.click(box)
    expect((await screen.findByRole('alert')).textContent).toBe('存不了')
    expect(box.checked).toBe(false)
  })
})

describe('ExperimentsSection：Claude 對話每一段的用量上限', () => {
  it('填一個數字、離開輸入框就存（只送 experiments.claudeBudgetUsd）；留空＝用預設', async () => {
    const fake = installFakeSvs({ 'app.getInfo': info(true), 'settings.update': () => ({}) })
    const onChanged = vi.fn()
    render(<ExperimentsSection settings={withFlag()} onChanged={onChanged} />)
    fireEvent.click(await screen.findByTestId('setting-card-more'))
    const input = await screen.findByTestId<HTMLInputElement>('experiment-claude-budget')
    expect(screen.queryByTestId('experiment-claude-budget-saved')).toBeNull()
    fireEvent.change(input, { target: { value: '1.5' } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(fake.calls.find((c) => c.channel === 'settings.update')?.payload).toEqual({
        experiments: { claudeBudgetUsd: 1.5 },
      })
    })
    // 存好之後看得到「已儲存」（不另外加儲存鈕）；再改又消失
    expect((await screen.findByTestId('experiment-claude-budget-saved')).textContent).toBe('已儲存')
    fireEvent.change(input, { target: { value: '2' } })
    expect(screen.queryByTestId('experiment-claude-budget-saved')).toBeNull()
    cleanup()
    const again = installFakeSvs({ 'app.getInfo': info(true), 'settings.update': () => ({}) })
    render(
      <ExperimentsSection
        settings={{ ...SETTINGS, experiments: { claudeBudgetUsd: 2 } }}
        onChanged={onChanged}
      />,
    )
    fireEvent.click(await screen.findByTestId('setting-card-more'))
    const filled = await screen.findByTestId<HTMLInputElement>('experiment-claude-budget')
    expect(filled.value).toBe('2')
    fireEvent.change(filled, { target: { value: '' } })
    fireEvent.blur(filled)
    await waitFor(() => {
      expect(again.calls.find((c) => c.channel === 'settings.update')?.payload).toEqual({
        experiments: { claudeBudgetUsd: null },
      })
    })
  })

  it('不是數字或超出範圍：說明範圍、不送出', async () => {
    const fake = installFakeSvs({ 'app.getInfo': info(true), 'settings.update': () => ({}) })
    render(<ExperimentsSection settings={withFlag()} onChanged={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('setting-card-more'))
    const input = await screen.findByTestId<HTMLInputElement>('experiment-claude-budget')
    for (const bad of ['abc', '0', '999']) {
      fireEvent.change(input, { target: { value: bad } })
      fireEvent.blur(input)
      expect((await screen.findByRole('alert')).textContent).toContain('之間')
    }
    expect(fake.calls.filter((c) => c.channel === 'settings.update')).toHaveLength(0)
  })
})
