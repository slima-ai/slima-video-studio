import { cleanup, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppLayout } from './app-layout'
import { SidePanel } from './side-panel'

afterEach(cleanup)

describe('AppLayout', () => {
  it('呈現左導覽、中央、底部佇列；右面板沒有內容時寬度是 0，不佔位', () => {
    render(<AppLayout>內容</AppLayout>)
    expect(screen.getByTestId('layout-nav')).toBeTruthy()
    expect(screen.getByTestId('layout-main').textContent).toBe('內容')
    expect(screen.getByTestId('layout-queue')).toBeTruthy()
    const panel = screen.getByTestId('layout-panel')
    expect(panel.dataset.open).toBe('false')
    expect(panel.style.transform).toBe('translateX(100%)')
    expect(screen.getByTestId('layout-main').style.marginRight).toBe('0px')
  })

  it('頁面用 SidePanel 放內容：選取時面板展開，取消選取就收起', async () => {
    function Page({ open }: { open: boolean }) {
      return (
        <AppLayout>
          <SidePanel open={open} onClose={vi.fn()}>
            <p>鏡頭詳情</p>
          </SidePanel>
        </AppLayout>
      )
    }
    const { rerender } = render(<Page open={false} />)
    expect(screen.queryByText('鏡頭詳情')).toBeNull()
    rerender(<Page open />)
    const panel = screen.getByTestId('layout-panel')
    await waitFor(() => {
      expect(panel.dataset.open).toBe('true')
    })
    expect(panel.style.transform).toBe('translateX(0)')
    expect(panel.style.width).toBe('24rem')
    expect(screen.getByTestId('layout-main').style.marginRight).toBe('24rem')
    expect(panel.textContent).toBe('鏡頭詳情')
    rerender(<Page open={false} />)
    await waitFor(() => {
      expect(panel.dataset.open).toBe('false')
    })
    // 動畫播完後內容才拿掉
    await waitFor(() => {
      expect(screen.queryByText('鏡頭詳情')).toBeNull()
    })
  })

  it('設定頁不顯示生成佇列', () => {
    const { rerender } = render(<AppLayout view="canvas" />)
    expect(screen.getByTestId('layout-queue')).toBeTruthy()
    rerender(<AppLayout view="settings" />)
    expect(screen.queryByTestId('layout-queue')).toBeNull()
  })

  it('導覽按鈕有無障礙名稱', () => {
    render(<AppLayout />)
    expect(screen.getByRole('button', { name: '畫布' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '大綱' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '設定' })).toBeTruthy()
  })

  it('目前所在的頁面有標示（aria-current 與底色），其他沒有；每個按鈕都有名稱提示', () => {
    render(<AppLayout view="settings" />)
    const current = screen.getByRole('button', { name: '設定' })
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(current.dataset.active).toBe('true')
    const other = screen.getByRole('button', { name: '畫布' })
    expect(other.getAttribute('aria-current')).toBeNull()
    expect(other.dataset.active).toBe('false')
    // 圖示下面的小字＋滑過或聚焦才出現的完整名稱（都是 aria-hidden，按鈕的名字是 aria-label）
    expect(current.textContent).toBe('設定設定')
    expect(current.querySelectorAll('[aria-hidden=true]').length).toBeGreaterThanOrEqual(2)
  })

  it('「從 Slima 匯入」只在有連上（或設定了）Slima 時才出現', () => {
    const { rerender } = render(<AppLayout />)
    expect(screen.queryByRole('button', { name: '從 Slima 匯入' })).toBeNull()
    rerender(<AppLayout showSlima />)
    expect(screen.getByRole('button', { name: '從 Slima 匯入' })).toBeTruthy()
  })

  it('導覽按鈕在圖示下面直接寫名字，不用滑過才知道；從 Slima 匯入寫短的「Slima」', () => {
    render(<AppLayout view="canvas" showSlima />)
    const nav = within(screen.getByTestId('layout-nav'))
    for (const [label, visible] of [
      ['畫布', '畫布'],
      ['大綱', '大綱'],
      ['分鏡表', '分鏡表'],
      ['角色', '角色'],
      ['場景卡', '場景卡'],
      ['生成紀錄', '生成紀錄'],
      ['檔案', '檔案'],
      ['從 Slima 匯入', 'Slima'],
      ['專案', '專案'],
      ['設定', '設定'],
    ] as const) {
      const button = nav.getByRole('button', { name: label })
      // 圖示下面那行字（aria-hidden，名字仍是 aria-label）
      expect(within(button).getAllByText(visible).length).toBeGreaterThanOrEqual(1)
    }
  })
})
