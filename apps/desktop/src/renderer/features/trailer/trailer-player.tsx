import type { ShotView } from '@svs/schema'
import { t } from '@svs/schema'
import type { RefObject } from 'react'

import { assetUrl } from '../../lib/asset'

/** 腳本條上這一格目前能看到的畫面：採用中的影片、否則首幀圖。 */
export function previewOf(beat: ShotView): { video?: string; image?: string } {
  const video = beat.videos.find((take) => take.adopted) ?? beat.videos.at(-1)
  const frame = beat.firstFrames.find((take) => take.adopted) ?? beat.firstFrames.at(-1)
  return {
    ...(video ? { video: video.assetHash } : {}),
    ...(frame ? { image: frame.assetHash } : {}),
  }
}

/**
 * 播放器：有成品就播成品；還沒有就顯示選到的那一格（有影片播影片、只有首幀顯示圖、字卡與片名卡用文字排出示意、
 * 什麼都沒有就寫那一格的畫面描述）。比例照專案：直式時置中、高度最多半個視窗。
 */
export function TrailerPlayer({
  finalHash,
  beat,
  portrait,
  title,
  videoRef,
  onTime,
}: {
  finalHash: string | undefined
  beat: ShotView | undefined
  portrait: boolean
  /** 片名卡的字（設定裡的書名）。 */
  title: string
  videoRef: RefObject<HTMLVideoElement | null>
  onTime: (sec: number) => void
}) {
  const shown = beat ? previewOf(beat) : {}
  const isTextBeat = beat?.beatKind === 'card' || beat?.beatKind === 'title'
  const mock = !finalHash && isTextBeat && shown.image === undefined
  const frameStyle = portrait
    ? { aspectRatio: '9 / 16', height: '50vh', maxWidth: '100%' }
    : { aspectRatio: '16 / 9', width: '100%', maxWidth: 'calc(50vh * 16 / 9)' }
  return (
    <div className="flex justify-center">
      <div
        data-testid="trailer-player"
        data-source={finalHash ? 'final' : 'beat'}
        data-aspect={portrait ? '9:16' : '16:9'}
        role="group"
        aria-label={t('trailer.page.player')}
        style={frameStyle}
        className="relative flex items-center justify-center overflow-hidden rounded-xl bg-black text-white"
      >
        {finalHash ? (
          <video
            ref={videoRef}
            data-testid="trailer-player-video"
            src={assetUrl(finalHash)}
            controls
            className="size-full object-contain"
            onTimeUpdate={(event) => {
              onTime(event.currentTarget.currentTime)
            }}
          />
        ) : shown.video ? (
          <video
            data-testid="trailer-player-video"
            src={assetUrl(shown.video)}
            controls
            muted
            className="size-full object-contain"
          />
        ) : shown.image ? (
          <img
            data-testid="trailer-player-image"
            src={assetUrl(shown.image)}
            alt={beat?.description ?? ''}
            className="size-full object-contain"
          />
        ) : mock ? (
          <div
            data-testid="trailer-player-mock"
            className="flex flex-col items-center gap-2 px-6 text-center"
          >
            <p className="text-xl font-semibold leading-snug">
              {beat.beatKind === 'title' ? title : (beat.card?.text ?? '')}
            </p>
            {beat.beatKind === 'card' && beat.card?.subtext ? (
              <p className="text-sm opacity-70">{beat.card.subtext}</p>
            ) : null}
            <span className="absolute right-2 top-2 rounded bg-white/20 px-1.5 py-0.5 text-[11px]">
              {t('trailer.page.mock')}
            </span>
          </div>
        ) : (
          <p
            data-testid="trailer-player-text"
            className="px-6 text-center text-sm leading-relaxed opacity-80"
          >
            {beat && beat.description !== '' ? beat.description : t('trailer.page.noPicture')}
          </p>
        )}
      </div>
    </div>
  )
}
