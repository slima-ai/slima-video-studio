import { t, type ShotView, type TakeView, type TrimEdit } from '@svs/schema'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { call, errorText } from '../../lib/svs'
import {
  TRIM_DEFAULT_FPS,
  clampIn,
  clampOut,
  fmtSec,
  frameAt,
  parseSec,
  secOfFrame,
  seekTimeOfFrame,
  snapSec,
} from './trim-math'

type Which = 'in' | 'out'

/** 剪裁要的最少資料：鏡頭（要改的是它的採用中影片）與那一版影片。 */
export interface TrimPlayerProps {
  shot: ShotView
  /** 使用中的那一版影片（剪裁只套用在它身上）。 */
  take: TakeView
  /** `<video>` 的 data-testid（兩個面板各自沿用原本的）。 */
  videoTestId: string
}

const inField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement

/**
 * 影片預覽加上頭尾裁切：時間尺上兩個把手（入點、出點）、「設為入點／出點」（I、O）、←→ 逐格、
 * 「只播留下的部分」、兩個秒數欄位、重設。改了就存進使用中的影片版本；沒有確認框，
 * 要在成品裡生效要再「接成成品」（剪輯卡會標「鏡頭有變動，要重新接」）。
 */
export function TrimPlayer({ shot, take, videoTestId }: TrimPlayerProps) {
  const areaRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [fps, setFps] = useState(TRIM_DEFAULT_FPS)
  const [elementSec, setElementSec] = useState<number | undefined>()
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [onlyKept, setOnlyKept] = useState(false)
  const [drag, setDrag] = useState<{ which: Which; sec: number } | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [note, setNote] = useState<string | undefined>()
  const [inText, setInText] = useState<string | undefined>()
  const [outText, setOutText] = useState<string | undefined>()

  const videoSec = take.videoSec ?? elementSec
  const committedIn = take.trim?.inSec ?? 0
  const committedOut = take.trim?.outSec ?? videoSec ?? 0
  const start = drag?.which === 'in' ? drag.sec : committedIn
  const end = drag?.which === 'out' ? drag.sec : committedOut
  const trimmed = take.trim !== undefined
  const pct = (sec: number): string =>
    `${String(videoSec ? Math.min(100, Math.max(0, (sec / videoSec) * 100)) : 0)}%`

  // 換了一版影片：播放位置、欄位草稿、提示都重來
  useEffect(() => {
    setPlayhead(0)
    setPlaying(false)
    setDrag(undefined)
    setError(undefined)
    setNote(undefined)
    setInText(undefined)
    setOutText(undefined)
  }, [take.id])

  // 播放中每一格都更新播放位置（timeupdate 一秒只有四次，游標會一跳一跳）
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = (): void => {
      const video = videoRef.current
      if (video) {
        setPlayhead(video.currentTime)
        if (onlyKept && video.currentTime >= committedOut - 1e-3 && committedOut > 0) {
          video.pause()
          video.currentTime = committedOut
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [playing, onlyKept, committedOut])

  const commit = (edit: TrimEdit): void => {
    setBusy(true)
    setError(undefined)
    setNote(undefined)
    call('shots.trim', { shotId: shot.id, edit })
      .then((outcome) => {
        setFps(outcome.fps)
        const first = outcome.adjustments[0]
        if (first) {
          const params = { asked: fmtSec(first.from), used: fmtSec(first.to) }
          setNote(
            first.reason === 'clamped'
              ? t('shots.trimClamped', params)
              : t('shots.trimAdjusted', params),
          )
        }
        setInText(undefined)
        setOutText(undefined)
      })
      .catch((e: unknown) => {
        setError(errorText(e))
        setInText(undefined)
        setOutText(undefined)
      })
      .finally(() => {
        setBusy(false)
        setDrag(undefined)
      })
  }

  const seek = (sec: number): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(sec, videoSec ?? sec))
    setPlayhead(video.currentTime)
  }

  /** 播放位置所在那一格的開頭（秒）。 */
  const playheadSec = (): number =>
    secOfFrame(frameAt(videoRef.current?.currentTime ?? playhead, fps), fps)

  const setIn = (): void => {
    commit({ inSec: snapSec(playheadSec(), fps) })
  }
  const setOut = (): void => {
    commit({ outSec: snapSec(playheadSec(), fps) })
  }

  const step = (dir: -1 | 1): void => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    const frame = Math.max(0, frameAt(video.currentTime, fps) + dir)
    seek(Math.min(seekTimeOfFrame(frame, fps), videoSec ?? Infinity))
  }

  const secAtPointer = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || !videoSec) return 0
    return snapSec(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * videoSec, fps)
  }

  const handleDown = (which: Which) => (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ which, sec: which === 'in' ? committedIn : committedOut })
  }
  const handleMove = (which: Which) => (event: PointerEvent<HTMLButtonElement>) => {
    if (drag?.which !== which || !videoSec) return
    const raw = secAtPointer(event.clientX)
    const sec =
      which === 'in' ? clampIn(raw, committedOut, fps) : clampOut(raw, committedIn, videoSec, fps)
    setDrag({ which, sec })
    seek(sec)
  }
  const handleUp = (which: Which) => () => {
    if (drag?.which !== which) return
    const changed = which === 'in' ? drag.sec !== committedIn : drag.sec !== committedOut
    if (changed) commit(which === 'in' ? { inSec: drag.sec } : { outSec: drag.sec })
    else setDrag(undefined)
  }

  const handleKey = (which: Which) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!videoSec || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    event.stopPropagation()
    const dir = event.key === 'ArrowLeft' ? -1 : 1
    const base = which === 'in' ? committedIn : committedOut
    const next = snapSec(base + dir / fps, fps)
    const clamped =
      which === 'in' ? clampIn(next, committedOut, fps) : clampOut(next, committedIn, videoSec, fps)
    if (clamped !== base) commit(which === 'in' ? { inSec: clamped } : { outSec: clamped })
    seek(clamped)
  }

  /**
   * 整個剪裁區的快捷鍵（I、O、← →）。用「捕獲」階段接：影片的控制列自己吃掉方向鍵（不會往上冒泡），
   * 在冒泡階段接就收不到；捕獲階段先到，接到之後不再往下傳，影片就不會同時跳 5 秒。
   * 打字的欄位、時間尺上的把手（自己有 ← → 微調）不攔。
   */
  const onKeyDown = (event: globalThis.KeyboardEvent): void => {
    const target = event.target
    if (inField(target) || event.metaKey || event.ctrlKey || event.altKey) return
    if (target instanceof HTMLElement && target.closest('[role="slider"]')) return
    const key = event.key
    if (key === 'i' || key === 'I') {
      event.preventDefault()
      event.stopImmediatePropagation()
      setIn()
    } else if (key === 'o' || key === 'O') {
      event.preventDefault()
      event.stopImmediatePropagation()
      setOut()
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault()
      event.stopImmediatePropagation()
      step(key === 'ArrowLeft' ? -1 : 1)
    }
  }
  // 最新的處理函式放在 ref 裡，window 上的監聽只掛一次
  const keyRef = useRef(onKeyDown)
  keyRef.current = onKeyDown
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent): void => {
      const area = areaRef.current
      // 只管焦點在這個剪裁區裡的按鍵（影片、按鈕、時間尺）
      if (area && event.target instanceof Node && area.contains(event.target)) keyRef.current(event)
    }
    // window 的捕獲階段：影片的控制列自己吃掉方向鍵（不會往上冒泡到 React），畫布也有自己的全域按鍵
    window.addEventListener('keydown', listener, true)
    return () => {
      window.removeEventListener('keydown', listener, true)
    }
  }, [])

  const submitField = (which: Which, text: string): void => {
    const sec = parseSec(text)
    if (sec === undefined) {
      setError(t('shots.trimNotANumber'))
      setInText(undefined)
      setOutText(undefined)
      return
    }
    const current = which === 'in' ? committedIn : committedOut
    if (Math.abs(sec - current) < 1e-6) {
      setInText(undefined)
      setOutText(undefined)
      return
    }
    commit(which === 'in' ? { inSec: sec } : { outSec: sec })
  }

  const lengthSec = Math.max(0, end - start)
  const frames = Math.round(lengthSec * fps)
  const fieldClass =
    'w-20 rounded-md border border-border bg-surface px-2 py-1 text-sm tabular-nums'

  return (
    <div ref={areaRef} data-testid="trim-player" className="space-y-2">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-black">
        <video
          key={take.id}
          ref={videoRef}
          data-testid={videoTestId}
          controls
          tabIndex={0}
          src={assetUrl(take.assetHash)}
          className="size-full"
          onLoadedMetadata={(event) => {
            setElementSec(event.currentTarget.duration)
          }}
          onPlay={(event) => {
            const video = event.currentTarget
            setPlaying(true)
            // 只播留下的部分：從頭播或播到尾巴時，回到入點開始
            if (
              onlyKept &&
              (video.currentTime < committedIn || video.currentTime >= committedOut - 1e-3)
            ) {
              video.currentTime = committedIn
            }
          }}
          onPause={() => {
            setPlaying(false)
            if (videoRef.current) setPlayhead(videoRef.current.currentTime)
          }}
          onSeeked={(event) => {
            setPlayhead(event.currentTarget.currentTime)
          }}
        />
      </div>

      <div data-testid="trim-control" className="space-y-2" aria-label={t('shots.trimTitle')}>
        <p className="text-sm font-medium">{t('shots.trimTitle')}</p>
        <div
          ref={trackRef}
          data-testid="trim-track"
          role="group"
          aria-label={t('shots.trimTimeline')}
          className="relative h-9 touch-none rounded-md bg-surface-overlay"
          onPointerDown={(event) => {
            if (
              event.target === event.currentTarget ||
              (event.target as HTMLElement).dataset.trimPart
            ) {
              seek(secAtPointer(event.clientX))
              // 焦點放回影片：I、O、← → 才有人接，畫布的 Delete 也不會誤刪卡片（影片是「自己管鍵盤」的元素）
              videoRef.current?.focus()
            }
          }}
        >
          <div
            data-trim-part="kept"
            data-testid="trim-kept"
            className="absolute inset-y-0 rounded-md bg-accent/30"
            style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }}
          />
          <div
            data-trim-part="playhead"
            data-testid="trim-playhead"
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-fg"
            style={{ left: pct(playhead) }}
          />
          <button
            type="button"
            role="slider"
            data-testid="trim-handle-in"
            aria-label={t('shots.trimInHandle')}
            aria-valuemin={0}
            aria-valuemax={videoSec ?? 0}
            aria-valuenow={start}
            aria-valuetext={fmtSec(start)}
            disabled={busy || videoSec === undefined}
            className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-accent focus-visible:outline-2 focus-visible:outline-fg"
            style={{ left: pct(start) }}
            onPointerDown={handleDown('in')}
            onPointerMove={handleMove('in')}
            onPointerUp={handleUp('in')}
            onKeyDown={handleKey('in')}
          />
          <button
            type="button"
            role="slider"
            data-testid="trim-handle-out"
            aria-label={t('shots.trimOutHandle')}
            aria-valuemin={0}
            aria-valuemax={videoSec ?? 0}
            aria-valuenow={end}
            aria-valuetext={fmtSec(end)}
            disabled={busy || videoSec === undefined}
            className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-accent focus-visible:outline-2 focus-visible:outline-fg"
            style={{ left: pct(end) }}
            onPointerDown={handleDown('out')}
            onPointerMove={handleMove('out')}
            onPointerUp={handleUp('out')}
            onKeyDown={handleKey('out')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            data-testid="trim-set-in"
            disabled={busy || videoSec === undefined}
            onClick={setIn}
          >
            {t('shots.trimSetIn')}
            <kbd className="rounded border border-border px-1 text-xs">I</kbd>
          </Button>
          <Button
            size="sm"
            data-testid="trim-set-out"
            disabled={busy || videoSec === undefined}
            onClick={setOut}
          >
            {t('shots.trimSetOut')}
            <kbd className="rounded border border-border px-1 text-xs">O</kbd>
          </Button>
          <label className="flex items-center gap-1 text-sm">
            {t('shots.trimInField')}
            <input
              data-testid="trim-in"
              inputMode="decimal"
              disabled={busy || videoSec === undefined}
              className={fieldClass}
              value={inText ?? fmtSec(start)}
              onChange={(event) => {
                setInText(event.target.value)
              }}
              onBlur={(event) => {
                if (inText !== undefined) submitField('in', event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitField('in', event.currentTarget.value)
                if (event.key === 'Escape') setInText(undefined)
              }}
            />
          </label>
          <label className="flex items-center gap-1 text-sm">
            {t('shots.trimOutField')}
            <input
              data-testid="trim-out"
              inputMode="decimal"
              disabled={busy || videoSec === undefined}
              className={fieldClass}
              value={outText ?? fmtSec(end)}
              onChange={(event) => {
                setOutText(event.target.value)
              }}
              onBlur={(event) => {
                if (outText !== undefined) submitField('out', event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitField('out', event.currentTarget.value)
                if (event.key === 'Escape') setOutText(undefined)
              }}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="trim-only-kept"
              checked={onlyKept}
              onChange={(event) => {
                setOnlyKept(event.target.checked)
              }}
            />
            {t('shots.trimPlayKept')}
          </label>
          <Button
            size="sm"
            variant="ghost"
            data-testid="trim-reset"
            disabled={busy || !trimmed}
            onClick={() => {
              commit({ clear: true })
            }}
          >
            {t('shots.trimReset')}
          </Button>
        </div>

        {videoSec !== undefined ? (
          <p className="text-sm text-fg-muted" data-testid="trim-summary">
            {trimmed
              ? t('shots.trimKept', {
                  start: fmtSec(start),
                  end: fmtSec(end),
                  length: fmtSec(lengthSec),
                  frames: String(frames),
                })
              : t('shots.trimWhole', {
                  length: fmtSec(videoSec),
                  frames: String(Math.round(videoSec * fps)),
                })}
          </p>
        ) : null}
        <p className="text-xs text-fg-muted">{t('shots.trimHelp')}</p>
        {note ? (
          <p className="text-sm text-fg-muted" role="status" data-testid="trim-note">
            {note}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger" data-testid="trim-error">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
