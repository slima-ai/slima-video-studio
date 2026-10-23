import {
  CAMERA_MOVES,
  cameraMoveById,
  type RegenerateMode,
  type ShotEdit,
  type ShotView,
  type TakeView,
  formatDate,
} from '@svs/schema'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { SimpleSelect } from '../../components/list-select'
import { assetUrl } from '../../lib/asset'
import { call, errorText } from '../../lib/svs'
import { STEP_LABEL } from './step-label'
import { diffDraft, draftOf, type Draft } from './draft'
import { ShotSound } from '../sound/shot-sound'

export interface ShotPanelProps {
  shot: ShotView
  /** 沒給就不畫自己的標題列（放在畫布的浮動面板裡，標題與關閉鈕由面板畫）。 */
  onClose?: () => void
}

const DURATIONS = [3, 5, 8, 10]

/** 版本列表上顯示的模型名稱：查得到就用白話名稱，查不到就顯示原本的 id。 */
export function useModelNames(): (id: string) => string {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    let alive = true
    call('models.list', {})
      .then(({ models }) => {
        if (alive) setNames(new Map(models.map((m) => [m.id, m.displayName])))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return (id) => names.get(id) ?? id
}

const timeText = (iso: string): string => formatDate(iso, 'timeShort')

interface EditorProps {
  shot: ShotView
  busy: boolean
  onRun: (mode: RegenerateMode | 'save', edit: ShotEdit) => void
}

/** 描述、運鏡、秒數、Prompt 的編輯區。存檔後內容一變就整個重新建立，草稿跟著重設。 */
function ShotEditor({ shot, busy, onRun }: EditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(shot))
  const edit = diffDraft(shot, draft)
  const dirty = Object.keys(edit).length > 0
  const generating = shot.activity !== undefined
  const locked = busy || generating
  const set = (patch: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
  }
  const durations = DURATIONS.includes(draft.durationSec)
    ? DURATIONS
    : [...DURATIONS, draft.durationSec].sort((a, b) => a - b)

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">
        這一鏡發生什麼事
        <textarea
          data-testid="shot-description"
          rows={3}
          value={draft.description}
          onChange={(event) => {
            set({ description: event.target.value })
          }}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="block text-sm font-medium">鏡頭怎麼動</span>
          <div className="mt-1">
            <SimpleSelect
              label="鏡頭怎麼動"
              testId="shot-camera"
              value={draft.cameraMove}
              options={[
                { value: '', label: '不指定' },
                ...CAMERA_MOVES.map((move) => ({ value: move.id, label: move.label })),
                ...(draft.cameraMove !== '' && !cameraMoveById(draft.cameraMove)
                  ? [{ value: draft.cameraMove, label: `自訂：${draft.cameraMove}` }]
                  : []),
              ]}
              onChange={(value) => {
                set({ cameraMove: value })
              }}
            />
          </div>
        </div>
        <div>
          <span className="block text-sm font-medium">長度</span>
          <div className="mt-1">
            <SimpleSelect
              label="長度"
              testId="shot-duration"
              value={String(draft.durationSec)}
              options={durations.map((n) => ({ value: String(n), label: `${String(n)} 秒` }))}
              onChange={(value) => {
                set({ durationSec: Number(value) })
              }}
            />
          </div>
        </div>
      </div>
      <p className="-mt-1 text-xs text-fg-muted" data-testid="shot-camera-hint">
        {cameraMoveById(draft.cameraMove)?.description ?? '不指定時，由模型自己決定鏡頭怎麼動。'}
      </p>
      <div>
        <label className="block text-sm font-medium" htmlFor="shot-prompt">
          送給模型的 Prompt
          <span className="ml-2 text-xs font-normal text-fg-muted">
            {shot.prompt ? '（你改過的版本）' : '（自動組出的）'}
          </span>
        </label>
        <textarea
          id="shot-prompt"
          data-testid="shot-prompt"
          rows={4}
          value={draft.prompt}
          onChange={(event) => {
            set({ prompt: event.target.value })
          }}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        {shot.prompt || draft.prompt.trim() !== shot.autoPrompt ? (
          <button
            type="button"
            data-testid="shot-prompt-reset"
            className="mt-1 text-xs text-accent hover:underline"
            onClick={() => {
              set({ prompt: shot.autoPrompt })
            }}
          >
            還原成自動組出的內容
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          data-testid="shot-apply"
          disabled={locked || draft.description.trim() === ''}
          onClick={() => {
            onRun('apply', edit)
          }}
        >
          套用修改並重新生成
        </Button>
        <Button
          data-testid="shot-save"
          disabled={locked || !dirty || draft.description.trim() === ''}
          onClick={() => {
            onRun('save', edit)
          }}
        >
          只儲存修改
        </Button>
      </div>
      <p className="text-xs text-fg-muted">
        重新生成只會重做有變動的部分，會再花一次這個鏡頭的費用。
      </p>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-sm font-medium">想要不同的結果？</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            data-testid="shot-regen-video"
            disabled={locked}
            onClick={() => {
              onRun('video', edit)
            }}
          >
            只換一支影片
          </Button>
          <Button
            size="sm"
            data-testid="shot-regen-all"
            disabled={locked}
            onClick={() => {
              onRun('all', edit)
            }}
          >
            整個鏡頭重做
          </Button>
        </div>
      </div>
    </div>
  )
}

export function VersionList({
  title,
  takes,
  modelName,
  onAdopt,
  onPreview,
  previewId,
  locked,
}: {
  title: string
  takes: TakeView[]
  modelName: (id: string) => string
  onAdopt?: (id: string) => void
  onPreview?: (id: string) => void
  previewId?: string | undefined
  locked: boolean
}) {
  if (takes.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{title}</p>
      <ul className="space-y-1" data-testid="shot-versions">
        {[...takes].reverse().map((take) => (
          <li
            key={take.id}
            data-testid={`shot-version-${String(take.version)}`}
            data-adopted={take.adopted}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium">版本 {take.version}</span>
              {take.adopted ? <span className="ml-1 text-success">（目前使用）</span> : null}
              <span className="block truncate text-xs text-fg-muted">
                {modelName(take.modelId)}・{timeText(take.createdAt)}
              </span>
            </span>
            <span className="flex shrink-0 gap-1">
              {onPreview ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={previewId === take.id}
                  onClick={() => {
                    onPreview(take.id)
                  }}
                >
                  預覽
                </Button>
              ) : null}
              {onAdopt ? (
                <Button
                  size="sm"
                  data-testid={`shot-adopt-${String(take.version)}`}
                  disabled={take.adopted || locked}
                  onClick={() => {
                    onAdopt(take.id)
                  }}
                >
                  使用這個版本
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 一個鏡頭的詳情：預覽、修改內容、重新生成、各個版本（可以切回舊版本）。 */
export function ShotPanel({ shot, onClose }: ShotPanelProps) {
  const modelName = useModelNames()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [previewId, setPreviewId] = useState<string | undefined>()
  const generating = shot.activity !== undefined

  const adopted = shot.videos.find((v) => v.adopted)
  const shown = shot.videos.find((v) => v.id === previewId) ?? adopted
  const frame = shot.firstFrames.find((t) => t.adopted) ?? shot.firstFrames.at(-1)

  const guarded = (work: () => Promise<unknown>): void => {
    setBusy(true)
    setError(undefined)
    work()
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const run = (mode: RegenerateMode | 'save', edit: ShotEdit): void => {
    guarded(async () => {
      if (Object.keys(edit).length > 0) await call('shots.update', { shotId: shot.id, patch: edit })
      if (mode !== 'save') await call('shots.regenerate', { shotId: shot.id, mode })
    })
  }

  const signature = JSON.stringify([
    shot.description,
    shot.cameraMove,
    shot.durationSec,
    shot.prompt,
    shot.autoPrompt,
  ])

  return (
    <aside
      aria-label={`第 ${String(shot.number)} 鏡`}
      data-testid="shot-panel"
      className={onClose ? 'space-y-4 p-6' : 'space-y-4 p-4'}
    >
      {onClose ? (
        <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-center justify-between bg-surface-raised/90 px-6 py-4 backdrop-blur-md">
          <h2 className="text-lg font-semibold">第 {shot.number} 鏡</h2>
          <Button size="sm" variant="ghost" data-testid="shot-panel-close" onClick={onClose}>
            關閉
          </Button>
        </div>
      ) : null}

      <div className="aspect-video overflow-hidden rounded-md border border-border bg-black">
        {shown ? (
          <video
            key={shown.id}
            data-testid="shot-preview"
            controls
            src={assetUrl(shown.assetHash)}
            className="size-full"
          />
        ) : frame ? (
          <img
            data-testid="shot-preview-image"
            src={assetUrl(frame.assetHash)}
            alt={`第 ${String(shot.number)} 鏡的畫面`}
            className="size-full object-cover"
          />
        ) : (
          <p className="flex size-full items-center justify-center text-sm text-fg-muted">
            還沒有畫面
          </p>
        )}
      </div>

      {generating ? (
        <div
          className="flex items-center justify-between rounded-md bg-surface-overlay p-2 text-sm"
          data-testid="shot-activity"
        >
          <span>正在{STEP_LABEL[shot.activity?.step ?? 'prompt']}…</span>
          <Button
            size="sm"
            variant="ghost"
            data-testid="shot-cancel"
            onClick={() => {
              call('shots.cancel', { shotId: shot.id }).catch(() => undefined)
            }}
          >
            取消
          </Button>
        </div>
      ) : null}
      {shot.error && !generating ? (
        <p role="alert" className="text-sm text-danger" data-testid="shot-error">
          上一次沒有成功：{shot.error}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger" data-testid="shot-action-error">
          {error}
        </p>
      ) : null}

      <ShotEditor key={`${shot.id}:${signature}`} shot={shot} busy={busy} onRun={run} />

      <ShotSound shotId={shot.id} />

      <VersionList
        title="影片的各個版本"
        takes={shot.videos}
        modelName={modelName}
        previewId={shown?.id}
        onPreview={setPreviewId}
        onAdopt={(takeId) => {
          guarded(async () => {
            await call('shots.adopt', { takeId })
            setPreviewId(undefined)
          })
        }}
        locked={busy || generating}
      />
      {shot.firstFrames.length > 1 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">第一張畫面的各個版本</p>
          <ul className="flex flex-wrap gap-2" data-testid="shot-frames">
            {[...shot.firstFrames].reverse().map((take) => (
              <li key={take.id} className="w-20 text-center text-xs text-fg-muted">
                <img
                  src={assetUrl(take.assetHash)}
                  alt={`第一張畫面版本 ${String(take.version)}`}
                  className={
                    take.adopted
                      ? 'aspect-video w-full rounded border-2 border-accent object-cover'
                      : 'aspect-video w-full rounded border border-border object-cover'
                  }
                />
                版本 {take.version}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  )
}
