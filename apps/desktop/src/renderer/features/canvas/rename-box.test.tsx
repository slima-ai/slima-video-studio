import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RenameBox, isRenamable } from './rename-box'

afterEach(cleanup)

const open = () => {
  const onCommit = vi.fn()
  const onCancel = vi.fn()
  render(
    <RenameBox
      target={{
        key: 'scene:1',
        initial: '雨夜',
        rect: { left: 0, top: 0, width: 200, height: 34 },
      }}
      onCommit={onCommit}
      onCancel={onCancel}
    />,
  )
  return { onCommit, onCancel, input: screen.getByTestId('rename-box') }
}

describe('F2 改名的輸入框', () => {
  it('打開就選好目前的名字；Enter 存去掉前後空白的新名字', () => {
    const { onCommit, onCancel, input } = open()
    expect(document.activeElement).toBe(input)
    expect((input as HTMLInputElement).value).toBe('雨夜')
    fireEvent.change(input, { target: { value: '  雨夜的巷子 ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('雨夜的巷子')
    // 存了之後輸入框失焦不會再存一次
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Esc、沒改、改成空的都不送出', () => {
    const a = open()
    fireEvent.change(a.input, { target: { value: '別的' } })
    fireEvent.keyDown(a.input, { key: 'Escape' })
    expect(a.onCommit).not.toHaveBeenCalled()
    expect(a.onCancel).toHaveBeenCalledOnce()
    cleanup()
    const b = open()
    fireEvent.keyDown(b.input, { key: 'Enter' })
    expect(b.onCommit).not.toHaveBeenCalled()
    cleanup()
    const c = open()
    fireEvent.change(c.input, { target: { value: '   ' } })
    fireEvent.blur(c.input)
    expect(c.onCommit).not.toHaveBeenCalled()
    expect(c.onCancel).toHaveBeenCalledOnce()
  })

  it('只有場、角色、地點可以改名', () => {
    expect(isRenamable('scene:1')).toBe(true)
    expect(isRenamable('character:1')).toBe(true)
    expect(isRenamable('location:1')).toBe(true)
    expect(isRenamable('shot:1')).toBe(false)
    expect(isRenamable('shot:1:image')).toBe(false)
    expect(isRenamable('node:1')).toBe(false)
    expect(isRenamable('cut')).toBe(false)
  })
})
