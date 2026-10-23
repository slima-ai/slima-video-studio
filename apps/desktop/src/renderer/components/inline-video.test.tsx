import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InlineVideo } from './inline-video'

const play = vi.fn<() => Promise<void>>()
const pause = vi.fn()
beforeEach(() => {
  play.mockReset()
  play.mockResolvedValue(undefined)
  pause.mockReset()
  // jsdom 沒有實作影片播放
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause })
})
afterEach(cleanup)

const mount = (onPlayingChange?: (playing: boolean) => void) => {
  const view = render(
    <InlineVideo
      src="svs-asset://asset/abc"
      label="Film"
      {...(onPlayingChange ? { onPlayingChange } : {})}
    />,
  )
  const video = screen.getByTestId<HTMLVideoElement>('inline-video')
  Object.defineProperty(video, 'duration', { configurable: true, value: 37.25 })
  fireEvent.loadedMetadata(video)
  return { ...view, video }
}

const start = (video: HTMLVideoElement): void => {
  fireEvent.click(screen.getByTestId('inline-video-play'))
  fireEvent.play(video)
}

describe('InlineVideo', () => {
  it('平時只有第一格和 ▶ 鈕，沒有控制列；點 ▶ 就播、出現控制列、▶ 收起來', () => {
    const changed = vi.fn()
    const { video } = mount(changed)
    expect(video.controls).toBe(false)
    expect(video.getAttribute('src')).toBe('svs-asset://asset/abc')
    expect(screen.queryByTestId('inline-video-controls')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '播放影片' }))
    expect(play).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('inline-video-play')).toBeNull()
    expect(screen.getByTestId('inline-video-controls')).toBeTruthy()
    expect(changed).toHaveBeenLastCalledWith(true)
  })

  it('控制列：暫停／繼續、進度可拖、時間、靜音、音量', () => {
    const { video } = mount()
    start(video)
    // 播放中顯示「暫停」；按下去真的呼叫 pause，影片觸發 pause 事件後變成「播放影片」
    const toggle = screen.getByTestId('inline-video-toggle')
    expect(toggle.getAttribute('aria-label')).toBe('暫停')
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent.click(toggle)
    expect(pause).toHaveBeenCalledTimes(1)
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
    fireEvent.pause(video)
    expect(toggle.getAttribute('aria-label')).toBe('播放影片')
    play.mockClear()
    fireEvent.click(toggle)
    expect(play).toHaveBeenCalledTimes(1)

    // 進度：拖到 12.5 秒 → 影片跳過去，時間顯示跟著變
    const seek = screen.getByTestId<HTMLInputElement>('inline-video-seek')
    expect(seek.max).toBe('37.25')
    fireEvent.change(seek, { target: { value: '12.5' } })
    expect(video.currentTime).toBe(12.5)
    expect(screen.getByTestId('inline-video-time').textContent).toBe('0:12 / 0:37')

    // 音量：拖到 0.3；拖到 0 等於靜音；按靜音鈕切換
    const volume = screen.getByTestId<HTMLInputElement>('inline-video-volume')
    fireEvent.change(volume, { target: { value: '0.3' } })
    expect(video.volume).toBeCloseTo(0.3)
    fireEvent.volumeChange(video)
    expect(screen.getByTestId('inline-video-mute').getAttribute('aria-label')).toBe('靜音')
    fireEvent.click(screen.getByTestId('inline-video-mute'))
    expect(video.muted).toBe(true)
    fireEvent.volumeChange(video)
    expect(screen.getByTestId('inline-video-mute').getAttribute('aria-label')).toBe('取消靜音')
    fireEvent.change(volume, { target: { value: '0' } })
    expect(video.muted).toBe(true)
  })

  it('點影片本身也是暫停／繼續（開始之前點影片不會播，要按 ▶）', () => {
    const { video } = mount()
    fireEvent.click(video)
    expect(play).not.toHaveBeenCalled()
    start(video)
    play.mockClear()
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent.click(video)
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('播完回到 ▶；播不起來（瀏覽器擋住）也回到 ▶，不會留著一條空的控制列', async () => {
    const { video } = mount()
    start(video)
    fireEvent.ended(video)
    expect(screen.queryByTestId('inline-video-controls')).toBeNull()
    expect(screen.getByTestId('inline-video-play')).toBeTruthy()

    play.mockRejectedValueOnce(new Error('NotAllowedError'))
    fireEvent.click(screen.getByTestId('inline-video-play'))
    await vi.waitFor(() => {
      expect(screen.queryByTestId('inline-video-controls')).toBeNull()
    })
    expect(screen.getByTestId('inline-video-play')).toBeTruthy()
  })

  it('影片、▶、整條控制列、每個控制項都標了 nodrag／nopan：放在畫布卡片上，按它們、拖進度與音量不會拖到卡片或畫布', () => {
    const { video } = mount()
    for (const cls of ['nodrag', 'nowheel', 'nopan']) expect(video.className).toContain(cls)
    for (const cls of ['nodrag', 'nopan']) {
      expect(screen.getByTestId('inline-video-play').className).toContain(cls)
    }
    start(video)
    for (const id of ['controls', 'seek', 'toggle', 'mute', 'volume']) {
      const el = screen.getByTestId(`inline-video-${id}`)
      for (const cls of ['nodrag', 'nopan']) expect(el.className, `${id} ${cls}`).toContain(cls)
    }
    for (const id of ['controls', 'seek', 'volume']) {
      expect(screen.getByTestId(`inline-video-${id}`).className, id).toContain('nowheel')
    }
  })
})
