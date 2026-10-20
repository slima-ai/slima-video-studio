import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { creditsPreferred, setCreditsPreferred } from '../../lib/export-credits'
import { revealLabel } from '../../lib/reveal-label'
import { call, errorText } from '../../lib/svs'
import { SoundPanel } from '../sound/sound-panel'

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
  const [busy, setBusy] = useState<'export' | 'rejoin' | undefined>()
  const [exported, setExported] = useState<string | undefined>()
  const [credits, setCredits] = useState(creditsPreferred)
  // 要了字卡但沒加成功（改匯出了沒有字卡的版本）
  const [creditsMissing, setCreditsMissing] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // 最近一次匯出的檔名（上次或別處匯出的也算；提示消失、關掉面板再打開之後還找得到）
  const [lastExport, setLastExport] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    call('files.list', {})
      .then((snapshot) => {
        if (alive) setLastExport(snapshot.exports[0]?.name)
      })
      .catch(() => undefined)
    // 在畫布的「剪輯」卡上匯出也算（主程序匯出完會把路徑放在進度裡推過來）
    const off = window.svs.on('quickstart.progress', (progress) => {
      if (progress.exportedPath !== undefined) setLastExport(fileNameOf(progress.exportedPath))
    })
    return () => {
      alive = false
      off()
    }
  }, [])

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
            setLastExport(fileNameOf(path))
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
            title="把每個鏡頭目前使用的影片接成成品（在本機處理、免費）"
            onClick={() => {
              act('rejoin')
            }}
          >
            {busy === 'rejoin' ? '接成成品中…' : '接成成品'}
          </Button>
        ) : null}
      </div>
      {finalVideoHash ? (
        <label
          className="flex items-center gap-2 text-xs text-fg-muted"
          title="在影片最後多 3 秒，列出用了哪些 AI 服務（例如 Video generated with Kling AI）；只加在匯出的檔案上，專案裡的成品不變"
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
          片尾加上 AI 服務標註（建議）
        </label>
      ) : null}
      {exported ? (
        <div className="flex flex-wrap items-center gap-x-2">
          <p className="text-sm text-success" data-testid="final-cut-exported">
            已匯出到 {exported}
            {creditsMissing ? '（片尾字卡沒有加成功，匯出的是沒有字卡的版本）' : ''}
          </p>
          <RevealButton
            onClick={() => {
              reveal(fileNameOf(exported))
            }}
          />
        </div>
      ) : lastExport ? (
        <div className="flex flex-wrap items-center gap-x-2" data-testid="final-cut-last-export">
          <p className="text-sm text-fg-muted">最近一次匯出：{lastExport}</p>
          <RevealButton
            onClick={() => {
              reveal(lastExport)
            }}
          />
        </div>
      ) : null}
      {canRejoin && finalVideoHash ? (
        <p className="text-xs text-fg-muted">
          換了鏡頭的版本或重新生成之後，按「接成成品」更新上面的完整影片。
        </p>
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
