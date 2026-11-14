import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { useProjectReset } from './use-project-reset'

afterEach(cleanup)

/** 跟 canvas-page 一樣的用法：浮動面板開著，換專案就關掉。 */
function Panel({ onReset }: { onReset?: () => void }) {
  const [open, setOpen] = useState(true)
  useProjectReset(() => {
    setOpen(false)
    onReset?.()
  })
  return open ? <div data-testid="panel">上一個專案的成品面板</div> : null
}

describe('useProjectReset：換專案時清掉上一個專案留下的東西', () => {
  it('面板開著、換了專案（queue.reset）：面板關掉', () => {
    const fake = installFakeSvs()
    render(<Panel />)
    expect(screen.getByTestId('panel')).toBeTruthy()
    act(() => {
      fake.emit('queue.reset', {})
    })
    expect(screen.queryByTestId('panel')).toBeNull()
  })

  it('拿的永遠是最新的函式；元件拿掉之後不再被叫', () => {
    const fake = installFakeSvs()
    const onReset = vi.fn()
    const view = render(<Panel onReset={onReset} />)
    act(() => {
      fake.emit('queue.reset', {})
    })
    expect(onReset).toHaveBeenCalledTimes(1)
    view.unmount()
    act(() => {
      fake.emit('queue.reset', {})
    })
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
