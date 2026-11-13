import {
  CAMERA_MOVES,
  cameraMoveById,
  cameraMoveHint,
  cameraMoveLabel,
  type RegenerateMode,
  type ShotEdit,
  type ShotView,
  type TakeView,
  beatKindLabel,
  formatDate,
  isLocalModel,
  secLabel,
  t,
  type BeatKind,
} from '@svs/schema'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { SimpleSelect } from '../../components/list-select'
import { assetUrl } from '../../lib/asset'
import { call, errorText } from '../../lib/svs'
import { STEP_LABEL } from './step-label'
import { diffDraft, draftOf, hasPicture, type Draft } from './draft'
import { ShotSound } from '../sound/shot-sound'
import { TrimPlayer } from './trim-player'
import { trimHintOnAdopt } from './trim-hint'

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
  // 本機做的格子（不動的畫面、字卡）：不是模型，寫「本機・不花錢」
  return (id) => (isLocalModel(id) ? t('trailer.localFree') : (names.get(id) ?? id))
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

  const picture = hasPicture(draft.beatKind)
  // 字卡沒有字就不能存（也不能生成）
  const emptyCard = draft.beatKind === 'card' && draft.cardText.trim() === ''
  const blocked = picture ? draft.description.trim() === '' : emptyCard

  return (
    <div className="space-y-3">
      {shot.beatKind === 'title' ? (
        <p className="text-sm text-fg-muted" data-testid="shot-beat-title-note">
          {t('trailer.titleCardNote')}
        </p>
      ) : (
        <div>
          <span className="block text-sm font-medium">{t('trailer.beatKindLabel')}</span>
          <div className="mt-1">
            <SimpleSelect
              label={t('trailer.beatKindLabel')}
              testId="shot-beat"
              value={draft.beatKind}
              options={(['video', 'still', 'card'] as const).map((kind) => ({
                value: kind,
                label: beatKindLabel(kind),
              }))}
              onChange={(value) => {
                set({ beatKind: value as BeatKind })
              }}
            />
          </div>
          <p className="mt-1 text-xs text-fg-muted">{t('trailer.beatKindHint')}</p>
        </div>
      )}
      {draft.beatKind === 'card' ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium">
            {t('trailer.cardText')}
            <input
              data-testid="shot-card-text"
              type="text"
              maxLength={60}
              value={draft.cardText}
              placeholder={t('trailer.cardTextPlaceholder')}
              onChange={(event) => {
                set({ cardText: event.target.value })
              }}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="block text-sm font-medium">
            {t('trailer.cardSubtext')}
            <input
              data-testid="shot-card-subtext"
              type="text"
              maxLength={120}
              value={draft.cardSubtext}
              onChange={(event) => {
                set({ cardSubtext: event.target.value })
              }}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal"
            />
          </label>
        </div>
      ) : null}
      {picture ? (
        <label className="block text-sm font-medium">
          {t('shots.whatHappensInThisShot')}
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
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {picture ? (
          <div>
            <span className="block text-sm font-medium">{t('shots.cameraMove')}</span>
            <div className="mt-1">
              <SimpleSelect
                label={t('shots.cameraMove')}
                testId="shot-camera"
                value={draft.cameraMove}
                options={[
                  { value: '', label: t('shots.notSet') },
                  ...CAMERA_MOVES.map((move) => ({
                    value: move.id,
                    label: cameraMoveLabel(move.id),
                  })),
                  ...(draft.cameraMove !== '' && !cameraMoveById(draft.cameraMove)
                    ? [
                        {
                          value: draft.cameraMove,
                          label: t('shots.custom', { cameraMove: draft.cameraMove }),
                        },
                      ]
                    : []),
                ]}
                onChange={(value) => {
                  set({ cameraMove: value })
                }}
              />
            </div>
          </div>
        ) : null}
        <div>
          <span className="block text-sm font-medium">{t('shots.length')}</span>
          <div className="mt-1">
            <SimpleSelect
              label={t('shots.length')}
              testId="shot-duration"
              value={String(draft.durationSec)}
              options={durations.map((n) => ({
                value: String(n),
                label: t('shots.sec', { value: secLabel(n) }),
              }))}
              onChange={(value) => {
                set({ durationSec: Number(value) })
              }}
            />
          </div>
        </div>
      </div>
      {shot.lengthOverMax ? (
        <p role="status" className="text-xs text-warning" data-testid="shot-over-max">
          {t('trailer.lengthOverMax', {
            want: String(shot.lengthOverMax.wantSec),
            max: String(shot.lengthOverMax.maxSec),
          })}
        </p>
      ) : null}
      {picture ? (
        <p className="-mt-1 text-xs text-fg-muted" data-testid="shot-camera-hint">
          {cameraMoveHint(draft.cameraMove) ?? t('shots.whenNotSetTheModel')}
        </p>
      ) : null}
      {picture ? (
        <div>
          <label className="block text-sm font-medium" htmlFor="shot-prompt">
            {t('shots.promptSentToTheModel')}
            {shot.prompt ? (
              <span className="ml-2 text-xs font-normal text-fg-muted">
                {t('shots.yourEditedVersion')}
              </span>
            ) : null}
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
              {t('shots.restoreTheAutomaticText')}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          data-testid="shot-apply"
          disabled={locked || blocked}
          onClick={() => {
            onRun('apply', edit)
          }}
        >
          {t('shots.applyChangesAndGenerateAgain')}
        </Button>
        <Button
          data-testid="shot-save"
          disabled={locked || !dirty || blocked}
          onClick={() => {
            onRun('save', edit)
          }}
        >
          {t('shots.saveChangesOnly')}
        </Button>
      </div>
      <p className="text-xs text-fg-muted">{t('shots.generatingAgainOnlyRedoesWhat')}</p>

      {picture ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-sm font-medium">{t('shots.wantADifferentResult')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              data-testid="shot-regen-video"
              disabled={locked}
              onClick={() => {
                onRun('video', edit)
              }}
            >
              {t('shots.newVideoOnly')}
            </Button>
            <Button
              size="sm"
              data-testid="shot-regen-all"
              disabled={locked}
              onClick={() => {
                onRun('all', edit)
              }}
            >
              {t('shots.redoTheWholeShot')}
            </Button>
          </div>
        </div>
      ) : null}
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
              <span className="font-medium">{t('shots.version', { version: take.version })}</span>
              {take.adopted ? <span className="ml-1 text-success">{t('shots.inUse')}</span> : null}
              <span className="block truncate text-xs text-fg-muted">
                {`${modelName(take.modelId)}${t('list.dot')}${timeText(take.createdAt)}`}
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
                  {t('shots.preview')}
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
                  {t('shots.useThisVersion')}
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
  const [hint, setHint] = useState<string | undefined>()
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
    shot.beatKind,
    shot.card,
  ])

  return (
    <aside
      aria-label={t('shots.shot', { value: String(shot.number) })}
      data-testid="shot-panel"
      className={onClose ? 'space-y-4 p-6' : 'space-y-4 p-4'}
    >
      {onClose ? (
        <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-center justify-between bg-surface-raised/90 px-6 py-4 backdrop-blur-md">
          <h2 className="text-lg font-semibold">{t('shots.shot2', { number: shot.number })}</h2>
          <Button size="sm" variant="ghost" data-testid="shot-panel-close" onClick={onClose}>
            {t('shots.close')}
          </Button>
        </div>
      ) : null}

      {shown && shown.id === adopted?.id ? (
        // 使用中的影片：預覽加上頭尾裁切（時間尺、入點出點、I／O、逐格、只播留下的部分）
        <TrimPlayer shot={shot} take={shown} videoTestId="shot-preview" />
      ) : (
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
              alt={t('shots.pictureForShot', { value: String(shot.number) })}
              className="size-full object-cover"
            />
          ) : (
            <p className="flex size-full items-center justify-center text-sm text-fg-muted">
              {t('shots.noPictureYet')}
            </p>
          )}
        </div>
      )}
      {shown && shown.id !== adopted?.id ? (
        <p className="text-sm text-fg-muted" data-testid="trim-other-version">
          {t('shots.trimOtherVersion')}
        </p>
      ) : null}
      {hint ? (
        <p className="text-sm text-fg-muted" role="status" data-testid="trim-version-hint">
          {hint}
        </p>
      ) : null}

      {generating ? (
        <div
          className="flex items-center justify-between rounded-md bg-surface-overlay p-2 text-sm"
          data-testid="shot-activity"
        >
          <span>{t(STEP_LABEL[shot.activity?.step ?? 'prompt'])}</span>
          <Button
            size="sm"
            variant="ghost"
            data-testid="shot-cancel"
            onClick={() => {
              call('shots.cancel', { shotId: shot.id }).catch(() => undefined)
            }}
          >
            {t('shots.cancel')}
          </Button>
        </div>
      ) : null}
      {shot.error && !generating ? (
        <p role="alert" className="text-sm text-danger" data-testid="shot-error">
          {t('shots.lastTryFailed', { error: shot.error })}
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
        title={t('shots.videoVersions')}
        takes={shot.videos}
        modelName={modelName}
        previewId={shown?.id}
        onPreview={setPreviewId}
        onAdopt={(takeId) => {
          const next = shot.videos.find((v) => v.id === takeId)
          const note = trimHintOnAdopt(adopted, next)
          guarded(async () => {
            await call('shots.adopt', { takeId })
            setPreviewId(undefined)
            // 換版本之後提一句上一版剪過（不擋操作；各版本各自有裁切）
            setHint(note)
          })
        }}
        locked={busy || generating}
      />
      {shot.firstFrames.length > 1 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('shots.firstFrameVersions')}</p>
          <ul className="flex flex-wrap gap-2" data-testid="shot-frames">
            {[...shot.firstFrames].reverse().map((take) => (
              <li key={take.id} className="w-20 text-center text-xs text-fg-muted">
                <img
                  src={assetUrl(take.assetHash)}
                  alt={t('shots.firstFrameVersion', { value: String(take.version) })}
                  className={
                    take.adopted
                      ? 'aspect-video w-full rounded border-2 border-accent object-cover'
                      : 'aspect-video w-full rounded border border-border object-cover'
                  }
                />
                {t('shots.version', { version: take.version })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  )
}
