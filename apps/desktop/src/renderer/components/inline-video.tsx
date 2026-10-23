import { t } from '@svs/schema'
import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '../lib/cn'

export interface InlineVideoProps {
  src: string
  /** 影片的名字（給讀屏軟體）。 */
  label: string
  /** 外框的尺寸與外觀（要有寬度；畫面固定 16:9）。 */
  className?: string
  /** 開始或結束播放時通知（讓外面的版面跟著放大）。 */
  onPlayingChange?: (playing: boolean) => void
}

const clock = (sec: number): string => {
  const whole = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`
}

// 影片和每個控制項都標 nodrag／nopan（和 nowheel）：放在畫布的卡片上，按它們、拖進度條或音量
// 都不會拖到卡片或畫布。
const NO_CANVAS = 'nodrag nopan nowheel'
const BUTTON =
  'nodrag nopan flex size-6 shrink-0 items-center justify-center rounded text-white hover:bg-white/20'
const RANGE = 'nodrag nopan nowheel h-3 min-w-0 cursor-pointer accent-white'

/**
 * 在原地播放的影片：平時是第一格加一個 ▶ 鈕；按下去就開始播，底下出現自己的控制列——
 * 播放／暫停、進度（可拖）、時間、靜音與音量。不用瀏覽器內建的控制列：卡片只有約 200px 寬，
 * 內建的在這麼窄時會把進度條和音量整個藏起來。播放中滑鼠移開，控制列收起來；暫停時一直留著。
 */
export function InlineVideo({ src, label, className, onPlayingChange }: InlineVideoProps) {
  const video = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const notify = useRef(onPlayingChange)
  notify.current = onPlayingChange
  useEffect(() => {
    notify.current?.(started)
  }, [started])

  const play = (): void => {
    setStarted(true)
    void video.current?.play().catch(() => {
      setStarted(false)
    })
  }
  const toggle = (): void => {
    const el = video.current
    if (!el) return
    if (el.paused) play()
    else el.pause()
  }

  return (
    <div className={cn('group/vid relative aspect-video overflow-hidden bg-black', className)}>
      <video
        ref={video}
        data-testid="inline-video"
        src={src}
        playsInline
        preload="metadata"
        aria-label={label}
        className={cn(NO_CANVAS, 'size-full object-contain')}
        onClick={started ? toggle : undefined}
        onPlay={() => {
          setPaused(false)
        }}
        onPause={() => {
          setPaused(true)
        }}
        onEnded={() => {
          setStarted(false)
          setPaused(true)
        }}
        onTimeUpdate={(event) => {
          setTime(event.currentTarget.currentTime)
        }}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration)
        }}
        onDurationChange={(event) => {
          setDuration(event.currentTarget.duration)
        }}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume)
          setMuted(event.currentTarget.muted)
        }}
      />
      {started ? (
        <div
          data-testid="inline-video-controls"
          className={cn(
            NO_CANVAS,
            'absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white transition-opacity focus-within:opacity-100 group-hover/vid:opacity-100',
            paused ? 'opacity-100' : 'opacity-0',
          )}
        >
          <input
            type="range"
            data-testid="inline-video-seek"
            aria-label={t('player.seek')}
            title={`${clock(time)} / ${clock(duration)}`}
            className={cn(RANGE, 'w-full')}
            min={0}
            max={duration > 0 ? duration : 0}
            step={0.1}
            value={Math.min(time, duration > 0 ? duration : 0)}
            onChange={(event) => {
              const next = Number(event.target.value)
              setTime(next)
              if (video.current) video.current.currentTime = next
            }}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="inline-video-toggle"
              aria-label={paused ? t('player.play') : t('player.pause')}
              title={paused ? t('player.play') : t('player.pause')}
              className={BUTTON}
              onClick={toggle}
            >
              {paused ? (
                <Play className="size-3.5 fill-current" aria-hidden />
              ) : (
                <Pause className="size-3.5 fill-current" aria-hidden />
              )}
            </button>
            <span data-testid="inline-video-time" className="tabular-nums">
              {`${clock(time)} / ${clock(duration)}`}
            </span>
            <span className="min-w-0 flex-1" />
            <button
              type="button"
              data-testid="inline-video-mute"
              aria-label={muted ? t('player.unmute') : t('player.mute')}
              title={muted ? t('player.unmute') : t('player.mute')}
              className={BUTTON}
              onClick={() => {
                if (video.current) video.current.muted = !video.current.muted
              }}
            >
              {muted || volume === 0 ? (
                <VolumeX className="size-3.5" aria-hidden />
              ) : (
                <Volume2 className="size-3.5" aria-hidden />
              )}
            </button>
            <input
              type="range"
              data-testid="inline-video-volume"
              aria-label={t('player.volume')}
              className={cn(RANGE, 'w-12 shrink-0')}
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!video.current) return
                video.current.volume = next
                video.current.muted = next === 0
              }}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="inline-video-play"
          aria-label={t('player.play')}
          title={t('player.play')}
          className="nodrag nopan absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75"
          onClick={play}
        >
          <Play className="size-4 fill-current" aria-hidden />
        </button>
      )}
    </div>
  )
}
