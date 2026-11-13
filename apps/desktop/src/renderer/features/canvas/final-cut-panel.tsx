import { secLabel } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { cn } from '../../lib/cn'
import { creditsPreferred, setCreditsPreferred } from '../../lib/export-credits'
import { revealLabel } from '../../lib/reveal-label'
import { call, errorText } from '../../lib/svs'
import { SoundPanel } from '../sound/sound-panel'
import { useTrailerStatus } from './use-trailer-status'
import { t } from '@svs/schema'

const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path

function RevealButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" data-testid="final-cut-reveal" onClick={onClick}>
      {revealLabel()}
    </Button>
  )
}

/** 成品：預覽接好的完整影片、匯出 MP4、換了版本之後重新接片。 */
export function FinalCutPanel({
  finalVideoHash,
  canRejoin,
  onClose,
}: {
  finalVideoHash: string | undefined
  /** 每個鏡頭都有採用中的影片，而且沒有鏡頭正在生成。 */
  canRejoin: boolean
  /** 沒給就不畫自己的標題列（放在畫布的浮動面板裡）。 */
  onClose?: () => void
}) {
  const { status: trailer } = useTrailerStatus()
  const [busy, setBusy] = useState<'export' | 'rejoin' | undefined>()
  const [exported, setExported] = useState<string | undefined>()
  const [credits, setCredits] = useState(creditsPreferred)
  // 要了字卡但沒加成功（改匯出了沒有字卡的版本）
  const [creditsMissing, setCreditsMissing] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const reveal = (name: string): void => {
    call('files.reveal', { exportName: name }).catch((e: unknown) => {
      setError(errorText(e))
    })
  }

  const act = (kind: 'export' | 'rejoin'): void => {
    setBusy(kind)
    setError(undefined)
    const work =
      kind === 'export'
        ? call('quickstart.export', { credits }).then(({ path, credits: added }) => {
            setExported(path)
            setCreditsMissing(credits && !added)
          })
        : call('shots.rejoin', {})
    work
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(undefined)
      })
  }

  return (
    <section className="space-y-3 p-4" data-testid="final-cut-panel" aria-label={t('canvas.film')}>
      {onClose ? (
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('canvas.film')}</h2>
          <Button variant="ghost" onClick={onClose}>
            {t('canvas.close2')}
          </Button>
        </header>
      ) : null}
      {trailer?.exists === true && trailer.filmSec !== undefined ? (
        <p
          data-testid="final-cut-length"
          className={cn(
            'text-sm font-semibold',
            // 差超過一格（1/24 秒）就用警示色：成品跟目標對不上
            Math.abs(trailer.filmSec - trailer.targetSec) > 1 / 24 + 1e-6 && 'text-warning',
          )}
        >
          {Math.abs(trailer.filmSec - trailer.targetSec) > 1 / 24 + 1e-6
            ? t('trailer.filmLengthOff', {
                sec: secLabel(trailer.filmSec),
                target: secLabel(trailer.targetSec),
              })
            : t('trailer.filmLength', { sec: secLabel(trailer.filmSec) })}
        </p>
      ) : null}
      {finalVideoHash ? (
        <video
          data-testid="final-cut-video"
          controls
          src={assetUrl(finalVideoHash)}
          className="w-full rounded-lg border border-border bg-black"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {finalVideoHash ? (
          <Button
            variant="primary"
            data-testid="final-cut-export"
            disabled={busy !== undefined}
            onClick={() => {
              act('export')
            }}
          >
            {t('canvas.exportMp4')}
          </Button>
        ) : null}
        {canRejoin ? (
          <Button
            variant={finalVideoHash ? 'secondary' : 'primary'}
            data-testid="final-cut-rejoin"
            disabled={busy !== undefined}
            onClick={() => {
              act('rejoin')
            }}
          >
            {busy === 'rejoin' ? t('canvas.joiningTheFilm') : t('canvas.joinIntoFilm')}
          </Button>
        ) : null}
      </div>
      {finalVideoHash ? (
        <label
          className="flex items-center gap-2 text-xs text-fg-muted"
          title={trailer?.exists === true ? undefined : t('canvas.adds3SecondsAtThe')}
        >
          <input
            type="checkbox"
            data-testid="final-cut-credits"
            checked={credits}
            onChange={(event) => {
              setCredits(event.target.checked)
              setCreditsPreferred(event.target.checked)
            }}
          />
          {trailer?.exists === true
            ? t('canvas.creditsOnTitleCard')
            : t('canvas.addAiServiceCreditsAt')}
        </label>
      ) : null}
      {exported ? (
        <div className="flex flex-wrap items-center gap-x-2">
          <p className="text-sm text-success" data-testid="final-cut-exported">
            {creditsMissing
              ? t(
                  trailer?.exists === true
                    ? 'canvas.exportedToNoTitleCredits'
                    : 'canvas.exportedToTheEndCredits',
                  { exported },
                )
              : t('canvas.exportedTo', { exported })}
          </p>
          <RevealButton
            onClick={() => {
              reveal(fileNameOf(exported))
            }}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <SoundPanel />
    </section>
  )
}
