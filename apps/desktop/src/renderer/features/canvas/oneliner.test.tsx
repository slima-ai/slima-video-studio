import type { OnelinerParams, QuickStartCheck } from '@svs/schema'
import { ONELINER_DEFAULTS } from '@svs/schema'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CanvasActionsContext, type CanvasActions } from './canvas-actions'
import type { CanvasNodeData } from './canvas-model'
import { choose, optionLabels } from '../../test/select'
import { GrowConfirm } from './grow-confirm'
import { OnelinerBody } from './oneliner'
import type { GrowConfirm as Pending } from './use-grow'

afterEach(cleanup)

const data = (patch: Partial<CanvasNodeData> = {}): CanvasNodeData => ({
  kind: 'oneliner',
  title: '一句話',
  summary: '',
  oneliner: ONELINER_DEFAULTS,
  ...patch,
})

function renderBody(actions: Partial<CanvasActions>, node: CanvasNodeData = data()) {
  const full: CanvasActions = { focusNode: vi.fn(), toggleInCut: vi.fn(), ...actions }
  return render(
    <CanvasActionsContext.Provider value={full}>
      <OnelinerBody id="node:one" data={node} />
    </CanvasActionsContext.Provider>,
  )
}

describe('OnelinerBody', () => {
  it('打完字離開輸入框才存；沒改就不存', () => {
    const updateOneliner = vi.fn()
    renderBody({ updateOneliner })
    const box = screen.getByTestId('oneliner-story')
    fireEvent.focus(box)
    fireEvent.blur(box)
    expect(updateOneliner).not.toHaveBeenCalled()

    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '一隻貓在雨夜找到家' } })
    expect(updateOneliner).not.toHaveBeenCalled()
    fireEvent.blur(box)
    expect(updateOneliner).toHaveBeenCalledWith('node:one', { story: '一隻貓在雨夜找到家' })
  })

  it('畫風選單有「手繪繪本」；選了就存成 painted', () => {
    const updateOneliner = vi.fn()
    renderBody({ updateOneliner })
    expect(optionLabels('oneliner-style')).toEqual([
      '寫實',
      '日系動畫',
      '3D 動畫',
      '水彩',
      '手繪繪本',
    ])
    choose('oneliner-style', 'painted')
    expect(updateOneliner).toHaveBeenCalledWith('node:one', { style: 'painted' })
  })

  it('聲音三個勾選預設全開；勾掉一個就存起來；生成時帶著目前的勾選', () => {
    const updateOneliner = vi.fn()
    const growStory = vi.fn()
    renderBody(
      { updateOneliner, growStory },
      data({ oneliner: { ...ONELINER_DEFAULTS, story: '一隻貓' } }),
    )
    for (const key of ['native', 'narration', 'music']) {
      expect(screen.getByTestId<HTMLInputElement>(`oneliner-sound-${key}`).checked).toBe(true)
    }
    fireEvent.click(screen.getByTestId('oneliner-sound-music'))
    expect(updateOneliner).toHaveBeenCalledWith('node:one', {
      sound: { native: true, narration: true, music: false },
    })
    expect(screen.getByTestId<HTMLInputElement>('oneliner-sound-music').checked).toBe(false)
    fireEvent.click(screen.getByTestId('oneliner-generate'))
    expect(growStory).toHaveBeenCalledWith(
      'node:one',
      expect.objectContaining({ sound: { native: true, narration: true, music: false } }),
      expect.anything(),
      'full',
    )
  })

  it('沒有故事不能生成；有故事時主按鈕「先產生分鏡」帶著目前的設定、按鈕位置和 storyboard', () => {
    const growStory = vi.fn()
    renderBody({ growStory, updateOneliner: vi.fn() })
    const button = screen.getByTestId('oneliner-storyboard')
    expect(button.textContent).toBe('先產生分鏡')
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('oneliner-generate').hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByTestId('oneliner-story'), { target: { value: '貓找到家' } })
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    const [id, params, anchor, stage] = growStory.mock.calls[0] as [
      string,
      OnelinerParams,
      { right: number },
      string,
    ]
    expect(stage).toBe('storyboard')
    expect(id).toBe('node:one')
    // 聲音勾選預設全開，生成時一併帶著
    expect(params).toEqual({
      ...ONELINER_DEFAULTS,
      story: '貓找到家',
      sound: { native: true, narration: true, music: true },
    })
    expect(typeof anchor.right).toBe('number')
  })

  it('次要選項「一次做完整支」留著：帶 full', () => {
    const growStory = vi.fn()
    renderBody({ growStory, updateOneliner: vi.fn() })
    fireEvent.change(screen.getByTestId('oneliner-story'), { target: { value: '貓找到家' } })
    const full = screen.getByTestId('oneliner-generate')
    expect(full.textContent).toBe('一次做完整支')
    fireEvent.click(full)
    expect((growStory.mock.calls[0] as unknown[])[3]).toBe('full')
  })

  it('生成中：輸入框與選項都鎖住，按鈕顯示生成中，可以停止', () => {
    const stopGrow = vi.fn()
    renderBody(
      { growStory: vi.fn(), stopGrow },
      data({
        status: 'running',
        summary: '貓找到家',
        oneliner: { ...ONELINER_DEFAULTS, story: '貓找到家' },
      }),
    )
    expect(screen.getByTestId('oneliner-story').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('oneliner-storyboard').textContent).toContain('生成中')
    expect(screen.getByTestId('oneliner-storyboard').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('oneliner-generate').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByTestId('oneliner-stop'))
    expect(stopGrow).toHaveBeenCalled()
  })

  it('剛選的設定還沒存好時，重新載入讀到的舊值不會蓋掉它；存好之後再從別處改（復原）就跟著換', () => {
    const growStory = vi.fn()
    const actions = { focusNode: vi.fn(), toggleInCut: vi.fn(), growStory, updateOneliner: vi.fn() }
    const at = (shotCount: number) => (
      <CanvasActionsContext.Provider value={actions}>
        <OnelinerBody
          id="node:one"
          data={data({ oneliner: { ...ONELINER_DEFAULTS, story: '貓', shotCount } })}
        />
      </CanvasActionsContext.Provider>
    )
    const view = render(at(4))
    choose('oneliner-shots', '3')
    choose('oneliner-shots', '5')
    // 先讀到存好的 3（5 還在存）：畫面還是 5，按生成也是 5
    view.rerender(at(3))
    expect(screen.getByTestId('oneliner-shots').textContent).toContain('5 個鏡頭')
    fireEvent.click(screen.getByTestId('oneliner-generate'))
    expect((growStory.mock.calls[0] as [string, OnelinerParams])[1].shotCount).toBe(5)
    // 5 存好了；之後復原回 2：跟著換
    view.rerender(at(5))
    view.rerender(at(2))
    expect(screen.getByTestId('oneliner-shots').textContent).toContain('2 個鏡頭')
  })

  it('從別處（復原）改了故事，而且沒在打字 → 跟著更新', () => {
    const view = renderBody(
      { updateOneliner: vi.fn() },
      data({ oneliner: { ...ONELINER_DEFAULTS, story: 'A' } }),
    )
    const box = screen.getByTestId<HTMLTextAreaElement>('oneliner-story')
    expect(box.value).toBe('A')
    view.rerender(
      <CanvasActionsContext.Provider value={{ focusNode: vi.fn(), toggleInCut: vi.fn() }}>
        <OnelinerBody
          id="node:one"
          data={data({ oneliner: { ...ONELINER_DEFAULTS, story: 'B' } })}
        />
      </CanvasActionsContext.Provider>,
    )
    expect(screen.getByTestId<HTMLTextAreaElement>('oneliner-story').value).toBe('B')
  })
})

const check = (patch: Partial<QuickStartCheck> = {}): QuickStartCheck => ({
  ok: true,
  issues: [],
  estimatedUsd: 1.234,
  estimateIsLowerBound: false,
  limitUsd: 5,
  models: { llm: '文字模型', image: '圖片模型', video: '影片模型' },
  demoMode: false,
  ...patch,
})
const pending = (patch: Partial<Pending> = {}): Pending => ({
  nodeId: 'node:one',
  stage: 'full',
  params: { ...ONELINER_DEFAULTS, story: '貓找到家', shotCount: 4, durationSec: 5 },
  anchor: { left: 700, right: 800, top: 300, bottom: 340 },
  check: check(),
  hasContent: false,
  existing: { scenes: 0, shots: 0 },
  variation: 0,
  ...patch,
})

describe('GrowConfirm', () => {
  it('列出會做什麼與預估花費；專案是空的就沒有「取代全部」', () => {
    render(<GrowConfirm pending={pending()} onOk={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('寫分鏡：拆成 4 個鏡頭')).toBeTruthy()
    expect(screen.getByText('4 支影片（每支 5 秒）')).toBeTruthy()
    expect(screen.getByText(/US\$1\.23/)).toBeTruthy()
    expect(screen.queryByTestId('grow-replace')).toBeNull()
  })

  it('預設新增成新的一場；勾了刪掉現有內容：說清楚刪幾個場與鏡頭、什麼會留著、可以復原，確認鈕改成「刪掉並生成」', () => {
    const onOk = vi.fn()
    render(
      <GrowConfirm
        pending={pending({ hasContent: true, existing: { scenes: 2, shots: 7 } })}
        onOk={onOk}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('grow-replace-warning')).toBeNull()
    fireEvent.click(screen.getByTestId('run-confirm-ok'))
    expect(onOk).toHaveBeenLastCalledWith(false)

    fireEvent.click(screen.getByTestId('grow-replace'))
    const warning = screen.getByTestId('grow-replace-warning').textContent
    expect(warning).toContain('會刪掉 2 個場、7 個鏡頭')
    expect(warning).toContain('角色和地點會留著')
    expect(warning).toContain('復原')
    expect(screen.getByTestId('run-confirm-ok').textContent).toBe('刪掉並生成')
    fireEvent.click(screen.getByTestId('run-confirm-ok'))
    expect(onOk).toHaveBeenLastCalledWith(true)
  })

  it('先產生分鏡：白話說這一步只寫分鏡約多少錢、下一步才生圖片和影片約多少錢', () => {
    const onOk = vi.fn()
    render(
      <GrowConfirm
        pending={pending({
          stage: 'storyboard',
          check: check({ estimatedUsd: 0.04 }),
          nextUsd: 3.2,
        })}
        onOk={onOk}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading').textContent).toBe('先產生分鏡')
    expect(screen.getByText(/這一步只寫分鏡：把故事拆成 4 個鏡頭，約 US\$0\.04/)).toBeTruthy()
    expect(
      screen.getByText(/下一步才生圖片和影片：4 張第一張畫面、4 支影片，約 US\$3\.20/),
    ).toBeTruthy()
    expect(screen.getByText(/生成空的.*準確的預估/)).toBeTruthy()
    expect(screen.getByText(/旁白與配樂也不在這一步/)).toBeTruthy()
    // 不會出現整支的步驟
    expect(screen.queryByText('接成一支完整的片子')).toBeNull()
    expect(screen.getByTestId('run-confirm-ok').textContent).toBe('產生分鏡')
    fireEvent.click(screen.getByTestId('run-confirm-ok'))
    expect(onOk).toHaveBeenCalledWith(false)
  })

  it('一次做完整支：照舊列出每一步，確認鈕寫「全部做完」', () => {
    render(<GrowConfirm pending={pending()} onOk={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('heading').textContent).toBe('一次做完整支短片')
    expect(screen.getByTestId('run-confirm-ok').textContent).toBe('全部做完')
  })

  it('有些步驟估不出來 → 註明至少；示範模式註明不會花錢', () => {
    render(
      <GrowConfirm
        pending={pending({ check: check({ estimateIsLowerBound: true, demoMode: true }) })}
        onOk={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/至少，實際可能更多/)).toBeTruthy()
    expect(screen.getByText(/示範模式：不會真的花錢/)).toBeTruthy()
  })
})
