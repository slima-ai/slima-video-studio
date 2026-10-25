import { setLocale, type AppErrorShape, type SoundShotView, type SoundState } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'

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
    // 「Cut off」會被讀成「被截斷」，改叫 Trimmed
    expect(screen.getByText('Trimmed')).toBeTruthy()
    expect(screen.queryByText('Cut off')).toBeNull()
  })

  it('part=film（時間軸小標下）：只有尺、鏡頭、剪掉三條；part=sound（聲音小標下）：只有原聲、旁白、配樂', () => {
    const film = render(<SoundTimeline state={stateOf(SHOTS)} part="film" />)
    expect(screen.getByTestId('film-timeline').getAttribute('aria-label')).toBe('時間軸')
    expect(screen.getByTestId('timeline-ruler')).not.toBeNull()
    expect(screen.getByTestId('timeline-shot-1')).not.toBeNull()
    expect(screen.getByTestId('timeline-cut-2')).not.toBeNull()
    expect(screen.queryByTestId('timeline-native-1')).toBeNull()
    expect(screen.queryByText('原聲')).toBeNull()
    film.unmount()
    render(<SoundTimeline state={stateOf(SHOTS)} part="sound" onTrim={vi.fn()} />)
    expect(screen.getByTestId('sound-timeline')).not.toBeNull()
    expect(screen.getByTestId('timeline-native-1')).not.toBeNull()
    expect(screen.queryByTestId('timeline-ruler')).toBeNull()
    expect(screen.queryByTestId('timeline-shot-1')).toBeNull()
    expect(screen.queryByTestId('timeline-edge-out-2')).toBeNull()
  })

  it('「剪掉」的斜線塊對比夠：用前景色混出的粗條紋加 50% 前景色的框，不是淡淡的邊框色', () => {
    render(<SoundTimeline state={stateOf(SHOTS)} part="film" />)
    const cls = screen.getByTestId('timeline-cut-2').className
    expect(cls).toContain('var(--color-fg)')
    expect(cls).toContain('border-fg/50')
    expect(cls).not.toContain('var(--color-border)')
    expect(cls).not.toContain('opacity-')
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

describe('時間軸：格子裡的字放不下就少寫，不切掉數字', () => {
  /** jsdom 沒有版面：依元素（格子或兩段字）回報我們指定的寬度。 */
  function withSizes(sizes: { cell: Record<string, number>; number: number; secs: number }) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      const id = this.dataset.testid ?? ''
      const n = /^timeline-shot-(\d+)$/.exec(id)?.[1]
      return n ? (sizes.cell[n] ?? 0) : 0
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const id = this.dataset.testid ?? ''
      const width = id.startsWith('timeline-secs-')
        ? sizes.secs
        : this.parentElement?.dataset.testid?.startsWith('timeline-label-')
          ? sizes.number
          : 0
      return {
        width,
        height: 20,
        top: 0,
        left: 0,
        right: width,
        bottom: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    })
  }
  const fitOf = (n: number) => screen.getByTestId(`timeline-label-${String(n)}`).dataset.fit

  it('夠寬：鏡號與秒數都寫；放不下秒數：只寫鏡號；連鏡號都放不下：都不寫（兩段字照量到的寬度算）', () => {
    // 鏡號 8 px、秒數 20 px、中間空 4 px → 全寫要 32 px，再加左右把手與內距 16 px ＝ 格子至少 48 px
    withSizes({ cell: { '1': 80, '2': 47, '3': 24, '4': 23 }, number: 8, secs: 20 })
    const shots = [1, 2, 3, 4].map((n) => shotOf(n, (n - 1) * 3, { inSec: 0, outSec: 3 }, 3))
    render(<SoundTimeline state={stateOf(shots)} part="film" onTrim={vi.fn()} />)
    expect(fitOf(1)).toBe('full')
    expect(fitOf(2)).toBe('number') // 47 px：全寫差 1 px，寧可只寫鏡號也不切掉秒數
    expect(fitOf(3)).toBe('number') // 24 px：鏡號 8 px ＋ 16 px 剛好放得下
    expect(fitOf(4)).toBe('none') // 23 px：差 1 px 連鏡號都放不下
  })

  it('沒寫出來的那段字只是看不見（invisible），內容還在，提示（title）照樣有完整秒數', () => {
    withSizes({ cell: { '1': 30, '2': 30 }, number: 8, secs: 20 })
    render(
      <SoundTimeline
        state={stateOf([
          shotOf(1, 0, { inSec: 0, outSec: 3 }, 3),
          shotOf(2, 3, { inSec: 0, outSec: 2 }, 3),
        ])}
        part="film"
        onTrim={vi.fn()}
      />,
    )
    expect(fitOf(2)).toBe('number')
    const secs = screen.getByTestId('timeline-secs-2')
    expect(secs.className).toContain('invisible')
    expect(secs.textContent).toBe('2.0')
    expect(screen.getByTestId('timeline-shot-2').getAttribute('title')).toBe(
      '鏡 2：成品用 2.0 秒（整支 3.0 秒）',
    )
  })

  it('格子變寬就重新量：從放不下變成放得下', () => {
    withSizes({ cell: { '1': 30 }, number: 8, secs: 20 })
    const shots = [shotOf(1, 0, { inSec: 0, outSec: 3 }, 3)]
    const view = render(<SoundTimeline state={stateOf(shots)} part="film" onTrim={vi.fn()} />)
    expect(fitOf(1)).toBe('number')
    vi.restoreAllMocks()
    withSizes({ cell: { '1': 200 }, number: 8, secs: 20 })
    view.rerender(
      <SoundTimeline
        state={stateOf([shotOf(1, 0, { inSec: 0, outSec: 2.5 }, 3)])}
        part="film"
        onTrim={vi.fn()}
      />,
    )
    expect(fitOf(1)).toBe('full')
  })
})

describe('時間軸：選一格按空白鍵，播那一鏡自己的影片、只播留下的段落', () => {
  const HASH = 'a'.repeat(64)
  const times = new WeakMap<HTMLMediaElement, number>()
  let play: MockInstance<HTMLMediaElement['play']>
  let pause: MockInstance<HTMLMediaElement['pause']>
  let frames: (() => void)[] = []

  function setup() {
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      return times.get(this) ?? 0
    })
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation(function (
      this: HTMLMediaElement,
      value: number,
    ) {
      times.set(this, value)
    })
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    frames = []
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  /** 跑掉排隊中的那一格動畫回呼。 */
  const runFrame = () => {
    const queued = frames
    frames = []
    act(() => {
      for (const callback of queued) callback()
    })
  }

  // 鏡 1 整支 5 秒；鏡 2 剪成 0.5–3 秒；鏡 3 沒有影片
  const withVideo = (shot: SoundShotView): SoundShotView => ({ ...shot, videoHash: HASH })
  const PLAYABLE = [
    withVideo(shotOf(1, 0, { inSec: 0, outSec: 5 })),
    withVideo(shotOf(2, 5, { inSec: 0.5, outSec: 3 })),
    { ...shotOf(3, 7.5, undefined), hasVideo: false },
  ]
  const cell = (n: number) => screen.getByTestId(`timeline-shot-${String(n)}`)
  const video = () => screen.getByTestId<HTMLVideoElement>('timeline-preview')

  it('有影片的格子是可選的按鈕（寫了怎麼播）；沒有影片的格子不是', () => {
    setup()
    render(<SoundTimeline state={stateOf(PLAYABLE)} part="film" />)
    expect(cell(1).getAttribute('role')).toBe('button')
    expect(cell(1).getAttribute('aria-label')).toBe('鏡 1：選取後按空白鍵播放留下的部分')
    expect(cell(3).getAttribute('role')).toBeNull()
    expect(screen.queryByTestId('timeline-preview')).toBeNull()
  })

  it('點一格：選取，出現那一鏡自己的影片（停在入點）與說明；還沒播', () => {
    setup()
    render(<SoundTimeline state={stateOf(PLAYABLE)} part="film" />)
    fireEvent.click(cell(2))
    expect(cell(2).dataset.selected).toBe('true')
    expect(video().getAttribute('src')).toBe(`svs-asset://asset/${HASH}`)
    expect(video().currentTime).toBe(0.5)
    expect(screen.getByTestId('timeline-play-hint').textContent).toBe(
      '空白鍵播放／暫停：只播留下的 0.5–3.0 秒（鏡 2）',
    )
    expect(play).not.toHaveBeenCalled()
  })

  it('沒選的格子按空白鍵：選取並從入點開始播；再按一次暫停；再按從暫停處接著播', async () => {
    setup()
    render(<SoundTimeline state={stateOf(PLAYABLE)} part="film" />)
    fireEvent.keyDown(cell(2), { key: ' ' })
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1)
    })
    expect(video().currentTime).toBe(0.5)
    times.set(video(), 1.7)
    fireEvent.keyDown(cell(2), { key: ' ' })
    expect(pause).toHaveBeenCalled()
    fireEvent.keyDown(cell(2), { key: ' ' })
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(2)
    })
    expect(video().currentTime).toBe(1.7)
  })

  it('只播留下的段落：播到出點（3 秒）就停在出點；再按空白鍵從入點重播', async () => {
    setup()
    render(<SoundTimeline state={stateOf(PLAYABLE)} part="film" />)
    fireEvent.keyDown(cell(2), { key: ' ' })
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(frames.length).toBeGreaterThan(0)
    })
    const pausedBefore = pause.mock.calls.length
    times.set(video(), 2.5)
    runFrame()
    expect(pause.mock.calls.length).toBe(pausedBefore) // 還沒到出點，繼續播
    times.set(video(), 3.004)
    runFrame()
    expect(pause.mock.calls.length).toBe(pausedBefore + 1)
    expect(video().currentTime).toBe(3)
    fireEvent.keyDown(cell(2), { key: ' ' })
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(2)
    })
    expect(video().currentTime).toBe(0.5)
  })

  it('換選另一格：停下、新的那一鏡回到它自己的入點；鏡 1 沒剪（整支 0–5 秒）', async () => {
    setup()
    render(<SoundTimeline state={stateOf(PLAYABLE)} part="film" />)
    fireEvent.keyDown(cell(2), { key: ' ' })
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(cell(1))
    expect(cell(1).dataset.selected).toBe('true')
    expect(cell(2).dataset.selected).toBe('false')
    expect(pause).toHaveBeenCalled()
    expect(screen.getByTestId('timeline-play-hint').textContent).toBe(
      '空白鍵播放／暫停：只播留下的 0.0–5.0 秒（鏡 1）',
    )
  })

  it('把手上的按鍵（← → 逐格）不會觸發播放；沒有影片的格子按空白鍵沒反應', () => {
    setup()
    render(
      <SoundTimeline
        state={stateOf(PLAYABLE)}
        part="film"
        onTrim={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    fireEvent.keyDown(screen.getByTestId('timeline-edge-out-2'), { key: ' ' })
    fireEvent.keyDown(cell(3), { key: ' ' })
    expect(screen.queryByTestId('timeline-preview')).toBeNull()
    expect(play).not.toHaveBeenCalled()
  })

  it('說明句的秒數一律一位小數：沒剪的鏡出點是影片實際長度 5.042 秒，寫成 5.0（跟面板的「留下 0.0–3.5 秒」一致）', () => {
    setup()
    render(
      <SoundTimeline
        state={stateOf([withVideo(shotOf(1, 0, { inSec: 0, outSec: 5.042 }))])}
        part="film"
      />,
    )
    fireEvent.click(cell(1))
    expect(screen.getByTestId('timeline-play-hint').textContent).toBe(
      '空白鍵播放／暫停：只播留下的 0.0–5.0 秒（鏡 1）',
    )
  })

  it('點一下預覽 = 按空白鍵：游標是手指；點一下播（從入點）、再點暫停、播到出點停住後再點從入點重播', async () => {
    setup()
    render(<SoundTimeline state={stateOf(PLAYABLE)} part="film" />)
    fireEvent.click(cell(2))
    expect(video().className).toContain('cursor-pointer')
    expect(video().hasAttribute('controls')).toBe(false)
    fireEvent.click(video())
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1)
    })
    expect(video().currentTime).toBe(0.5)
    await waitFor(() => {
      expect(frames.length).toBeGreaterThan(0)
    })
    fireEvent.click(video())
    expect(pause).toHaveBeenCalled()
    // 播到出點：停在出點；再點預覽從入點重播（跟空白鍵一樣）
    fireEvent.click(video())
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(frames.length).toBeGreaterThan(0)
    })
    times.set(video(), 3.004)
    runFrame()
    expect(video().currentTime).toBe(3)
    fireEvent.click(video())
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(3)
    })
    expect(video().currentTime).toBe(0.5)
  })

  it('右鍵選單的「播放」、媒體鍵（不經過 togglePlay 的 play）在出點或範圍外也退回入點；快轉不能超過出點、倒轉不能低過入點', () => {
    setup()
    render(<SoundTimeline state={stateOf(PLAYABLE)} part="film" />)
    fireEvent.click(cell(2))
    // 停在出點時從瀏覽器自己的「播放」開始
    times.set(video(), 3)
    fireEvent.play(video())
    expect(video().currentTime).toBe(0.5)
    // 媒體鍵快轉到範圍外
    times.set(video(), 4.2)
    fireEvent.seeked(video())
    expect(video().currentTime).toBe(3)
    // 倒轉到入點之前
    times.set(video(), 0.1)
    fireEvent.seeked(video())
    expect(video().currentTime).toBe(0.5)
    // 範圍內不動
    times.set(video(), 1.5)
    fireEvent.seeked(video())
    expect(video().currentTime).toBe(1.5)
  })

  it('part=sound（聲音那一塊）沒有播放功能', () => {
    setup()
    render(<SoundTimeline state={stateOf(PLAYABLE)} part="sound" />)
    expect(screen.queryByTestId('timeline-shot-1')).toBeNull()
    expect(screen.queryByTestId('timeline-preview')).toBeNull()
  })
})
