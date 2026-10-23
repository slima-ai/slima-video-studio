import { ClipboardPaste, PenLine, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Mascot } from '../../brand/mascot'
import { Button } from '../../components/button'
import { anchorOf, type ConfirmAnchor } from './run-confirm'
import { t } from '@svs/schema'

const TEXTAREA =
  'resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm font-normal placeholder:text-fg-subtle'

function StartCard({
  icon,
  title,
  intro,
  cost,
  children,
}: {
  icon: ReactNode
  title: string
  intro: string
  /** 一行說明：會不會花錢、花在哪。 */
  cost: string
  children: ReactNode
}) {
  return (
    <section className="flex w-[264px] flex-col gap-2.5 rounded-2xl border border-border bg-surface-raised p-5 shadow-panel">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h3>
      <p className="text-sm leading-snug text-fg-muted">{intro}</p>
      <p className="text-xs leading-snug text-fg-subtle">{cost}</p>
      {children}
    </section>
  )
}

/**
 * 空白畫布的三個起點（不只「一句話」一條路）：
 * 手動一步一步來、貼一段故事拆成分鏡（不生圖片和影片）、一句話一次做完整支短片。
 * 三個都只是起點，之後隨時能從左邊的「新增」面板加場、鏡頭、角色、地點，或上傳圖片。
 */
export function StartCards({
  busy,
  onManual,
  onSplit,
  onOneliner,
}: {
  /** 正在拆分鏡：貼故事那一張先停用。 */
  busy: boolean
  onManual: () => void
  onSplit: (story: string, anchor: ConfirmAnchor) => void
  onOneliner: (story: string) => void
}) {
  const [pasted, setPasted] = useState('')
  const [line, setLine] = useState('')
  return (
    <div
      data-testid="canvas-empty"
      className="pointer-events-none absolute inset-0 z-10 flex overflow-auto pl-[264px]"
    >
      <div className="pointer-events-auto m-auto flex flex-col items-center gap-4 pb-4 pt-16">
        <div className="flex flex-col items-center gap-1 text-center">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Mascot size={32} mood="idle" />
            {t('canvas.whereToStart')}
          </h2>
          <p className="text-sm text-fg-muted">{t('canvas.anyOfTheThreeWorks')}</p>
        </div>
        <div className="flex flex-wrap items-stretch justify-center gap-3">
          <StartCard
            icon={<PenLine className="size-4 text-accent" aria-hidden />}
            title={t('canvas.goStepByStep')}
            intro={t('canvas.addASceneAndA')}
            cost={t('canvas.addingCostsNothingBeforeYou')}
          >
            <div className="flex-1" />
            <Button variant="primary" data-testid="empty-manual" onClick={onManual}>
              {t('canvas.addTheFirstShot')}
            </Button>
          </StartCard>
          <StartCard
            icon={<ClipboardPaste className="size-4 text-accent" aria-hidden />}
            title={t('canvas.pasteAStory')}
            intro={t('canvas.pasteAStoryAndAi')}
            cost={t('canvas.usesOnlyATextModel')}
          >
            <textarea
              data-testid="empty-paste-text"
              rows={3}
              value={pasted}
              maxLength={20_000}
              disabled={busy}
              placeholder={t('canvas.pasteYourStoryOrPlot')}
              onChange={(event) => {
                setPasted(event.target.value)
              }}
              className={TEXTAREA}
            />
            <Button
              variant="primary"
              data-testid="empty-paste-go"
              disabled={busy || pasted.trim() === ''}
              onClick={(event) => {
                onSplit(pasted.trim(), anchorOf(event.currentTarget))
              }}
            >
              {busy ? t('canvas.splitting') : t('canvas.splitIntoStoryboard')}
            </Button>
          </StartCard>
          <StartCard
            icon={<Sparkles className="size-4 text-accent" aria-hidden />}
            title={t('canvas.oneLiner')}
            intro={t('canvas.writeOneLineLookAt')}
            cost={t('canvas.thisCostsMoneyPicturesAnd')}
          >
            <form
              className="flex flex-col gap-2.5"
              onSubmit={(event) => {
                event.preventDefault()
                onOneliner(line.trim())
              }}
            >
              <textarea
                data-testid="empty-story"
                rows={3}
                value={line}
                maxLength={2000}
                placeholder={t('canvas.forExampleACatFinds')}
                onChange={(event) => {
                  setLine(event.target.value)
                }}
                className={TEXTAREA}
              />
              <Button type="submit" variant="secondary" data-testid="empty-add-oneliner">
                {t('canvas.addAOneLiner')}
              </Button>
            </form>
          </StartCard>
        </div>
      </div>
    </div>
  )
}
