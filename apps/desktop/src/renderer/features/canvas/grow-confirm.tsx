import type { OnelinerParams } from '@svs/schema'
import { useState } from 'react'

import { isMac } from '../../lib/history'
import type { GrowConfirm as Pending } from './use-grow'
import { RunConfirm } from './run-confirm'
import { t } from '@svs/schema'

/** 完成後自動加的旁白與配樂（照卡片上勾的）；花費已經算進預估。 */
function soundLines(sound: OnelinerParams['sound']): string[] {
  if (!sound) return []
  const parts = [
    ...(sound.narration ? [t('canvas.narrationReadsTheShotsThat')] : []),
    ...(sound.music ? [t('canvas.aPieceOfMusic')] : []),
  ]
  return parts.length === 0
    ? []
    : [t('canvas.afterJoiningAddsTheCost', { value: parts.join(t('list.comma')) })]
}

/**
 * 一句話的花費確認。「先產生分鏡」用白話分兩段說：這一步只寫分鏡約多少錢、下一步才生圖片和影片約多少錢；
 * 「一次做完整支」列出每一步。列出會做什麼；專案裡已有內容時，可以選刪掉現有內容重新生成，
 * 勾了就說清楚會刪掉幾個場、幾個鏡頭，以及可以用「復原」全部找回來。
 */
export function GrowConfirm({
  pending,
  onOk,
  onCancel,
}: {
  pending: Pending
  onOk: (replace: boolean) => void
  onCancel: () => void
}) {
  const [replace, setReplace] = useState(false)
  const { params, check } = pending
  const n = params.shotCount
  const storyboard = pending.stage === 'storyboard'
  const models = [check.models.llm, check.models.image, check.models.video].filter(
    (name): name is string => name !== undefined,
  )
  return (
    <RunConfirm
      anchor={pending.anchor}
      count={storyboard ? 1 : 1 + n * 3}
      title={
        replace
          ? storyboard
            ? t('canvas.deleteWhatSThereAnd')
            : t('canvas.deleteWhatSThereAnd2')
          : storyboard
            ? t('canvas.writeTheStoryboardFirst')
            : t('canvas.makeTheWholeFilmIn')
      }
      lines={
        storyboard
          ? [
              t('canvas.thisStepOnlyWritesThe', {
                value: String(n),
                value2: check.estimatedUsd.toFixed(2),
              }),
              pending.nextUsd === undefined
                ? t('canvas.theNextStepMakesPictures')
                : t('canvas.theNextStepMakesPictures2', {
                    value: String(n),
                    value2: String(n),
                    value3: pending.nextUsd.toFixed(2),
                  }),
              t('canvas.onceTheStoryboardIsWritten'),
              t('canvas.narrationAndMusicArenT'),
            ]
          : [
              t('canvas.writeTheStoryboardSplitInto', { value: String(n) }),
              t('canvas.firstFrames', { value: String(n) }),
              t('canvas.videosSecEach', { value: String(n), value2: String(params.durationSec) }),
              t('canvas.joinThemIntoOneComplete'),
              ...soundLines(params.sound),
            ]
      }
      // 用哪個模型、示範模式的說明放在清單外面：永遠看得到
      pinnedLines={
        storyboard
          ? [
              ...(check.models.llm === undefined
                ? []
                : [t('canvas.thisStepUses', { llm: check.models.llm })]),
              ...(check.demoMode ? [t('canvas.demoModeNothingIsCharged')] : []),
            ]
          : [
              ...(models.length > 0
                ? [t('canvas.uses', { value: models.join(t('list.comma')) })]
                : []),
              ...(check.demoMode ? [t('canvas.demoModeNothingIsCharged')] : []),
            ]
      }
      costUsd={check.estimatedUsd}
      lowerBound={check.estimateIsLowerBound}
      {...(storyboard ? { costLabel: t('canvas.thisStepIsAbout'), cachedNote: false } : {})}
      okLabel={
        replace
          ? t('canvas.deleteAndGenerate')
          : storyboard
            ? t('canvas.writeStoryboard')
            : t('canvas.doItAll')
      }
      danger={replace}
      extra={
        pending.hasContent ? (
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                data-testid="grow-replace"
                checked={replace}
                className="mt-0.5"
                onChange={(event) => {
                  setReplace(event.target.checked)
                }}
              />
              <span>
                {t('canvas.deleteWhatSThereAnd3')}
                {replace ? null : (
                  <small className="block text-fg-muted">{t('canvas.untickedTheNewShotsGo')}</small>
                )}
              </span>
            </label>
            {replace ? (
              <div
                data-testid="grow-replace-warning"
                className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-fg"
              >
                <p className="font-semibold text-danger">
                  {t('canvas.thisWillDeleteScenesAnd', {
                    value: String(pending.existing.scenes),
                    value2: String(pending.existing.shots),
                  })}
                </p>
                <p className="mt-0.5 text-fg-muted">{t('canvas.theirPicturesVideosAndOutline')}</p>
                <p className="mt-0.5 text-fg-muted">
                  {t('canvas.toGoBackToHow', { value: isMac() ? '⌘Z' : 'Ctrl+Z' })}
                </p>
              </div>
            ) : null}
          </div>
        ) : null
      }
      onOk={() => {
        onOk(replace)
      }}
      onCancel={onCancel}
    />
  )
}
