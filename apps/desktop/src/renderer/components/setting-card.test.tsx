import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Palette } from 'lucide-react'
import { afterEach, describe, expect, it } from 'vitest'

import { SettingCard } from './setting-card'
import { SettingGroup } from './setting-group'
import { StatusLight } from './status-light'

afterEach(cleanup)

describe('StatusLight', () => {
  it('一顆點加一段字：字一定有（不能只靠顏色）；四種狀態各有自己的 tone', () => {
    for (const tone of ['ok', 'warn', 'off', 'error'] as const) {
      render(<StatusLight tone={tone} label={`狀態-${tone}`} />)
      const light = screen.getByText(`狀態-${tone}`)
      expect(light.getAttribute('data-tone')).toBe(tone)
      expect(light.querySelector('[aria-hidden="true"]')).not.toBeNull()
      cleanup()
    }
  })
})

describe('SettingCard', () => {
  it('標題、狀態燈、一句白話、一個動作；整張卡是有名字的區塊，不是可以點的按鈕', () => {
    render(
      <SettingCard
        icon={Palette}
        title="外觀"
        status={{ tone: 'ok', label: '跟著系統' }}
        summary="跟著系統換淺色或深色。"
        action={<button type="button">切換</button>}
        testId="card-appearance"
      />,
    )
    const card = screen.getByTestId('card-appearance')
    expect(card.tagName).toBe('SECTION')
    expect(card.getAttribute('aria-label')).toBe('外觀')
    expect(screen.getByRole('heading', { name: '外觀' })).toBeTruthy()
    expect(screen.getByText('跟著系統換淺色或深色。')).toBeTruthy()
    expect(screen.getByText('跟著系統').getAttribute('data-tone')).toBe('ok')
    expect(screen.getByRole('button', { name: '切換' })).toBeTruthy()
    // 沒給 details：沒有「更多」
    expect(screen.queryByTestId('setting-card-more')).toBeNull()
    // 圖示只是裝飾
    expect(card.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('細節收在「更多」裡：一開始看不到，按了在卡內展開、再按收起；aria-expanded 跟著變', () => {
    render(
      <SettingCard
        icon={Palette}
        title="服務金鑰"
        summary="填好才能真的生成。"
        details={
          <label>
            金鑰欄位
            <input aria-label="金鑰欄位" />
          </label>
        }
      />,
    )
    const more = screen.getByTestId('setting-card-more')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText('金鑰欄位')).toBeNull()
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(more.textContent).toBe('收起')
    expect(screen.getByLabelText('金鑰欄位')).toBeTruthy()
    // 按鈕指向展開的區塊
    expect(document.getElementById(more.getAttribute('aria-controls') ?? '')).not.toBeNull()
    fireEvent.click(more)
    expect(more.textContent).toBe('更多')
    expect(screen.queryByLabelText('金鑰欄位')).toBeNull()
  })

  it('defaultOpen：一開始就展開', () => {
    render(<SettingCard icon={Palette} title="x" summary="y" details={<p>細節</p>} defaultOpen />)
    expect(screen.getByText('細節')).toBeTruthy()
    expect(screen.getByTestId('setting-card-more').getAttribute('aria-expanded')).toBe('true')
  })
})

describe('SettingGroup', () => {
  it('區標題＋一句副標＋一組卡片；有錨點 id、區塊名字就是標題', () => {
    render(
      <SettingGroup id="keys" title="服務金鑰" hint="要真的生成才需要填。">
        <SettingCard icon={Palette} title="OpenRouter" summary="還沒填。" />
      </SettingGroup>,
    )
    const group = screen.getByTestId('keys')
    expect(group.id).toBe('keys')
    expect(screen.getByRole('region', { name: '服務金鑰' })).toBe(group)
    expect(screen.getByText('要真的生成才需要填。')).toBeTruthy()
    expect(group.querySelector('section[aria-label="OpenRouter"]')).not.toBeNull()
  })
})
