import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScriptStrip, segmentLabel } from './script-strip'
import { beat, take } from './shots.fixture'

afterEach(cleanup)

const draw = (beats = [beat(1, { segment: 'hook' })], extra: object = {}) =>
  render(
    <ScriptStrip
      beats={beats}
      selectedId={undefined}
      onSelect={() => undefined}
      availablePx={900}
      playheadSec={undefined}
      musicOn
      {...extra}
    />,
  )

describe('ScriptStrip：預告片腳本條', () => {
  it('還沒生成任何東西也畫得出來：每格一個按鈕、段落名、虛線框；點一格選它', () => {
    const onSelect = vi.fn()
    draw(
      [
        beat(1, { segment: 'hook', durationSec: 3 }),
        beat(2, { segment: 'world', durationSec: 2.5 }),
        beat(3, {
          segment: 'world',
          durationSec: 2.5,
          beatKind: 'card',
          card: { text: '字', subtext: '' },
        }),
      ],
      { onSelect },
    )
    expect(screen.getAllByTestId('strip-segment').map((n) => n.textContent)).toEqual([
      '鉤子',
      '世界',
    ])
    expect(screen.getByTestId('strip-cell-0').dataset.state).toBe('empty')
    expect(screen.getByTestId('strip-cell-2').dataset.kind).toBe('card')
    fireEvent.click(screen.getByTestId('strip-cell-1'))
    expect(onSelect).toHaveBeenCalledWith('s2')
    expect(screen.getByTestId('strip-music')).toBeTruthy()
  })

  it('四種格子分得出來（不只靠顏色）：標籤有種類與秒數；選到的 aria-pressed', () => {
    draw(
      [
        beat(1),
        beat(2, { beatKind: 'still' }),
        beat(3, { beatKind: 'card' }),
        beat(4, { beatKind: 'title' }),
      ],
      { selectedId: 's2' },
    )
    expect(screen.getByLabelText('第 1 格 · 會動 · 2 秒')).toBeTruthy()
    expect(screen.getByLabelText('第 2 格 · 不動 · 2 秒').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('第 3 格 · 字卡 · 2 秒')).toBeTruthy()
    expect(screen.getByLabelText('第 4 格 · 片名卡 · 2 秒')).toBeTruthy()
  })

  it('狀態：生成中、失敗（滑過看得到原因）、做好了、還沒做', () => {
    draw([
      beat(1, { status: 'generating' }),
      beat(2, { status: 'failed', error: '模型沒有回應' }),
      beat(3, { status: 'done', videos: [take('v3')] }),
      beat(4),
    ])
    const states = [0, 1, 2, 3].map((i) => screen.getByTestId(`strip-cell-${String(i)}`))
    expect(states.map((n) => n.dataset.state)).toEqual(['generating', 'failed', 'made', 'empty'])
    expect(states[1]?.getAttribute('title')).toContain('模型沒有回應')
  })

  it('旁白那一排只在有旁白的格子畫；沒開配樂就沒有配樂條；播放線在成品播放時才有', () => {
    draw([beat(1, { dialogue: '一句話' }), beat(2)], { musicOn: false, playheadSec: 1 })
    expect(screen.getAllByTestId('strip-narration').map((n) => n.dataset.has)).toEqual([
      'true',
      'false',
    ])
    expect(screen.queryByTestId('strip-music')).toBeNull()
    expect(screen.getByTestId('strip-playhead').getAttribute('style')).toContain('50%')
  })

  it('太窄時格子只留圖示；再窄只留色塊', () => {
    draw([
      beat(1, { durationSec: 29 }),
      beat(2, { durationSec: 0.67 }),
      beat(3, { durationSec: 0.3 }),
    ])
    expect(screen.getByTestId('strip-cell-0').dataset.fit).toBe('full')
    expect(screen.getByTestId('strip-cell-1').dataset.fit).toBe('block')
  })

  it('不認得的段落代號原樣顯示；沒有段落留空', () => {
    expect(segmentLabel('pull_quote')).toBe('pull_quote')
    expect(segmentLabel(undefined)).toBe('')
    expect(segmentLabel('montage')).toBe('快切')
  })
})
