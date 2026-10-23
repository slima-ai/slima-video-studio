import { DEFAULT_PRODUCTION_GUIDE } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS, installFakeSvs } from '../../test/fake-svs'
import { ProductionGuideSection } from './production-guide-section'

afterEach(cleanup)

/** 指南的編輯區收在卡片的「更多」裡：畫出來後先展開。 */
const show = (ui: ReactElement): void => {
  render(ui)
  fireEvent.click(screen.getByTestId('setting-card-more'))
}

const box = (): HTMLTextAreaElement => screen.getByTestId<HTMLTextAreaElement>('production-guide')

describe('ProductionGuideSection', () => {
  it('沒自訂時顯示內建預設，儲存與恢復預設都是停用的', () => {
    installFakeSvs()
    show(<ProductionGuideSection settings={SETTINGS} onChanged={vi.fn()} />)
    expect(box().value).toBe(DEFAULT_PRODUCTION_GUIDE)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '儲存' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '恢復預設' }).disabled).toBe(true)
  })

  it('改了內容才能儲存，送出的是 productionGuide（不是分鏡準則）', async () => {
    const svs = installFakeSvs()
    const onChanged = vi.fn()
    show(<ProductionGuideSection settings={SETTINGS} onChanged={onChanged} />)
    fireEvent.change(box(), { target: { value: '臉先鎖定。' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ productionGuide: '臉先鎖定。' }])
  })

  it('恢復預設：輸入框換回預設並送出空字串', async () => {
    const svs = installFakeSvs()
    show(
      <ProductionGuideSection
        settings={{ ...SETTINGS, productionGuide: '臉先鎖定。' }}
        onChanged={vi.fn()}
      />,
    )
    expect(box().value).toBe('臉先鎖定。')
    fireEvent.click(screen.getByRole('button', { name: '恢復預設' }))
    expect(box().value).toBe(DEFAULT_PRODUCTION_GUIDE)
    await waitFor(() => {
      expect(svs.payloadsOf('settings.update')).toEqual([{ productionGuide: '' }])
    })
  })

  it('超過字數上限時不能儲存', () => {
    installFakeSvs()
    show(<ProductionGuideSection settings={SETTINGS} onChanged={vi.fn()} />)
    fireEvent.change(box(), { target: { value: 'a'.repeat(12001) } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '儲存' }).disabled).toBe(true)
  })
})
