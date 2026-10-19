import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AddMenu } from './menus'

afterEach(cleanup)

const open = (props: Partial<Parameters<typeof AddMenu>[0]> = {}) => {
  const onPick = vi.fn()
  render(
    <AddMenu
      at={{ x: 100, y: 100 }}
      title="新增節點"
      onPick={onPick}
      onClose={vi.fn()}
      {...props}
    />,
  )
  return onPick
}

const names = (): string[] => screen.getAllByRole('option').map((o) => o.textContent)

describe('AddMenu', () => {
  it('沒有限制時列出全部種類；有給 kinds 就只列那幾種', () => {
    open()
    expect(screen.getAllByRole('option').length).toBeGreaterThan(4)
    cleanup()
    open({ kinds: ['scene', 'shot'] })
    expect(names()).toHaveLength(2)
  })

  it('搜尋：名稱符合就只列名稱符合的（打「地點」不會連「場」也跑出來）；名稱都不符合才看說明', () => {
    open({ kinds: ['scene', 'shot', 'character', 'location'] })
    fireEvent.change(screen.getByLabelText('搜尋要新增的種類'), { target: { value: '地點' } })
    expect(names()).toHaveLength(1)
    expect(names()[0]).toContain('地點')
    fireEvent.change(screen.getByLabelText('搜尋要新增的種類'), { target: { value: '人物' } })
    expect(names()).toHaveLength(1)
    expect(names()[0]).toContain('角色')
    fireEvent.change(screen.getByLabelText('搜尋要新增的種類'), { target: { value: '火星' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('沒有符合的種類')).toBeTruthy()
  })

  it('方向鍵選、Enter 新增；從連接點開的選單只列接得上的（帶著要接的點）', () => {
    const onPick = open({
      kinds: ['scene', 'shot'],
      choices: [
        { kind: 'shot', port: 'shot-ref-loc' },
        { kind: 'scene', port: 'scene-loc' },
      ],
    })
    expect(names()).toHaveLength(2)
    const input = screen.getByLabelText('搜尋要新增的種類')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith({ kind: 'scene', port: 'scene-loc' })
  })
})
