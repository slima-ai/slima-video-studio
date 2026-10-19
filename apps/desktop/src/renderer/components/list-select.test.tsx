import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ListSelect, type ListOption } from './list-select'

afterEach(cleanup)

const OPTIONS: ListOption[] = [
  { value: 'a', label: '甲', content: <b>甲</b> },
  { value: 'b', label: '乙', content: <b>乙</b> },
  { value: 'c', label: '丙', content: <b>丙</b> },
]

function setup(value: string | undefined = 'a') {
  const onChange = vi.fn()
  render(<ListSelect testId="pick" value={value} options={OPTIONS} onChange={onChange} />)
  return { onChange, trigger: screen.getByTestId('pick') }
}

describe('ListSelect', () => {
  it('收起時顯示目前的選擇；沒有選擇時顯示提示字', () => {
    const { trigger } = setup('b')
    expect(trigger.textContent).toBe('乙')
    expect(screen.queryByRole('listbox')).toBeNull()
    cleanup()
    render(<ListSelect testId="pick" value={undefined} options={OPTIONS} onChange={vi.fn()} />)
    expect(screen.getByTestId('pick').textContent).toBe('請選擇')
  })

  it('點開列出全部選項、標出目前項目；點一個就選取並收起', () => {
    const { trigger, onChange } = setup('b')
    fireEvent.click(trigger)
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    fireEvent.click(screen.getByTestId('pick-option-c'))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('鍵盤：↓ 展開、↓ 移動、Enter 選取', () => {
    const { trigger, onChange } = setup('a')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // 到底不再往下
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('不能選的選項看得到、標 aria-disabled；點它或按 Enter 都不會選，選單也不收起', () => {
    const onChange = vi.fn()
    const options: ListOption[] = [
      ...OPTIONS,
      { value: 'd', label: '丁', content: '丁', disabled: true },
    ]
    render(<ListSelect testId="pick" value="a" options={options} onChange={onChange} />)
    const trigger = screen.getByTestId('pick')
    fireEvent.click(trigger)
    const locked = screen.getByTestId('pick-option-d')
    expect(locked.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByTestId('pick-option-a').hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(locked)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeTruthy()
    for (let i = 0; i < 3; i++) fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Esc 只關選單且不往外傳（外面的面板不會跟著關）', () => {
    const { trigger } = setup('a')
    fireEvent.click(trigger)
    const notPrevented = fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(notPrevented).toBe(false)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('點選單外面會關閉', () => {
    const { trigger } = setup('a')
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
