import type { JobKind, RecordsFilter } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { FilterChips, Page } from '../../components/page'
import type { AppView } from '../../components/app-layout'
import { KIND_LABEL, RecordRow } from './record-row'
import { useRecords } from './use-records'
import { t } from '@svs/schema'

const KINDS: readonly JobKind[] = ['image', 'video', 'llm']

export interface RecordsPageProps {
  onNavigate: (view: AppView) => void
}

/** 生成紀錄：每一次送給模型的請求——用了什麼 prompt、哪個模型、花多久、花多少、結果是什麼。 */
export function RecordsPage({ onNavigate }: RecordsPageProps) {
  const [kind, setKind] = useState<JobKind | ''>('')
  const [outcome, setOutcome] = useState<'succeeded' | 'failed' | ''>('')
  const [notice, setNotice] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const filter: RecordsFilter = {
    ...(kind ? { kind } : {}),
    ...(outcome ? { outcome } : {}),
  }
  const { snapshot, error } = useRecords(filter)

  return (
    <Page
      title={t('records.generationRecords')}
      hint={t('records.everyRequestSentToA')}
      testId="records-page"
      actions={
        <>
          <FilterChips
            label={t('records.type')}
            showLabel
            testId="records-kind"
            value={kind}
            options={[
              { value: '', label: t('records.all') },
              ...KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) })),
            ]}
            onChange={setKind}
          />
          <FilterChips
            label={t('records.result2')}
            showLabel
            testId="records-outcome"
            value={outcome}
            options={[
              { value: '', label: t('records.all') },
              { value: 'succeeded', label: t('records.succeeded') },
              { value: 'failed', label: t('records.failed') },
            ]}
            onChange={setOutcome}
          />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {snapshot ? (
          <p data-testid="records-summary" className="text-sm text-fg-muted">
            {snapshot.total > snapshot.records.length
              ? t('records.recordsAboutUsSpentShowing', {
                  total: snapshot.total,
                  value: snapshot.totalCostUsd.toFixed(2),
                  value2: String(snapshot.records.length),
                })
              : t('records.recordsAboutUsSpent', {
                  total: snapshot.total,
                  value: snapshot.totalCostUsd.toFixed(2),
                })}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {problem ? (
          <p role="alert" data-testid="records-problem" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}
        {notice ? (
          <p data-testid="records-notice" className="flex items-center gap-2 text-sm">
            {notice}
            <Button
              size="sm"
              variant="ghost"
              data-testid="records-go-storyboard"
              onClick={() => {
                onNavigate('storyboard')
              }}
            >
              {t('records.seeProgressInTheStoryboard')}
            </Button>
          </p>
        ) : null}

        {snapshot?.records.length === 0 ? (
          <p data-testid="records-empty" className="text-sm text-fg-muted">
            {kind || outcome
              ? t('records.noRecordsMatch')
              : t('records.nothingHasBeenGeneratedYet')}
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {snapshot?.records.map((record) => (
            <RecordRow
              key={record.id}
              record={record}
              onRedo={(label) => {
                setProblem(undefined)
                setNotice(t('records.startedGeneratingAgain', { label }))
              }}
              onError={(message) => {
                setNotice(undefined)
                setProblem(message)
              }}
            />
          ))}
        </ul>
      </div>
    </Page>
  )
}
