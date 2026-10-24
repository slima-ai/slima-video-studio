import { setLocale, type AppErrorShape, type SoundShotView, type SoundState } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IpcCallError } from '../../lib/svs'
import { SoundTimeline } from './sound-timeline'

afterEach(() => {
  cleanup()
  setLocale('zh-TW')
})

const SETTINGS = {
  nativeAudio: true,
  nativeGainDb: 0,
  muteNativeShotIds: [],
  duck: true,
  narrationGainDb: 0,
  musicGainDb: -18,
}

const shotOf = (
  n: number,
  startSec: number,
  trim: { inSec: number; outSec: number } | undefined,
  videoSec = 5,
): SoundShotView => ({
  shotId: `s${String(n)}`,
  number: n,
  startSec,
  durationSec: trim ? trim.outSec - trim.inSec : videoSec,
  hasVideo: true,
  ...(trim
    ? {
        trim: {
          videoSec,
          inSec: trim.inSec,
          outSec: trim.outSec,
          trimmed: trim.inSec > 0 || trim.outSec < videoSec,
        },
      }
    : {}),
  dialogue: '',
  nativeMuted: false,
  sfx: [],
})

// 鏡 1 整支 5 秒；鏡 2 剪成 0–3 秒（影片 5 秒）；總長 8 秒
const stateOf = (shots: SoundShotView[]): SoundState => ({
  settings: SETTINGS,
  shots,
  totalSec: shots.reduce((sum, s) => sum + s.durationSec, 0),
  warnings: [],
  models: {},
})

const SHOTS = [shotOf(1, 0, { inSec: 0, outSec: 5 }), shotOf(2, 5, { inSec: 0, outSec: 3 })]

/** jsdom 沒有版面：讓時間軸那一條「寬 800 px」，8 秒就是每 100 px 一秒。 */
function withLaneWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 20,
    top: 0,
    left: 0,
    right: width,
    bottom: 20,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
}

function dragEdge(testId: string, from: number, to: number): HTMLElement {
  const edge = screen.getByTestId(testId)
  edge.setPointerCapture = vi.fn()
  fireEvent.pointerDown(edge, { pointerId: 1, clientX: from })
  fireEvent.pointerMove(edge, { pointerId: 1, clientX: to })
  return edge
}

describe('時間軸：秒數尺、格子的秒數、被剪掉的部分', () => {
  it('秒數尺從 0 起每 1 秒一格（8 秒的片子），標出秒數', () => {
    render(<SoundTimeline state={stateOf(SHOTS)} />)
    expect(screen.getByTestId('timeline-ruler').getAttribute('aria-label')).toBe('秒數尺')
    expect(screen.getByTestId('timeline-tick-0').textContent).toBe('0')
    expect(screen.getByTestId('timeline-tick-8').textContent).toBe('8')
    expect(screen.queryByTestId('timeline-tick-9')).toBeNull()
    // 位置依比例：第 4 秒在 8 秒片長的一半
    expect(screen.getByTestId('timeline-tick-4').style.left).toBe('50%')
  })

  it('每一格寫鏡號與成品用到的秒數，格寬照留下的長度', () => {
    render(<SoundTimeline state={stateOf(SHOTS)} />)
    expect(screen.getByTestId('timeline-secs-1').textContent).toBe('5.0')
    expect(screen.getByTestId('timeline-secs-2').textContent).toBe('3.0')
    const cell = screen.getByTestId('timeline-shot-2')
    expect([cell.style.left, cell.style.width]).toEqual(['62.5%', '37.5%'])
  })

  it('剪過的鏡頭在「剪掉」那一排有斜線塊（長度＝被剪掉的秒數）；沒有剪過的鏡頭就不出現那一排', () => {
    const { rerender } = render(<SoundTimeline state={stateOf(SHOTS)} />)
    const cut = screen.getByTestId('timeline-cut-2')
    expect(cut.getAttribute('title')).toBe('鏡 2 被剪掉的部分：2.0 秒')
    expect([cut.style.left, cut.style.width]).toEqual(['100%', '25%'])
    expect(screen.queryByTestId('timeline-cut-1')).toBeNull()
    rerender(<SoundTimeline state={stateOf([shotOf(1, 0, { inSec: 0, outSec: 5 })])} />)
    expect(screen.queryByText('剪掉')).toBeNull()
  })

  it('英文介面：尺與提示都是英文', () => {
    setLocale('en')
    render(<SoundTimeline state={stateOf(SHOTS)} />)
    expect(screen.getByTestId('timeline-ruler').getAttribute('aria-label')).toBe('Seconds ruler')
    expect(screen.getByTestId('timeline-cut-2').getAttribute('title')).toBe('Shot 2: 2.0 s cut off')
  })

  it('soundLanes=false（還沒有旁白與配樂）：只有尺、鏡頭、剪掉三條，沒有原聲／旁白／配樂', () => {
    render(<SoundTimeline state={stateOf(SHOTS)} soundLanes={false} />)
    expect(screen.getByTestId('timeline-shot-1')).not.toBeNull()
    expect(screen.getByTestId('timeline-cut-2')).not.toBeNull()
    expect(screen.queryByTestId('timeline-native-1')).toBeNull()
    expect(screen.queryByText('原聲')).toBeNull()
  })

  it('一分鐘以上的片子刻度寫「分:秒」', () => {
    render(<SoundTimeline state={stateOf([shotOf(1, 0, { inSec: 0, outSec: 130 }, 130)])} />)
    expect(screen.getByTestId('timeline-tick-60').textContent).toBe('1:00')
  })
})

describe('時間軸：拖格子邊緣剪頭尾', () => {
  it('沒給 onTrim（只讀）就沒有把手', () => {
    render(<SoundTimeline state={stateOf(SHOTS)} />)
    expect(screen.queryByTestId('timeline-edge-out-2')).toBeNull()
  })

  it('沒有影片長度資料的鏡頭沒有把手', () => {
    render(
      <SoundTimeline
        state={stateOf([shotOf(1, 0, undefined), shotOf(2, 5, { inSec: 0, outSec: 3 })])}
        onTrim={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('timeline-edge-out-1')).toBeNull()
    expect(screen.getByTestId('timeline-edge-out-2')).not.toBeNull()
  })

  it('拖出點把手：拖的過程只預覽（格寬與秒數跟著變、顯示提示），放開才存，存的是對齊格線的秒數', async () => {
    withLaneWidth(800)
    const onTrim = vi.fn().mockResolvedValue(undefined)
    render(<SoundTimeline state={stateOf(SHOTS)} onTrim={onTrim} />)
    // 往右 100 px ＝ +1 秒：鏡 2 的出點 3 → 4
    const edge = dragEdge('timeline-edge-out-2', 500, 600)
    expect(onTrim).not.toHaveBeenCalled()
    expect(screen.getByTestId('timeline-secs-2').textContent).toBe('4.0')
    expect(screen.getByTestId('timeline-edge-readout').textContent).toBe(
      '鏡 2：留下 0.0–4.0 秒，共 4.0 秒',
    )
    fireEvent.pointerUp(edge, { pointerId: 1 })
    await waitFor(() => {
      expect(onTrim).toHaveBeenCalledWith('s2', { outSec: 4 })
    })
    expect(onTrim).toHaveBeenCalledTimes(1)
  })

  it('拖到兩格之間：對齊到最近一格再存（+37 px ＝ 0.37 秒 → 3.375 秒，第 81 格）', async () => {
    withLaneWidth(800)
    const onTrim = vi.fn().mockResolvedValue(undefined)
    render(<SoundTimeline state={stateOf(SHOTS)} onTrim={onTrim} />)
    const edge = dragEdge('timeline-edge-out-2', 500, 537)
    fireEvent.pointerUp(edge, { pointerId: 1 })
    await waitFor(() => {
      expect(onTrim).toHaveBeenCalledWith('s2', { outSec: 3.375 })
    })
  })

  it('拖入點把手：往右 50 px ＝ 入點 +0.5 秒；格子寬度縮短', async () => {
    withLaneWidth(800)
    const onTrim = vi.fn().mockResolvedValue(undefined)
    render(<SoundTimeline state={stateOf(SHOTS)} onTrim={onTrim} />)
    const edge = dragEdge('timeline-edge-in-2', 500, 550)
    expect(screen.getByTestId('timeline-secs-2').textContent).toBe('2.5')
    fireEvent.pointerUp(edge, { pointerId: 1 })
    await waitFor(() => {
      expect(onTrim).toHaveBeenCalledWith('s2', { inSec: 0.5 })
    })
  })

  it('出點拖過影片長度會夾在影片長度（5 秒）；拖不到入點之前（至少留一格）', async () => {
    withLaneWidth(800)
    const onTrim = vi.fn().mockResolvedValue(undefined)
    render(<SoundTimeline state={stateOf(SHOTS)} onTrim={onTrim} />)
    let edge = dragEdge('timeline-edge-out-2', 500, 900)
    fireEvent.pointerUp(edge, { pointerId: 1 })
    await waitFor(() => {
      expect(onTrim).toHaveBeenLastCalledWith('s2', { outSec: 5 })
    })
    edge = dragEdge('timeline-edge-out-2', 500, -400)
    fireEvent.pointerUp(edge, { pointerId: 1 })
    await waitFor(() => {
      expect(onTrim).toHaveBeenLastCalledWith('s2', { outSec: 1 / 24 })
    })
  })

  it('拖了又拖回原位：不存', () => {
    withLaneWidth(800)
    const onTrim = vi.fn().mockResolvedValue(undefined)
    render(<SoundTimeline state={stateOf(SHOTS)} onTrim={onTrim} />)
    const edge = dragEdge('timeline-edge-out-2', 500, 600)
    fireEvent.pointerMove(edge, { pointerId: 1, clientX: 500 })
    fireEvent.pointerUp(edge, { pointerId: 1 })
    expect(onTrim).not.toHaveBeenCalled()
    expect(screen.queryByTestId('timeline-edge-readout')).toBeNull()
  })

  it('把手聚焦後 ← → 逐格調整，立刻存', async () => {
    const onTrim = vi.fn().mockResolvedValue(undefined)
    render(<SoundTimeline state={stateOf(SHOTS)} onTrim={onTrim} />)
    fireEvent.keyDown(screen.getByTestId('timeline-edge-out-2'), { key: 'ArrowRight' })
    await waitFor(() => {
      expect(onTrim).toHaveBeenCalledTimes(1)
    })
    const [shotId, edit] = onTrim.mock.calls[0] as [string, { outSec: number }]
    expect(shotId).toBe('s2')
    expect(edit.outSec).toBeCloseTo(3 + 1 / 24, 5)
    fireEvent.keyDown(screen.getByTestId('timeline-edge-in-2'), { key: 'ArrowRight' })
    await waitFor(() => {
      expect(onTrim).toHaveBeenCalledTimes(2)
    })
    const second = onTrim.mock.calls[1] as [string, { inSec: number }]
    expect(second[1].inSec).toBeCloseTo(1 / 24, 5)
  })

  it('存失敗：用白話顯示原因，把手還在可以再試', async () => {
    withLaneWidth(800)
    const onTrim = vi
      .fn()
      .mockRejectedValue(new IpcCallError({ userMessage: '剪完不到一格' } as AppErrorShape))
    render(<SoundTimeline state={stateOf(SHOTS)} onTrim={onTrim} />)
    const edge = dragEdge('timeline-edge-out-2', 500, 600)
    fireEvent.pointerUp(edge, { pointerId: 1 })
    expect((await screen.findByTestId('timeline-edge-error')).textContent).toBe('剪完不到一格')
    expect(screen.getByTestId<HTMLButtonElement>('timeline-edge-out-2').disabled).toBe(false)
  })
})
