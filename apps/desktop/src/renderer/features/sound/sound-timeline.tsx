import type { SoundState } from '@svs/schema'
import { t } from '@svs/schema'

const pct = (value: number, total: number): string =>
  `${String(Math.max(0, Math.min(100, (value / total) * 100)))}%`

/**
 * 整支片子的聲音時間軸（只讀）：鏡頭、影片原聲、旁白、配樂四條，位置與寬度依秒數換成比例。
 * 一眼看得出哪一鏡有旁白、旁白有沒有超出鏡頭、原聲被靜音的是哪幾鏡。
 */
export function SoundTimeline({ state }: { state: SoundState }) {
  const total = state.totalSec
  if (!(total > 0) || state.shots.length === 0) return null
  const overflow = new Set(
    state.warnings.filter((w) => w.kind === 'narration_too_long').map((w) => w.shotId),
  )
  const lane = 'relative h-5 rounded bg-surface-overlay'
  return (
    <div className="space-y-1" data-testid="sound-timeline" aria-label={t('sound.soundTimeline')}>
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 text-[11px]">
        <span className="text-fg-muted">{t('sound.shots')}</span>
        <div className={lane}>
          {state.shots.map((shot) => (
            <div
              key={shot.shotId}
              data-testid={`timeline-shot-${String(shot.number)}`}
              className="absolute inset-y-0 overflow-hidden border-l border-border px-1 text-center leading-5"
              style={{ left: pct(shot.startSec, total), width: pct(shot.durationSec, total) }}
            >
              {shot.number}
            </div>
          ))}
        </div>
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
      </div>
    </div>
  )
}
