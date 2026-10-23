import type { ShotBatchCheck, ShotBatchResult } from '@svs/schema'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'
import { t } from '@svs/schema'

export interface BatchConfirmProps {
  shotIds: string[]
  onCancel: () => void
  onStarted: (result: ShotBatchResult) => void
  onError: (message: string) => void
}

function describe(check: ShotBatchCheck): string {
  const skipped: string[] = []
  if (check.skippedGenerated > 0)
    skipped.push(t('storyboard.alreadyGenerated', { value: String(check.skippedGenerated) }))
  if (check.skippedBusy > 0)
    skipped.push(t('storyboard.beingGenerated', { value: String(check.skippedBusy) }))
  const cost = check.demoMode
    ? t('storyboard.demoModeNothingIsCharged')
    : check.estimateIsLowerBound
      ? t('storyboard.aboutUsOrMore', { value: check.estimatedUsd.toFixed(2) })
      : t('storyboard.aboutUs', { value: check.estimatedUsd.toFixed(2) })
  const models = [check.models.image, check.models.video].filter(Boolean).join(t('list.comma'))
  const count = String(check.willGenerate)
  const skippedText = skipped.join(t('list.comma'))
  if (skipped.length > 0) {
    return models
      ? t('storyboard.willGenerateShotsSkipping', { count, skippedText, cost, models })
      : t('storyboard.willGenerateShotsSkipping2', { count, skippedText, cost })
  }
  return models
    ? t('storyboard.willGenerateShots', { count, cost, models })
    : t('storyboard.willGenerateShots2', { count, cost })
}

/** 批次生成前的確認：先告訴你會做幾個、略過幾個、大概花多少錢，確認後才開始。 */
export function BatchConfirm({ shotIds, onCancel, onStarted, onError }: BatchConfirmProps) {
  const [skipGenerated, setSkipGenerated] = useState(true)
  const [draft, setDraft] = useState(false)
  const [check, setCheck] = useState<ShotBatchCheck>()
  const [busy, setBusy] = useState(false)
  const latest = useRef(0)
  const key = shotIds.join(',')

  useEffect(() => {
    const ticket = ++latest.current
    setCheck(undefined)
    call('shots.batchCheck', { shotIds: key.split(','), skipGenerated, draft })
      .then((next) => {
        if (ticket === latest.current) setCheck(next)
      })
      .catch((e: unknown) => {
        if (ticket === latest.current) onError(errorText(e))
      })
    // onError 只是回報用，不需要因為它換了就重新檢查
  }, [key, skipGenerated, draft])

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      onStarted(await call('shots.generateBatch', { shotIds, skipGenerated, draft }))
    } catch (e) {
      onError(errorText(e))
      onCancel()
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="storyboard-batch">
      <span className="text-sm" data-testid="storyboard-batch-info" role="status">
        {check
          ? check.ok
            ? describe(check)
            : (check.issue ?? t('storyboard.canTGenerateRightNow'))
          : t('storyboard.checking')}
      </span>
      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          data-testid="storyboard-batch-skip"
          checked={skipGenerated}
          onChange={(event) => {
            setSkipGenerated(event.target.checked)
          }}
        />
        {t('storyboard.skipTheOnesAlreadyGenerated')}
      </label>
      <label
        className="flex items-center gap-1 text-sm"
        title={t('storyboard.useTheEconomyModelsFor')}
      >
        <input
          type="checkbox"
          data-testid="storyboard-batch-draft"
          checked={draft}
          onChange={(event) => {
            setDraft(event.target.checked)
          }}
        />
        {t('storyboard.makeDraftsFirst')}
        <span className="text-xs text-fg-muted">{t('storyboard.usesEconomyModelsCheapAnd')}</span>
      </label>
      {check?.ok ? (
        <Button
          size="sm"
          variant="primary"
          data-testid="storyboard-generate-confirm"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy ? t('storyboard.starting') : t('storyboard.startGenerating')}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" data-testid="storyboard-batch-cancel" onClick={onCancel}>
        {t('storyboard.notNow')}
      </Button>
    </div>
  )
}
