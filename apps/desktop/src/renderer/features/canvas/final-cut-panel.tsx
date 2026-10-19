import { useState } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { call, errorText } from '../../lib/svs'

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
  const [busy, setBusy] = useState<'export' | 'rejoin' | undefined>()
  const [exported, setExported] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  const act = (kind: 'export' | 'rejoin'): void => {
    setBusy(kind)
    setError(undefined)
    const work =
      kind === 'export'
        ? call('quickstart.export', {}).then(({ path }) => {
            setExported(path)
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
    <section className="space-y-3 p-4" data-testid="final-cut-panel" aria-label="成品">
      {onClose ? (
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold">成品</h2>
          <Button variant="ghost" onClick={onClose}>
            關閉
          </Button>
        </header>
      ) : null}
      {finalVideoHash ? (
        <video
          data-testid="final-cut-video"
          controls
          src={assetUrl(finalVideoHash)}
          className="w-full rounded-lg border border-border bg-black"
        />
      ) : (
        <p className="text-sm text-fg-muted">
          還沒有接好的成品。每個鏡頭都有影片之後，按下面的「把鏡頭接成一支影片」，或在畫布的「剪輯」按
          ▶。
        </p>
      )}
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
            匯出 MP4
          </Button>
        ) : null}
        {canRejoin ? (
          <Button
            variant={finalVideoHash ? 'secondary' : 'primary'}
            data-testid="final-cut-rejoin"
            disabled={busy !== undefined}
            title="把每個鏡頭目前使用的影片重新接成一支"
            onClick={() => {
              act('rejoin')
            }}
          >
            {busy === 'rejoin' ? '接片中…' : finalVideoHash ? '重新接片' : '把鏡頭接成一支影片'}
          </Button>
        ) : null}
      </div>
      {exported ? (
        <p className="text-sm text-success" data-testid="final-cut-exported">
          已匯出到 {exported}
        </p>
      ) : null}
      {canRejoin && finalVideoHash ? (
        <p className="text-xs text-fg-muted">
          換了鏡頭的版本或重新生成之後，按「重新接片」更新上面的完整影片。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
