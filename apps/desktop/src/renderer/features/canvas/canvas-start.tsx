import { ClipboardPaste, PenLine, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Mascot } from '../../brand/mascot'
import { Button } from '../../components/button'
import { anchorOf, type ConfirmAnchor } from './run-confirm'
import { TrailerStartCard } from './trailer-start'
import { t } from '@svs/schema'

const TEXTAREA =
  'resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm font-normal placeholder:text-fg-subtle'

function StartCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className="pointer-events-auto flex w-[264px] flex-col gap-2.5 rounded-2xl border border-border bg-surface-raised p-5 shadow-panel">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * 空白畫布的四個起點（不只「一句話」一條路）：
 * 手動一步一步來、貼一段故事拆成分鏡（不生圖片和影片）、一句話一次做完整支短片、做預告片（貼書的文字寫腳本）。
 * 四個都只是起點，之後隨時能從左邊的「新增」面板加場、鏡頭、角色、地點，或上傳圖片。
 */
export function StartCards({
  busy,
  onManual,
  onSplit,
  onOneliner,
  onTrailerDone,
}: {
  /** 正在拆分鏡：貼故事那一張先停用。 */
  busy: boolean
  onManual: () => void
  onSplit: (story: string, anchor: ConfirmAnchor) => void
  onOneliner: (story: string) => void
  /** 預告片腳本寫好了：畫布重新讀。 */
  onTrailerDone?: () => void
}) {
  const [pasted, setPasted] = useState('')
  const [line, setLine] = useState('')
  return (
    <div
      data-testid="canvas-empty"
      className="pointer-events-none absolute inset-0 z-10 flex overflow-auto pl-[264px]"
    >
      {/* 只有卡片本身接收滑鼠；卡片旁邊的空白讓給畫布（雙擊新增、右下角的按鈕點得到） */}
      <div className="m-auto flex flex-col items-center gap-4 pb-4 pt-16">
        <div className="flex flex-col items-center gap-1 text-center">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Mascot size={32} mood="idle" />
            {t('canvas.whereToStart')}
          </h2>
        </div>
        <div className="flex flex-wrap items-stretch justify-center gap-3">
          <StartCard
            icon={<PenLine className="size-4 text-accent" aria-hidden />}
            title={t('canvas.goStepByStep')}
          >
            <div className="flex-1" />
            <Button variant="primary" data-testid="empty-manual" onClick={onManual}>
              {t('canvas.addTheFirstShot')}
            </Button>
          </StartCard>
          <StartCard
            icon={<ClipboardPaste className="size-4 text-accent" aria-hidden />}
            title={t('canvas.pasteAStory')}
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
          <TrailerStartCard {...(onTrailerDone ? { onDone: onTrailerDone } : {})} />
        </div>
      </div>
    </div>
  )
}
