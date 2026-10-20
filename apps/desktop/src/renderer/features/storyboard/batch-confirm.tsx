import type { ShotBatchCheck, ShotBatchResult } from '@svs/schema'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'

export interface BatchConfirmProps {
  shotIds: string[]
  onCancel: () => void
  onStarted: (result: ShotBatchResult) => void
  onError: (message: string) => void
}

function describe(check: ShotBatchCheck): string {
  const skipped: string[] = []
  if (check.skippedGenerated > 0) skipped.push(`${String(check.skippedGenerated)} 個已經生成過`)
  if (check.skippedBusy > 0) skipped.push(`${String(check.skippedBusy)} 個正在生成`)
  const cost = check.demoMode
    ? '示範模式，不會花錢'
    : `預估約 US$${check.estimatedUsd.toFixed(2)}${check.estimateIsLowerBound ? '以上' : ''}`
  const models = [check.models.image, check.models.video].filter(Boolean).join('、')
  return (
    `會生成 ${String(check.willGenerate)} 個鏡頭` +
    (skipped.length > 0 ? `（略過 ${skipped.join('、')}）` : '') +
    `，${cost}` +
    (models ? `（${models}）` : '') +
    '。'
  )
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
        {check ? (check.ok ? describe(check) : (check.issue ?? '現在不能生成。')) : '檢查中…'}
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
        略過已經生成過的
      </label>
      <label
        className="flex items-center gap-1 text-sm"
        title="整批用經濟組的模型：便宜、快，滿意的鏡頭再用高品質重做"
      >
        <input
          type="checkbox"
          data-testid="storyboard-batch-draft"
          checked={draft}
          onChange={(event) => {
            setDraft(event.target.checked)
          }}
        />
        先出草稿
        <span className="text-xs text-fg-muted">（用經濟級的模型：便宜、快）</span>
      </label>
      {check?.ok ? (
        <Button
          size="sm"
          variant="primary"
          data-testid="storyboard-generate-confirm"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy ? '開始中…' : '開始生成'}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" data-testid="storyboard-batch-cancel" onClick={onCancel}>
        先不要
      </Button>
    </div>
  )
}
