import {
  DEFAULT_LOCALE,
  DEFAULT_STORYBOARD_GUIDE,
  DEFAULT_STORYBOARD_GUIDE_EN,
  setLocale,
} from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS, appError, installFakeSvs } from '../../test/fake-svs'
import { StoryboardGuideSection } from './storyboard-guide-section'

afterEach(cleanup)

/** 準則的編輯區收在卡片的「更多」裡：畫出來後先展開。 */
const show = (ui: ReactElement): void => {
  render(ui)
  fireEvent.click(screen.getByTestId('setting-card-more'))
}

const box = (): HTMLTextAreaElement => screen.getByTestId<HTMLTextAreaElement>('storyboard-guide')

describe('StoryboardGuideSection', () => {
  it('沒自訂時顯示內建預設，儲存與恢復預設都是停用的', () => {
    installFakeSvs()
    show(<StoryboardGuideSection settings={SETTINGS} onChanged={vi.fn()} />)
    expect(box().value).toBe(DEFAULT_STORYBOARD_GUIDE)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '儲存' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '恢復預設' }).disabled).toBe(true)
  })

  it('改了內容才能儲存，送出的是修改後的文字', async () => {
    const svs = installFakeSvs()
    const onChanged = vi.fn()
    show(<StoryboardGuideSection settings={SETTINGS} onChanged={onChanged} />)
    fireEvent.change(box(), { target: { value: '多用遠景。' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ storyboardGuide: '多用遠景。' }])
    expect(screen.getByRole('status').textContent).toContain('已儲存')
  })

  it('改回跟預設一樣再儲存，存成空字串（之後預設更新才會跟著更新）', async () => {
    const svs = installFakeSvs()
    show(
      <StoryboardGuideSection
        settings={{ ...SETTINGS, storyboardGuide: '多用遠景。' }}
        onChanged={vi.fn()}
      />,
    )
    expect(box().value).toBe('多用遠景。')
    fireEvent.change(box(), { target: { value: DEFAULT_STORYBOARD_GUIDE } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => {
      expect(svs.payloadsOf('settings.update')).toEqual([{ storyboardGuide: '' }])
    })
  })

  it('恢復預設：輸入框換回預設並送出空字串', async () => {
    const svs = installFakeSvs()
    show(
      <StoryboardGuideSection
        settings={{ ...SETTINGS, storyboardGuide: '多用遠景。' }}
        onChanged={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '恢復預設' }))
    expect(box().value).toBe(DEFAULT_STORYBOARD_GUIDE)
    await waitFor(() => {
      expect(svs.payloadsOf('settings.update')).toEqual([{ storyboardGuide: '' }])
    })
    expect(screen.getByRole('status').textContent).toContain('已恢復預設')
  })

  it('超過字數上限時不能儲存', () => {
    installFakeSvs()
    show(<StoryboardGuideSection settings={SETTINGS} onChanged={vi.fn()} />)
    fireEvent.change(box(), { target: { value: 'a'.repeat(4001) } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '儲存' }).disabled).toBe(true)
    expect(screen.getByText(/太長了/)).toBeTruthy()
  })

  it('存檔失敗：顯示原因，沒有「已儲存」', async () => {
    installFakeSvs({
      'settings.update': () => {
        throw appError('寫不進設定檔')
      },
    })
    show(<StoryboardGuideSection settings={SETTINGS} onChanged={vi.fn()} />)
    fireEvent.change(box(), { target: { value: '多用遠景。' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('寫不進設定檔')
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('StoryboardGuideSection：英文介面', () => {
  beforeEach(() => {
    setLocale('en')
  })
  afterEach(() => {
    setLocale(DEFAULT_LOCALE)
  })

  it('沒自訂：顯示英文版預設，狀態是 Default，儲存與恢復預設停用', () => {
    installFakeSvs()
    show(<StoryboardGuideSection settings={SETTINGS} onChanged={vi.fn()} />)
    expect(box().value).toBe(DEFAULT_STORYBOARD_GUIDE_EN)
    expect(screen.getByText('Default')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Restore default' }).disabled,
    ).toBe(true)
  })

  it('設定檔裡存的是中文版預設（舊版按過儲存）：算沒自訂，英文介面顯示英文版、狀態 Default', () => {
    installFakeSvs()
    show(
      <StoryboardGuideSection
        settings={{ ...SETTINGS, storyboardGuide: DEFAULT_STORYBOARD_GUIDE }}
        onChanged={vi.fn()}
      />,
    )
    expect(box().value).toBe(DEFAULT_STORYBOARD_GUIDE_EN)
    expect(screen.getByText('Default')).toBeTruthy()
  })

  it('使用者自訂的（中文也一樣）原樣顯示，不被換成英文預設；狀態是 Edited', () => {
    installFakeSvs()
    show(
      <StoryboardGuideSection
        settings={{ ...SETTINGS, storyboardGuide: '多用遠景。' }}
        onChanged={vi.fn()}
      />,
    )
    expect(box().value).toBe('多用遠景。')
    expect(screen.getByText('Edited')).toBeTruthy()
  })

  it('改回英文預設再儲存 → 存成空字串；字數上限是英文的（4,001 字可存、10,001 字不行）', async () => {
    const svs = installFakeSvs()
    show(
      <StoryboardGuideSection
        settings={{ ...SETTINGS, storyboardGuide: 'Prefer wide shots.' }}
        onChanged={vi.fn()}
      />,
    )
    fireEvent.change(box(), { target: { value: 'a'.repeat(4001) } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false)
    fireEvent.change(box(), { target: { value: 'a'.repeat(10_001) } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
    fireEvent.change(box(), { target: { value: DEFAULT_STORYBOARD_GUIDE_EN } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(svs.payloadsOf('settings.update')).toEqual([{ storyboardGuide: '' }])
    })
  })
})
