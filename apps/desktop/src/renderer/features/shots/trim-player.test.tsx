import { setLocale, type ShotView, type TakeView } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { TrimPlayer } from './trim-player'

afterEach(cleanup)

const HASH = 'b'.repeat(64)

const takeOf = (extra: Partial<TakeView> = {}): TakeView => ({
  id: 'video-1',
  kind: 'video',
  version: 1,
  assetHash: HASH,
  adopted: true,
  modelId: 'fal/kling-3.0-standard',
  createdAt: '2026-10-24T00:00:00.000Z',
  videoSec: 5.041667,
  ...extra,
})

const shotOf = (take: TakeView): ShotView =>
  ({ id: 's5', number: 5, videos: [take] }) as unknown as ShotView

/** `shots.trim` 的假回應：只有畫面用得到的欄位。 */
const outcome = (extra: Record<string, unknown> = {}) => ({
  fps: 24,
  adjustments: [],
  startSec: 0,
  endSec: 3.5,
  lengthSec: 3.5,
  frames: 84,
  videoSec: 5.041667,
  ...extra,
})

function setup(
  take: TakeView = takeOf(),
  handler: (payload: unknown) => unknown = () => outcome(),
) {
  const svs = installFakeSvs({ 'shots.trim': handler })
  render(<TrimPlayer shot={shotOf(take)} take={take} videoTestId="shot-preview" />)
  const video = screen.getByTestId<HTMLVideoElement>('shot-preview')
  const pause = vi.fn()
  let time = 0
  Object.defineProperty(video, 'currentTime', {
    get: () => time,
    set: (value: number) => {
      time = value
    },
    configurable: true,
  })
  video.pause = pause
  return { svs, video, pause, setTime: (value: number) => (time = value), getTime: () => time }
}

const trims = (svs: ReturnType<typeof installFakeSvs>) => svs.payloadsOf('shots.trim')

describe('TrimPlayer：頭尾裁切', () => {
  it('沒裁的影片：時間尺把手在兩端、欄位是 0.0 與影片長度、說整支都用（5.042 秒、121 格），重設按不了', () => {
    setup()
    expect(screen.getByTestId('trim-in')).toHaveProperty('value', '0.0')
    expect(screen.getByTestId('trim-out')).toHaveProperty('value', '5.042')
    expect(screen.getByTestId('trim-summary').textContent).toBe('整支都用：5.042 秒、121 格')
    expect(screen.getByTestId('trim-reset')).toHaveProperty('disabled', true)
    expect(screen.getByTestId('trim-handle-in').getAttribute('aria-valuenow')).toBe('0')
    expect(screen.getByTestId('trim-handle-out').getAttribute('aria-valuenow')).toBe('5.041667')
    expect(screen.getByTestId('trim-kept').getAttribute('style')).toContain('left: 0%')
  })

  it('裁過的影片：欄位、摘要、把手位置都照裁切；重設可以按', () => {
    setup(takeOf({ trim: { inSec: 0.5, outSec: 3.5 } }))
    expect(screen.getByTestId('trim-in')).toHaveProperty('value', '0.5')
    expect(screen.getByTestId('trim-out')).toHaveProperty('value', '3.5')
    expect(screen.getByTestId('trim-summary').textContent).toBe('留下 0.5–3.5 秒：3.0 秒、72 格')
    expect(screen.getByTestId('trim-reset')).toHaveProperty('disabled', false)
  })

  it('「設為出點」：用播放位置所在那一格；沒有確認框，直接存', async () => {
    const { svs, setTime } = setup()
    setTime(3.5 + 0.25 / 24)
    fireEvent.click(screen.getByTestId('trim-set-out'))
    await waitFor(() => {
      expect(trims(svs)).toEqual([{ shotId: 's5', edit: { outSec: 3.5 } }])
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('「設為入點」：用播放位置所在那一格', async () => {
    const { svs, setTime } = setup()
    setTime(1)
    fireEvent.click(screen.getByTestId('trim-set-in'))
    await waitFor(() => {
      expect(trims(svs)).toEqual([{ shotId: 's5', edit: { inSec: 1 } }])
    })
  })

  it('快捷鍵的小標籤寫成「I 鍵」「O 鍵」（單寫 O 會被看成數字 0）；英文是 Key I、Key O', () => {
    setup()
    const label = (id: string) => screen.getByTestId(id).querySelector('kbd')?.textContent
    expect(label('trim-set-in')).toBe('I 鍵')
    expect(label('trim-set-out')).toBe('O 鍵')
    cleanup()
    setLocale('en')
    setup()
    expect(label('trim-set-in')).toBe('Key I')
    expect(label('trim-set-out')).toBe('Key O')
    setLocale('zh-TW')
  })

  it('I、O 快捷鍵：焦點在影片上按 i／o 等於按那兩顆按鈕；打字的時候不攔', async () => {
    const { svs, video, setTime } = setup()
    setTime(2)
    fireEvent.keyDown(video, { key: 'i' })
    await waitFor(() => {
      expect(trims(svs)).toHaveLength(1)
    })
    setTime(4)
    fireEvent.keyDown(video, { key: 'O' })
    await waitFor(() => {
      expect(trims(svs)).toEqual([
        { shotId: 's5', edit: { inSec: 2 } },
        { shotId: 's5', edit: { outSec: 4 } },
      ])
    })
    fireEvent.keyDown(screen.getByTestId('trim-in'), { key: 'i' })
    fireEvent.keyDown(video, { key: 'i', metaKey: true })
    expect(trims(svs)).toHaveLength(2)
  })

  it('← → 逐格移動播放位置（暫停、不改裁切）：一格是 1/24 秒', () => {
    const { svs, video, pause, setTime, getTime } = setup()
    setTime(1)
    fireEvent.keyDown(video, { key: 'ArrowRight' })
    expect(pause).toHaveBeenCalled()
    expect(Math.round(getTime() * 24)).toBe(25) // 第 24 格 + 1 格 = 第 25 格（落在格子裡面）
    fireEvent.keyDown(video, { key: 'ArrowLeft' })
    fireEvent.keyDown(video, { key: 'ArrowLeft' })
    expect(Math.floor(getTime() * 24 + 1e-3)).toBe(23)
    setTime(0)
    fireEvent.keyDown(video, { key: 'ArrowLeft' })
    expect(Math.floor(getTime() * 24 + 1e-3)).toBe(0)
    expect(trims(svs)).toEqual([])
  })

  it('數字欄位：打 3.5 按 Enter 存出點；離開欄位（blur）也存；沒改就不存', async () => {
    const { svs } = setup()
    const out = screen.getByTestId('trim-out')
    fireEvent.change(out, { target: { value: '3.5' } })
    fireEvent.keyDown(out, { key: 'Enter' })
    await waitFor(() => {
      expect(trims(svs)).toEqual([{ shotId: 's5', edit: { outSec: 3.5 } }])
    })
    const input = screen.getByTestId('trim-in')
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(trims(svs)).toHaveLength(2)
    })
    expect(trims(svs)[1]).toEqual({ shotId: 's5', edit: { inSec: 1 } })
    const same = screen.getByTestId('trim-out')
    fireEvent.change(same, { target: { value: '5.042' } })
    fireEvent.blur(same)
    expect(trims(svs)).toHaveLength(2)
  })

  it('數字欄位打了不是數字：說明、不送出、欄位回到原來的值', async () => {
    const { svs } = setup(takeOf({ trim: { outSec: 3.5 } }))
    const out = screen.getByTestId('trim-out')
    fireEvent.change(out, { target: { value: '三點五' } })
    fireEvent.keyDown(out, { key: 'Enter' })
    expect((await screen.findByTestId('trim-error')).textContent).toBe('請輸入秒數（例如 3.5）。')
    expect(trims(svs)).toEqual([])
    expect(screen.getByTestId('trim-out')).toHaveProperty('value', '3.5')
  })

  it('重設：送 clear，不問「確定嗎」', async () => {
    const { svs } = setup(takeOf({ trim: { outSec: 3.5 } }))
    fireEvent.click(screen.getByTestId('trim-reset'))
    await waitFor(() => {
      expect(trims(svs)).toEqual([{ shotId: 's5', edit: { clear: true } }])
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('伺服器改了打的數字（對齊格線、超過影片長度）：照實說，不悄悄改', async () => {
    setup(takeOf(), () =>
      outcome({
        adjustments: [{ reason: 'snapped', field: 'outSec', from: 3.51, to: 3.5 }],
      }),
    )
    const out = screen.getByTestId('trim-out')
    fireEvent.change(out, { target: { value: '3.51' } })
    fireEvent.keyDown(out, { key: 'Enter' })
    expect((await screen.findByTestId('trim-note')).textContent).toBe(
      '3.51 秒對齊到影片的格線，改用 3.5 秒。',
    )
    cleanup()
    setup(takeOf(), () =>
      outcome({ adjustments: [{ reason: 'clamped', field: 'outSec', from: 9, to: 5.041667 }] }),
    )
    const again = screen.getByTestId('trim-out')
    fireEvent.change(again, { target: { value: '9' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect((await screen.findByTestId('trim-note')).textContent).toBe(
      '9.0 秒超過影片長度，改用 5.042 秒。',
    )
  })

  it('伺服器擋下（入點不早於出點）：把原因寫出來，欄位回到存著的值', async () => {
    setup(takeOf({ trim: { outSec: 3.5 } }), () => {
      throw appError('這樣剪完不剩任何畫面：入點要比出點早，而且至少要留一格。')
    })
    const input = screen.getByTestId('trim-in')
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect((await screen.findByTestId('trim-error')).textContent).toContain('入點要比出點早')
    expect(screen.getByTestId('trim-in')).toHaveProperty('value', '0.0')
  })

  it('拖出點把手：放開時才存（拖的時候影片跟著移到那一格）；對齊到格線；不能拖過入點', async () => {
    const { svs, getTime } = setup(takeOf({ trim: { inSec: 1 } }))
    const track = screen.getByTestId('trim-track')
    track.getBoundingClientRect = () =>
      ({ left: 100, width: 504.1667, top: 0, height: 36, right: 604.1667, bottom: 36 }) as DOMRect
    const handle = screen.getByTestId('trim-handle-out')
    handle.setPointerCapture = vi.fn()
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 604 })
    // 504.1667 px 代表 5.041667 秒：100 px ＝ 1 秒 → 450 px 是 3.5 秒
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 + 350.2 })
    expect(trims(svs)).toEqual([])
    expect(getTime()).toBeCloseTo(3.5, 2)
    fireEvent.pointerUp(handle, { pointerId: 1 })
    await waitFor(() => {
      expect(trims(svs)).toEqual([{ shotId: 's5', edit: { outSec: 3.5 } }])
    })
    // 往左拖過頭：停在入點後一格
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 604 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    await waitFor(() => {
      expect(trims(svs)).toHaveLength(2)
    })
    const second = trims(svs)[1] as { edit: { outSec: number } }
    expect(second.edit.outSec).toBeCloseTo(1 + 1 / 24, 5)
  })

  it('拖入點把手：只改入點；沒移動就放開不存', async () => {
    const { svs } = setup()
    const track = screen.getByTestId('trim-track')
    track.getBoundingClientRect = () =>
      ({ left: 0, width: 504.1667, top: 0, height: 36, right: 504.1667, bottom: 36 }) as DOMRect
    const handle = screen.getByTestId('trim-handle-in')
    handle.setPointerCapture = vi.fn()
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(trims(svs)).toEqual([])
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    await waitFor(() => {
      expect(trims(svs)).toEqual([{ shotId: 's5', edit: { inSec: 1 } }])
    })
  })

  it('把手上按 ← →：移動一格並存（滑桿的鍵盤操作）；不蓋掉影片的播放鍵', async () => {
    const { svs } = setup(takeOf({ trim: { outSec: 3.5 } }))
    const handle = screen.getByTestId('trim-handle-out')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    await waitFor(() => {
      expect(trims(svs)).toHaveLength(1)
    })
    const edit = (trims(svs)[0] as { edit: { outSec: number } }).edit
    expect(edit.outSec).toBeCloseTo(3.5 - 1 / 24, 5)
  })

  it('點時間尺：播放位置移到那裡，焦點回到影片（I、O 才有人接）', () => {
    const { video, getTime } = setup()
    const track = screen.getByTestId('trim-track')
    track.getBoundingClientRect = () =>
      ({ left: 0, width: 504.1667, top: 0, height: 36, right: 504.1667, bottom: 36 }) as DOMRect
    fireEvent.pointerDown(track, { clientX: 250, pointerId: 1 })
    expect(getTime()).toBeCloseTo(2.5, 1)
    expect(document.activeElement).toBe(video)
  })

  it('只播留下的部分：從頭播時跳到入點；播到出點就停', () => {
    const { video, setTime, getTime } = setup(takeOf({ trim: { inSec: 1, outSec: 3 } }))
    fireEvent.click(screen.getByTestId('trim-only-kept'))
    setTime(0)
    fireEvent.play(video)
    expect(getTime()).toBe(1)
    // 播到出點之後：下一次開始播又回到入點
    setTime(3)
    fireEvent.pause(video)
    fireEvent.play(video)
    expect(getTime()).toBe(1)
    // 沒打勾：從哪裡播就從哪裡播
    fireEvent.click(screen.getByTestId('trim-only-kept'))
    setTime(0)
    fireEvent.play(video)
    expect(getTime()).toBe(0)
  })

  it('只播留下的部分：播放時超過出點就暫停在出點', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb)
      return frames.length
    })
    const { video, pause, setTime, getTime } = setup(takeOf({ trim: { inSec: 1, outSec: 3 } }))
    fireEvent.click(screen.getByTestId('trim-only-kept'))
    setTime(1)
    fireEvent.play(video)
    setTime(3.02)
    await act(async () => {
      frames.splice(0).forEach((cb) => {
        cb(0)
      })
      await Promise.resolve()
    })
    expect(pause).toHaveBeenCalled()
    expect(getTime()).toBe(3)
    vi.restoreAllMocks()
  })

  it('影片長度不明（量不到）：把手與欄位先停用，等影片載入完（loadedmetadata）才有範圍', () => {
    setup(takeOf({ videoSec: undefined as never }))
    expect(screen.getByTestId('trim-handle-in')).toHaveProperty('disabled', true)
    expect(screen.getByTestId('trim-set-out')).toHaveProperty('disabled', true)
    const video = screen.getByTestId<HTMLVideoElement>('shot-preview')
    Object.defineProperty(video, 'duration', { value: 5.042, configurable: true })
    fireEvent.loadedMetadata(video)
    expect(screen.getByTestId('trim-handle-in')).toHaveProperty('disabled', false)
    expect(screen.getByTestId('trim-out')).toHaveProperty('value', '5.042')
  })
})
