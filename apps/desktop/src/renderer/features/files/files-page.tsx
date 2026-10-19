import type { FilesFilter } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { FilterChips, Page } from '../../components/page'
import { formatBytes } from '../../lib/bytes'
import { call, errorText } from '../../lib/svs'
import { FileRow, timeText } from './file-row'
import { useFiles } from './use-files'

type Choice = 'all' | 'image' | 'video' | 'unused'

const CHOICES: readonly { id: Choice; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '圖片' },
  { id: 'video', label: '影片' },
  { id: 'unused', label: '沒被使用' },
]

const filterOf = (choice: Choice): FilesFilter => {
  switch (choice) {
    case 'image':
      return { kind: 'image' }
    case 'video':
      return { kind: 'video' }
    case 'unused':
      return { unusedOnly: true }
    case 'all':
      return {}
  }
}

/** 檔案紀錄：專案裡所有生成出來的圖片與影片、它們用在哪裡，以及匯出的成品。 */
export function FilesPage() {
  const [choice, setChoice] = useState<Choice>('all')
  const [problem, setProblem] = useState<string>()
  const { snapshot, error } = useFiles(filterOf(choice))

  const revealExport = (name: string): void => {
    setProblem(undefined)
    call('files.reveal', { exportName: name }).catch((e: unknown) => {
      setProblem(errorText(e))
    })
  }

  return (
    <Page
      title="檔案"
      hint="專案裡生成的圖片與影片、各自用在哪裡，以及匯出的成品"
      testId="files-page"
      actions={
        <FilterChips
          label="篩選"
          testId="files-filter"
          value={choice}
          options={CHOICES.map((c) => ({ value: c.id, label: c.label }))}
          onChange={setChoice}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {snapshot ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span data-testid="files-summary">
              共 {snapshot.files.length} 個檔案・{formatBytes(snapshot.totalBytes)}
            </span>
            {snapshot.projectDir ? (
              <span
                className="min-w-0 truncate text-xs"
                title={snapshot.projectDir}
                data-testid="files-project-dir"
              >
                專案資料夾：{snapshot.projectDir}
              </span>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {problem ? (
          <p role="alert" data-testid="files-problem" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}

        {snapshot?.exports.length ? (
          <div data-testid="files-exports" className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">匯出的成品</h2>
            <ul className="flex flex-col gap-1.5">
              {snapshot.exports.map((e) => (
                <li
                  key={e.name}
                  data-testid="export"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-raised shadow-card px-3 py-2 text-sm"
                >
                  <span className="font-medium">{e.name}</span>
                  <span className="text-xs text-fg-muted">
                    {formatBytes(e.bytes)}・{timeText(e.modifiedAt)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="export-reveal"
                    onClick={() => {
                      revealExport(e.name)
                    }}
                  >
                    在資料夾中顯示
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {snapshot?.files.length === 0 ? (
          <p data-testid="files-empty" className="text-sm text-fg-muted">
            {choice === 'all'
              ? '還沒有任何檔案。到畫布寫一句話做一支影片，生成的圖片和影片都會列在這裡。'
              : '沒有符合的檔案。'}
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {snapshot?.files.map((file) => (
            <FileRow
              key={file.hash}
              file={file}
              onError={(message) => {
                setProblem(message)
              }}
            />
          ))}
        </ul>
      </div>
    </Page>
  )
}
