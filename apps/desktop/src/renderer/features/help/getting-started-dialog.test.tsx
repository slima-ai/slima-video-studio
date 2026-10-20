import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GettingStartedDialog } from './getting-started-dialog'

afterEach(cleanup)

describe('GettingStartedDialog：怎麼開始', () => {
  it('三個步驟：建專案 → 在畫布選一種開始方式 → 生成與匯出', () => {
    render(<GettingStartedDialog onClose={vi.fn()} />)
    const steps = screen.getAllByTestId('getting-started-step')
    expect(steps.map((step) => within(step).getByRole('heading').textContent)).toEqual([
      '建專案',
      '在畫布選一種開始方式',
      '生成與匯出',
    ])
  })

  it('第二步用的名字，跟空白畫布三張卡的標題一樣', () => {
    render(<GettingStartedDialog onClose={vi.fn()} />)
    const second = screen.getAllByTestId('getting-started-step')[1]
    for (const title of ['自己一步一步來', '貼一段故事', '一句話']) {
      expect(second?.textContent).toContain(title)
    }
  })

  it('講到新專案、自動儲存、全部生成、匯出 MP4 的位置', () => {
    render(<GettingStartedDialog onClose={vi.fn()} />)
    const text = screen.getByTestId('getting-started-dialog').textContent
    for (const phrase of ['新專案', '已自動儲存', '全部生成', '剪輯', '匯出 MP4', '匯出」資料夾']) {
      expect(text).toContain(phrase)
    }
  })

  it('「知道了」關掉', () => {
    const onClose = vi.fn()
    render(<GettingStartedDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
