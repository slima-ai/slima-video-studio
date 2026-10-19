import { DEFAULT_STORYBOARD_GUIDE } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS, appError, installFakeSvs } from '../../test/fake-svs'
import { StoryboardGuideSection } from './storyboard-guide-section'

afterEach(cleanup)

const box = (): HTMLTextAreaElement => screen.getByTestId<HTMLTextAreaElement>('storyboard-guide')

describe('StoryboardGuideSection', () => {
  it('沒自訂時顯示內建預設，儲存與恢復預設都是停用的', () => {
    installFakeSvs()
    render(<StoryboardGuideSection settings={SETTINGS} onChanged={vi.fn()} />)
    expect(box().value).toBe(DEFAULT_STORYBOARD_GUIDE)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '儲存' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '恢復預設' }).disabled).toBe(true)
  })

  it('改了內容才能儲存，送出的是修改後的文字', async () => {
    const svs = installFakeSvs()
    const onChanged = vi.fn()
    render(<StoryboardGuideSection settings={SETTINGS} onChanged={onChanged} />)
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
    render(
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
    render(
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
    render(<StoryboardGuideSection settings={SETTINGS} onChanged={vi.fn()} />)
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
    render(<StoryboardGuideSection settings={SETTINGS} onChanged={vi.fn()} />)
    fireEvent.change(box(), { target: { value: '多用遠景。' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('寫不進設定檔')
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
