import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StartCards } from './canvas-start'
import { LooseBanner } from './loose-banner'

afterEach(cleanup)

describe('StartCards：空白畫布的三個起點', () => {
  it('三種起點都在，說清楚會不會花錢；貼故事沒寫字之前不能按', () => {
    const onManual = vi.fn()
    const onSplit = vi.fn()
    const onOneliner = vi.fn()
    render(
      <StartCards busy={false} onManual={onManual} onSplit={onSplit} onOneliner={onOneliner} />,
    )
    const empty = screen.getByTestId('canvas-empty')
    expect(empty.textContent).toContain('自己一步一步來')
    expect(empty.textContent).toContain('貼一段故事')
    expect(empty.textContent).toContain('一句話')
    expect(empty.textContent).toContain('加上去不花錢')
    expect(empty.textContent).toContain('不生成圖片和影片')
    expect(empty.textContent).toContain('會花錢（圖片和影片）')

    fireEvent.click(screen.getByTestId('empty-manual'))
    expect(onManual).toHaveBeenCalledTimes(1)

    const go = screen.getByTestId<HTMLButtonElement>('empty-paste-go')
    expect(go.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('empty-paste-text'), { target: { value: '  一個故事 ' } })
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    expect(onSplit).toHaveBeenCalledWith('一個故事', expect.anything())

    fireEvent.change(screen.getByTestId('empty-story'), { target: { value: ' 一隻貓 ' } })
    fireEvent.click(screen.getByTestId('empty-add-oneliner'))
    expect(onOneliner).toHaveBeenCalledWith('一隻貓')
  })

  it('「一句話」起手卡的說明跟放下去之後的主鈕一致：先看分鏡、再決定要不要生成，不說「一次做完」是主要做法', () => {
    render(<StartCards busy={false} onManual={vi.fn()} onSplit={vi.fn()} onOneliner={vi.fn()} />)
    const empty = screen.getByTestId('canvas-empty')
    expect(empty.textContent).toContain('先看分鏡')
    expect(empty.textContent).toContain('再決定要不要生成')
    expect(empty.textContent).not.toContain('AI 一次做完整支短片')
  })

  it('正在拆分鏡：貼故事那張停用', () => {
    render(<StartCards busy onManual={vi.fn()} onSplit={vi.fn()} onOneliner={vi.fn()} />)
    expect(screen.getByTestId<HTMLButtonElement>('empty-paste-go').disabled).toBe(true)
    expect(screen.getByTestId<HTMLTextAreaElement>('empty-paste-text').disabled).toBe(true)
  })
})

describe('LooseBanner：沒歸場的鏡頭', () => {
  it('寫出幾個、不會接進成品；有場就歸進最後一個場，沒有場就建新的', () => {
    const onShow = vi.fn()
    const onAssign = vi.fn()
    const { rerender } = render(
      <LooseBanner count={2} sceneName="第 3 場" onShow={onShow} onAssign={onAssign} />,
    )
    expect(screen.getByTestId('loose-banner').textContent).toContain('有 2 個鏡頭還沒歸到任何場')
    expect(screen.getByTestId('loose-banner').textContent).toContain('不會接進成品')
    expect(screen.getByTestId('loose-assign').textContent).toBe('歸進「第 3 場」')
    fireEvent.click(screen.getByTestId('loose-show'))
    fireEvent.click(screen.getByTestId('loose-assign'))
    expect(onShow).toHaveBeenCalledTimes(1)
    expect(onAssign).toHaveBeenCalledTimes(1)
    rerender(<LooseBanner count={1} sceneName={undefined} onShow={onShow} onAssign={onAssign} />)
    expect(screen.getByTestId('loose-assign').textContent).toBe('歸進一個新的場')
  })
})
