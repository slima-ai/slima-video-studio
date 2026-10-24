import type { SoundShotView, SoundState, TrimEdit } from '@svs/schema'
import { t } from '@svs/schema'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { errorText } from '../../lib/svs'
import { TRIM_DEFAULT_FPS, clampIn, clampOut, fmtSec, fmtSec1, snapSec } from '../shots/trim-math'
import { secOfPixels, tickLabel, tickMarks } from './timeline-math'

const pct = (value: number, total: number): string =>
  `${String(Math.max(0, Math.min(100, (value / total) * 100)))}%`

type Edge = 'in' | 'out'

interface EdgeDrag {
  shotId: string
  edge: Edge
  /** 按下去那一刻的滑鼠位置、整條軸的寬度與片長（拖的過程中比例不變）。 */
  startX: number
  laneWidth: number
  totalSec: number
  /** 現在拖到哪（秒，影片裡的位置）。 */
  sec: number
}

/**
 * 整支片子的時間軸：秒數尺、鏡頭、影片原聲、旁白、配樂，位置與寬度依秒數換成比例。
 * 一眼看得出哪一鏡有旁白、旁白有沒有超出鏡頭、原聲被靜音的是哪幾鏡。
 * 給了 onTrim，鏡頭格子的左右邊緣可以拖（或聚焦後按 ← →）來剪頭尾；放開才存。
 */
export function SoundTimeline({
  state,
  onTrim,
  soundLanes = true,
}: {
  state: SoundState
  /** 存剪裁；成功就 resolve（時間軸會跟著新的長度重畫），失敗丟出錯誤。 */
  onTrim?: (shotId: string, edit: TrimEdit) => Promise<void>
  /** false＝只畫秒數尺、鏡頭、剪掉的部分（還沒有旁白與配樂時，原聲／旁白／配樂三條是空的，不畫）。 */
  soundLanes?: boolean
}) {
  const laneRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<EdgeDrag | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const total = state.totalSec
  if (!(total > 0) || state.shots.length === 0) return null
  const overflow = new Set(
    state.warnings.filter((w) => w.kind === 'narration_too_long').map((w) => w.shotId),
  )
  const lane = 'relative h-5 rounded bg-surface-overlay'
  const fps = TRIM_DEFAULT_FPS

  const commit = (shotId: string, edit: TrimEdit): void => {
    if (!onTrim) return
    setBusy(true)
    setError(undefined)
    onTrim(shotId, edit)
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(false)
        setDrag(undefined)
      })
  }

  const down = (shot: SoundShotView, edge: Edge) => (event: PointerEvent<HTMLButtonElement>) => {
    if (!shot.trim) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      shotId: shot.shotId,
      edge,
      startX: event.clientX,
      laneWidth: laneRef.current?.getBoundingClientRect().width ?? 0,
      totalSec: total,
      sec: edge === 'in' ? shot.trim.inSec : shot.trim.outSec,
    })
  }
  const move = (shot: SoundShotView, edge: Edge) => (event: PointerEvent<HTMLButtonElement>) => {
    if (drag?.shotId !== shot.shotId || drag.edge !== edge || !shot.trim) return
    const delta = secOfPixels(event.clientX - drag.startX, drag.laneWidth, drag.totalSec)
    const { inSec, outSec, videoSec } = shot.trim
    const sec =
      edge === 'in'
        ? clampIn(snapSec(inSec + delta, fps), outSec, fps)
        : clampOut(snapSec(outSec + delta, fps), inSec, videoSec, fps)
    setDrag({ ...drag, sec })
  }
  const up = (shot: SoundShotView, edge: Edge) => () => {
    if (drag?.shotId !== shot.shotId || drag.edge !== edge || !shot.trim) return
    const before = edge === 'in' ? shot.trim.inSec : shot.trim.outSec
    if (drag.sec === before) setDrag(undefined)
    else commit(shot.shotId, edge === 'in' ? { inSec: drag.sec } : { outSec: drag.sec })
  }
  const key = (shot: SoundShotView, edge: Edge) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!shot.trim || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    const { inSec, outSec, videoSec } = shot.trim
    const dir = event.key === 'ArrowLeft' ? -1 : 1
    const base = edge === 'in' ? inSec : outSec
    const next = snapSec(base + dir / fps, fps)
    const clamped =
      edge === 'in' ? clampIn(next, outSec, fps) : clampOut(next, inSec, videoSec, fps)
    if (clamped !== base)
      commit(shot.shotId, edge === 'in' ? { inSec: clamped } : { outSec: clamped })
  }

  /** 拖的時候這一鏡預覽成多長（沒在拖就是現在的長度）。 */
  const previewOf = (shot: SoundShotView): { start: number; end: number } | undefined => {
    if (!shot.trim) return undefined
    const dragging = drag?.shotId === shot.shotId ? drag : undefined
    return {
      start: dragging?.edge === 'in' ? dragging.sec : shot.trim.inSec,
      end: dragging?.edge === 'out' ? dragging.sec : shot.trim.outSec,
    }
  }
  const dragged = drag ? state.shots.find((shot) => shot.shotId === drag.shotId) : undefined
  const draggedPreview = dragged ? previewOf(dragged) : undefined
  const anyCut = state.shots.some((shot) => shot.trim?.trimmed)
  const marks = tickMarks(total)
  return (
    <div className="space-y-1" data-testid="sound-timeline" aria-label={t('sound.soundTimeline')}>
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 text-[11px]">
        <span aria-hidden="true" />
        <div
          className="relative h-4 text-[10px] text-fg-muted"
          data-testid="timeline-ruler"
          aria-label={t('sound.ruler')}
        >
          {marks.map((sec) => (
            <span
              key={sec}
              data-testid={`timeline-tick-${String(sec)}`}
              className="absolute inset-y-0 border-l border-border pl-0.5 leading-4"
              style={{ left: pct(sec, total) }}
            >
              {tickLabel(sec, total)}
            </span>
          ))}
        </div>
        <span className="text-fg-muted">{t('sound.shots')}</span>
        <div className={lane} ref={laneRef}>
          {state.shots.map((shot) => {
            const preview = previewOf(shot)
            const length = preview ? preview.end - preview.start : shot.durationSec
            return (
              <div
                key={shot.shotId}
                data-testid={`timeline-shot-${String(shot.number)}`}
                className="@container absolute inset-y-0 border-l border-border text-center leading-5"
                style={{ left: pct(shot.startSec, total), width: pct(length, total) }}
                title={
                  shot.trim
                    ? t('sound.shotCellTip', {
                        number: String(shot.number),
                        kept: fmtSec1(length),
                        total: fmtSec1(shot.trim.videoSec),
                      })
                    : undefined
                }
              >
                <span className="block overflow-hidden whitespace-nowrap px-1">
                  {shot.number}
                  <span
                    className="ml-1 hidden text-fg-muted @[4.5rem]:inline"
                    data-testid={`timeline-secs-${String(shot.number)}`}
                  >
                    {fmtSec1(length)}
                  </span>
                </span>
                {onTrim && shot.trim ? (
                  <>
                    <button
                      type="button"
                      role="slider"
                      data-testid={`timeline-edge-in-${String(shot.number)}`}
                      aria-label={t('sound.edgeIn', { number: String(shot.number) })}
                      aria-valuemin={0}
                      aria-valuemax={shot.trim.videoSec}
                      aria-valuenow={preview?.start ?? shot.trim.inSec}
                      aria-valuetext={fmtSec(preview?.start ?? shot.trim.inSec)}
                      disabled={busy}
                      className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize rounded-sm bg-accent/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-fg"
                      onPointerDown={down(shot, 'in')}
                      onPointerMove={move(shot, 'in')}
                      onPointerUp={up(shot, 'in')}
                      onKeyDown={key(shot, 'in')}
                    />
                    <button
                      type="button"
                      role="slider"
                      data-testid={`timeline-edge-out-${String(shot.number)}`}
                      aria-label={t('sound.edgeOut', { number: String(shot.number) })}
                      aria-valuemin={0}
                      aria-valuemax={shot.trim.videoSec}
                      aria-valuenow={preview?.end ?? shot.trim.outSec}
                      aria-valuetext={fmtSec(preview?.end ?? shot.trim.outSec)}
                      disabled={busy}
                      className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize rounded-sm bg-accent/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-fg"
                      onPointerDown={down(shot, 'out')}
                      onPointerMove={move(shot, 'out')}
                      onPointerUp={up(shot, 'out')}
                      onKeyDown={key(shot, 'out')}
                    />
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
        {anyCut ? (
          <>
            <span className="text-fg-muted">{t('sound.cutOff')}</span>
            <div className={lane}>
              {state.shots.map((shot) => {
                if (!shot.trim?.trimmed) return null
                const cut = shot.trim.videoSec - (shot.trim.outSec - shot.trim.inSec)
                return (
                  <div
                    key={shot.shotId}
                    data-testid={`timeline-cut-${String(shot.number)}`}
                    title={t('sound.cutOffTip', {
                      number: String(shot.number),
                      cut: fmtSec1(cut),
                    })}
                    className="absolute inset-y-1 rounded border border-border bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--color-border)_3px_4px)] opacity-70"
                    style={{
                      left: pct(shot.startSec + shot.durationSec, total),
                      width: pct(cut, total),
                    }}
                  />
                )
              })}
            </div>
          </>
        ) : null}
        {soundLanes ? (
          <>
            <span className="text-fg-muted">{t('sound.videoSound2')}</span>
            <div className={lane}>
              {state.shots.map((shot) => (
                <div
                  key={shot.shotId}
                  data-testid={`timeline-native-${String(shot.number)}`}
                  data-muted={shot.nativeMuted}
                  className={
                    shot.nativeMuted
                      ? 'absolute inset-y-1 rounded bg-fg/10'
                      : 'absolute inset-y-1 rounded bg-accent/40'
                  }
                  style={{ left: pct(shot.startSec, total), width: pct(shot.durationSec, total) }}
                />
              ))}
            </div>
            <span className="text-fg-muted">{t('sound.narration2')}</span>
            <div className={lane}>
              {state.shots.map((shot) =>
                shot.narration ? (
                  <div
                    key={shot.shotId}
                    data-testid={`timeline-narration-${String(shot.number)}`}
                    data-overflow={overflow.has(shot.shotId)}
                    className={
                      overflow.has(shot.shotId)
                        ? 'absolute inset-y-1 rounded bg-danger/60'
                        : 'absolute inset-y-1 rounded bg-success/60'
                    }
                    style={{
                      left: pct(shot.startSec + shot.narration.offsetSec, total),
                      width: pct(shot.narration.durationSec ?? 1, total),
                    }}
                  />
                ) : null,
              )}
            </div>
            <span className="text-fg-muted">{t('sound.music2')}</span>
            <div className={lane}>
              {state.music ? (
                <div
                  data-testid="timeline-music"
                  className="absolute inset-y-1 left-0 rounded bg-warning/50"
                  style={{ width: pct(state.music.durationSec ?? total, total) }}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
      {draggedPreview && dragged ? (
        <p className="text-xs text-fg-muted" data-testid="timeline-edge-readout" role="status">
          {t('sound.edgeReadout', {
            number: String(dragged.number),
            start: fmtSec(draggedPreview.start),
            end: fmtSec(draggedPreview.end),
            length: fmtSec(draggedPreview.end - draggedPreview.start),
          })}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-danger" role="alert" data-testid="timeline-edge-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
