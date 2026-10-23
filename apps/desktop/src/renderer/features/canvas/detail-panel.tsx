import type {
  CanvasRunPlan,
  CanvasRunRequest,
  CharacterView,
  LocationCardView,
  OutlineView,
  ShotsSnapshot,
  ModelTier,
} from '@svs/schema'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '../../components/button'
import { SimpleSelect } from '../../components/list-select'
import { assetUrl } from '../../lib/asset'
import { call, errorText } from '../../lib/svs'
import { CharacterDetail } from '../characters/characters-page'
import { LocationCard } from '../locations/locations-page'
import { CommitText } from '../outline/fields'
import { ShotPanel, useModelNames, VersionList } from '../shots/shot-panel'
import type { CanvasNode, NodeKind } from './canvas-model'
import { FinalCutPanel } from './final-cut-panel'
import { FloatingPanel, type PanelTab } from './floating-panel'
import { QualitySwitch, runLines } from './run-confirm-plan'
import { t } from '@svs/schema'

/** 打開的是哪一格的面板。 */
export type PanelTarget =
  | { kind: 'shot' | 'image' | 'video'; shotId: string }
  | { kind: 'cut' }
  | { kind: 'character' | 'location' | 'scene'; id: string }

/** 格子鍵 → 要打開的面板；一句話、便條、群組、獨立圖片這些沒有面板。 */
export function panelTargetOf(nodeId: string): PanelTarget | undefined {
  if (nodeId === 'cut') return { kind: 'cut' }
  const [kind, id, part] = nodeId.split(':')
  if (id === undefined || id === '') return undefined
  if (kind === 'shot') {
    if (part === undefined) return { kind: 'shot', shotId: id }
    if (part === 'image' || part === 'video') return { kind: part, shotId: id }
    return undefined
  }
  if ((kind === 'character' || kind === 'location' || kind === 'scene') && part === undefined) {
    return { kind, id }
  }
  return undefined
}

/** 面板對應的格子鍵（找畫布上的格子、標題、試跑用）。 */
export function keyOfTarget(target: PanelTarget): string {
  switch (target.kind) {
    case 'cut':
      return 'cut'
    case 'shot':
      return `shot:${target.shotId}`
    case 'image':
    case 'video':
      return `shot:${target.shotId}:${target.kind}`
    case 'character':
    case 'location':
    case 'scene':
      return `${target.kind}:${target.id}`
  }
}

/** 生成類的格子才有「試跑」。 */
const hasTrial = (target: PanelTarget): boolean =>
  target.kind === 'shot' || target.kind === 'image' || target.kind === 'video'

/** 每個鏡頭都有採用中的影片，而且沒有鏡頭正在生成，才能接片。 */
const canRejoin = (snapshot: ShotsSnapshot): boolean =>
  snapshot.shots.length > 0 &&
  snapshot.shots.every((s) => s.activity === undefined && s.videos.some((v) => v.adopted))

/** 標題：鏡頭的圖與影片帶上是第幾鏡。 */
function titleOf(target: PanelTarget, nodes: readonly CanvasNode[]): string {
  const title = (key: string): string => nodes.find((n) => n.id === key)?.data.title ?? ''
  if (target.kind === 'image')
    return t('canvas.firstFrame4', { value: title(`shot:${target.shotId}`) })
  if (target.kind === 'video') return t('canvas.video4', { value: title(`shot:${target.shotId}`) })
  return title(keyOfTarget(target))
}

/**
 * 畫布右側的浮動面板（uiux-spec §12.12）：依格子種類放內容——
 * 鏡頭＝描述、Prompt、運鏡、版本、重新生成；圖／影片＝所有版本與採用；角色＝角色卡；
 * 地點＝場景卡；場＝欄位；剪輯＝成品、重新接片、匯出。生成類的格子多一個「試跑」分頁。
 */
export function DetailPanel({
  target,
  snapshot,
  nodes,
  refreshKey,
  onChanged,
  onRun,
  quality,
  onQuality,
  onClose,
  top,
}: {
  /** 離畫布上緣的距離（讓開上方列）。 */
  top?: number
  target: PanelTarget | undefined
  snapshot: ShotsSnapshot
  nodes: readonly CanvasNode[]
  /** 畫布重新載入時換一個值：面板裡從後端讀的內容跟著重讀。 */
  refreshKey: unknown
  /** 面板裡改了資料：畫布重新載入。 */
  onChanged: () => void
  /** 試跑分頁按「執行」。 */
  onRun: (request: CanvasRunRequest, plan: CanvasRunPlan) => void
  /** 生成鈕旁的品質（和畫布上的確認面板共用）；沒給 onQuality 就不顯示切換。 */
  quality?: ModelTier | undefined
  onQuality?: (next: ModelTier | undefined) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<PanelTab>('edit')
  const key = target ? keyOfTarget(target) : undefined
  // 換了一格就回到「編輯」
  const [shownKey, setShownKey] = useState(key)
  if (shownKey !== key) {
    setShownKey(key)
    setTab('edit')
  }
  const shot =
    target && 'shotId' in target ? snapshot.shots.find((s) => s.id === target.shotId) : undefined
  // 鏡頭被刪掉了就收起
  const open = target !== undefined && (!('shotId' in target) || shot !== undefined)
  const kind: NodeKind | undefined = target?.kind
  const trial = target !== undefined && hasTrial(target)

  let body = null
  if (target && open) {
    if (tab === 'trial' && trial && key) {
      body = (
        <TrialTab
          nodeKey={key}
          refreshKey={refreshKey}
          onRun={onRun}
          quality={quality}
          {...(onQuality ? { onQuality } : {})}
        />
      )
    } else if (target.kind === 'shot' && shot) {
      body = <ShotPanel key={shot.id} shot={shot} />
    } else if ((target.kind === 'image' || target.kind === 'video') && shot) {
      body = <TakesPanel key={`${shot.id}:${target.kind}`} shot={shot} kind={target.kind} />
    } else if (target.kind === 'cut') {
      body = (
        <FinalCutPanel finalVideoHash={snapshot.finalVideoHash} canRejoin={canRejoin(snapshot)} />
      )
    } else if (target.kind === 'character') {
      body = (
        <CharacterBody
          key={target.id}
          id={target.id}
          refreshKey={refreshKey}
          onChanged={onChanged}
        />
      )
    } else if (target.kind === 'location') {
      body = (
        <LocationBody
          key={target.id}
          id={target.id}
          refreshKey={refreshKey}
          onChanged={onChanged}
        />
      )
    } else if (target.kind === 'scene') {
      body = (
        <SceneBody key={target.id} id={target.id} refreshKey={refreshKey} onChanged={onChanged} />
      )
    }
  }

  return (
    <FloatingPanel
      open={open}
      top={top}
      kind={kind}
      title={target ? titleOf(target, nodes) : ''}
      tabs={trial}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
    >
      {body}
    </FloatingPanel>
  )
}

/** 圖或影片的所有版本：上面預覽，下面的版本可以預覽、改用。 */
function TakesPanel({
  shot,
  kind,
}: {
  shot: ShotsSnapshot['shots'][number]
  kind: 'image' | 'video'
}) {
  const modelName = useModelNames()
  const [previewId, setPreviewId] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const takes = kind === 'video' ? shot.videos : shot.firstFrames
  const adopted = takes.find((t) => t.adopted)
  const shown = takes.find((t) => t.id === previewId) ?? adopted
  const generating = shot.activity !== undefined
  return (
    <section className="space-y-4 p-4" data-testid={`takes-panel-${kind}`}>
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-black">
        {shown ? (
          kind === 'video' ? (
            <video
              key={shown.id}
              data-testid="takes-preview"
              controls
              src={assetUrl(shown.assetHash)}
              className="size-full"
            />
          ) : (
            <img
              data-testid="takes-preview"
              src={assetUrl(shown.assetHash)}
              alt={t('canvas.version', { value: String(shown.version) })}
              className="size-full object-cover"
            />
          )
        ) : (
          <p className="flex size-full items-center justify-center text-sm text-fg-muted">
            {kind === 'video' ? t('canvas.noVideoInUseYet') : t('canvas.noFirstFrameInUse')}
          </p>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {takes.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('canvas.noVersionsYetOpenThe')}</p>
      ) : (
        <VersionList
          title={kind === 'video' ? t('canvas.videoVersions') : t('canvas.firstFrameVersions')}
          takes={takes}
          modelName={modelName}
          previewId={shown?.id}
          onPreview={setPreviewId}
          onAdopt={(takeId) => {
            setBusy(true)
            setError(undefined)
            call('shots.adopt', { takeId })
              .then(() => {
                setPreviewId(undefined)
              })
              .catch((e: unknown) => {
                setError(errorText(e))
              })
              .finally(() => {
                setBusy(false)
              })
          }}
          locked={busy || generating}
        />
      )}
    </section>
  )
}

/** 試跑：這一格這次會做哪些步驟、用哪個模型、預估花費；按「執行」就開始。 */
function TrialTab({
  nodeKey,
  refreshKey,
  onRun,
  quality,
  onQuality,
}: {
  nodeKey: string
  refreshKey: unknown
  onRun: (request: CanvasRunRequest, plan: CanvasRunPlan) => void
  quality: ModelTier | undefined
  onQuality?: (next: ModelTier | undefined) => void
}) {
  const [plan, setPlan] = useState<CanvasRunPlan>()
  const [error, setError] = useState<string>()
  const request: CanvasRunRequest = useMemo(
    () => ({ keys: [nodeKey], ...(quality ? { quality } : {}) }),
    [nodeKey, quality],
  )
  useEffect(() => {
    let alive = true
    call('canvas.runPlan', request)
      .then((next) => {
        if (alive) {
          setPlan(next)
          setError(undefined)
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e))
      })
    return () => {
      alive = false
    }
  }, [request, refreshKey])
  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-danger">
        {error}
      </p>
    )
  }
  if (!plan) return <p className="p-4 text-sm text-fg-muted">{t('canvas.workingItOut')}</p>
  if (!plan.ok) {
    return (
      <p className="p-4 text-sm text-fg-muted" data-testid="trial-issue">
        {plan.issue ?? t('canvas.canTRunRightNow2')}
      </p>
    )
  }
  if (plan.steps.length === 0) {
    return (
      <p className="p-4 text-sm text-fg-muted" data-testid="trial-empty">
        {t('canvas.everythingIsAlreadyGeneratedSo')}
      </p>
    )
  }
  const lines = runLines(plan)
  return (
    <section className="space-y-3 p-4" data-testid="trial-tab">
      {onQuality && plan.shotCount > 0 ? (
        <QualitySwitch value={quality} onChange={onQuality} />
      ) : null}
      <p className="text-sm font-medium">
        {t('canvas.thisWillDoSteps', { value: String(plan.steps.length) })}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted" data-testid="trial-steps">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-sm" data-testid="trial-cost">
        {plan.estimateIsLowerBound
          ? t('canvas.estimatedCostAtLeastUs', { value: plan.estimatedUsd.toFixed(2) })
          : t('canvas.estimatedCostUs', { value: plan.estimatedUsd.toFixed(2) })}
      </p>
      <Button
        variant="primary"
        data-testid="trial-run"
        onClick={() => {
          onRun(request, plan)
        }}
      >
        {t('canvas.run')}
      </Button>
    </section>
  )
}

/** 從後端讀一份資料；`refreshKey` 換了就重讀。 */
function useLoaded<T>(load: () => Promise<T>, refreshKey: unknown) {
  const [value, setValue] = useState<T>()
  const [error, setError] = useState<string>()
  const reload = useCallback(() => {
    load()
      .then((next) => {
        setValue(next)
        setError(undefined)
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }, [load])
  useEffect(() => {
    reload()
  }, [reload, refreshKey])
  return { value, error, reload, setValue }
}

function CharacterBody({
  id,
  refreshKey,
  onChanged,
}: {
  id: string
  refreshKey: unknown
  onChanged: () => void
}) {
  const load = useCallback(
    () => call('characters.list', {}).then(({ characters }) => characters.find((c) => c.id === id)),
    [id],
  )
  const { value, error, setValue } = useLoaded<CharacterView | undefined>(load, refreshKey)
  if (error) return <p className="p-4 text-sm text-danger">{error}</p>
  if (!value) return null
  return (
    <div className="space-y-4 p-4" data-testid="character-panel">
      <CharacterDetail
        character={value}
        onChanged={(next) => {
          setValue(next)
          onChanged()
        }}
      />
    </div>
  )
}

function LocationBody({
  id,
  refreshKey,
  onChanged,
}: {
  id: string
  refreshKey: unknown
  onChanged: () => void
}) {
  const load = useCallback(
    () => call('locations.list', {}).then(({ locations }) => locations.find((c) => c.id === id)),
    [id],
  )
  const { value, error, reload, setValue } = useLoaded<LocationCardView | undefined>(
    load,
    refreshKey,
  )
  if (error) return <p className="p-4 text-sm text-danger">{error}</p>
  if (!value) return null
  return (
    <div className="p-4" data-testid="location-panel">
      <LocationCard
        card={value}
        onChanged={(next) => {
          setValue(next)
          onChanged()
        }}
        onReload={reload}
      />
    </div>
  )
}

interface ScenePatch {
  title?: string
  summary?: string
  locationId?: string | null
  timeOfDay?: string | null
  mood?: string | null
}

/** 場的欄位：名字、摘要、地點、時段、氣氛（離開輸入框就存，可以復原）。 */
function SceneBody({
  id,
  refreshKey,
  onChanged,
}: {
  id: string
  refreshKey: unknown
  onChanged: () => void
}) {
  const load = useCallback(() => call('outline.get', {}), [])
  const { value, error, setValue } = useLoaded<OutlineView>(load, refreshKey)
  const [saveError, setSaveError] = useState<string>()
  const scene = value?.acts.flatMap((a) => a.scenes).find((s) => s.id === id)
  if (error) return <p className="p-4 text-sm text-danger">{error}</p>
  if (!value || !scene) return null
  const save = (patch: ScenePatch): void => {
    setSaveError(undefined)
    call('outline.edit', { op: 'updateScene', sceneId: id, patch })
      .then((next) => {
        setValue(next)
        onChanged()
      })
      .catch((e: unknown) => {
        setSaveError(errorText(e))
      })
  }
  return (
    <section className="space-y-3 p-4" data-testid="scene-panel">
      <CommitText
        label={t('canvas.sceneName')}
        value={scene.title}
        testId="scene-panel-title"
        maxLength={200}
        onCommit={(title) => {
          if (title.trim() !== '') save({ title: title.trim() })
        }}
      />
      <CommitText
        label={t('canvas.whatHappensInThisScene')}
        value={scene.summary}
        testId="scene-panel-summary"
        rows={4}
        onCommit={(summary) => {
          save({ summary })
        }}
      />
      <div className="space-y-1 text-sm font-medium">
        <span>{t('canvas.location')}</span>
        <SimpleSelect
          testId="scene-panel-location"
          label={t('canvas.location')}
          value={scene.locationId ?? ''}
          options={[
            { value: '', label: t('canvas.notSet') },
            ...value.locations.map((l) => ({ value: l.id, label: l.name })),
          ]}
          onChange={(locationId) => {
            save({ locationId: locationId === '' ? null : locationId })
          }}
        />
      </div>
      <CommitText
        label={t('canvas.timeOfDayForExample')}
        value={scene.timeOfDay ?? ''}
        testId="scene-panel-time"
        maxLength={100}
        onCommit={(timeOfDay) => {
          save({ timeOfDay: timeOfDay.trim() === '' ? null : timeOfDay.trim() })
        }}
      />
      <CommitText
        label={t('canvas.mood')}
        value={scene.mood ?? ''}
        testId="scene-panel-mood"
        maxLength={100}
        onCommit={(mood) => {
          save({ mood: mood.trim() === '' ? null : mood.trim() })
        }}
      />
      {saveError ? (
        <p role="alert" className="text-sm text-danger">
          {saveError}
        </p>
      ) : null}
    </section>
  )
}
