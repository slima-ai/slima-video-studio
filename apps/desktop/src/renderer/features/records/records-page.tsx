import type { JobKind, RecordsFilter } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { FilterChips, Page } from '../../components/page'
import type { AppView } from '../../components/app-layout'
import { KIND_LABEL, RecordRow } from './record-row'
import { useRecords } from './use-records'

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
      title="生成紀錄"
      hint="每一次送給模型的請求：用了什麼描述、哪個模型、花多久、花多少、結果是什麼"
      testId="records-page"
      actions={
        <>
          <FilterChips
            label="種類"
            showLabel
            testId="records-kind"
            value={kind}
            options={[
              { value: '', label: '全部' },
              ...KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
            ]}
            onChange={setKind}
          />
          <FilterChips
            label="結果"
            showLabel
            testId="records-outcome"
            value={outcome}
            options={[
              { value: '', label: '全部' },
              { value: 'succeeded', label: '成功' },
              { value: 'failed', label: '失敗' },
            ]}
            onChange={setOutcome}
          />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {snapshot ? (
          <p data-testid="records-summary" className="text-sm text-fg-muted">
            共 {snapshot.total} 筆・花了約 US${snapshot.totalCostUsd.toFixed(2)}
            {snapshot.total > snapshot.records.length
              ? `（先顯示最近 ${String(snapshot.records.length)} 筆）`
              : ''}
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
              到分鏡表看進度
            </Button>
          </p>
        ) : null}

        {snapshot?.records.length === 0 ? (
          <p data-testid="records-empty" className="text-sm text-fg-muted">
            {kind || outcome
              ? '沒有符合的紀錄。'
              : '還沒有生成過任何東西。到畫布寫一句話做一支影片，每一次生成都會記在這裡。'}
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {snapshot?.records.map((record) => (
            <RecordRow
              key={record.id}
              record={record}
              onRedo={(label) => {
                setProblem(undefined)
                setNotice(`已開始重新生成${label}。`)
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
