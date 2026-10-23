import type {
  OutlineActView,
  OutlineLocationView,
  OutlineOp,
  OutlineSceneView,
  OutlineSplitCheck,
  OutlineSplitResult,
  OutlineView,
} from '@svs/schema'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button'
import { SkeletonCards } from '../../components/skeleton'
import { UndoRedoButtons } from '../../components/undo-redo-buttons'
import { useDataVersion } from '../../lib/data-version'
import { call, errorText } from '../../lib/svs'
import { useEscape } from '../../lib/use-escape'
import { CommitText, SELECT_CLASS } from './fields'
import { Page } from '../../components/page'
import { t } from '@svs/schema'

type Edit = (op: OutlineOp) => void

interface SceneProps {
  scene: OutlineSceneView
  index: number
  count: number
  act: OutlineActView
  acts: OutlineActView[]
  locations: OutlineLocationView[]
  edit: Edit
}

function SceneCard({ scene, index, count, act, acts, locations, edit }: SceneProps) {
  const patch = (fields: Extract<OutlineOp, { op: 'updateScene' }>['patch']): void => {
    edit({ op: 'updateScene', sceneId: scene.id, patch: fields })
  }
  return (
    <li
      data-testid="scene-card"
      className="space-y-2 rounded-md border border-border bg-surface p-3"
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <CommitText
            label={t('outline.sceneName')}
            testId="scene-title"
            value={scene.title}
            maxLength={200}
            onCommit={(title) => {
              patch({ title })
            }}
          />
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('outline.moveEarlier')}
          data-testid="scene-move-up"
          disabled={index === 0}
          onClick={() => {
            edit({ op: 'moveScene', sceneId: scene.id, direction: 'up' })
          }}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('outline.moveLater')}
          data-testid="scene-move-down"
          disabled={index === count - 1}
          onClick={() => {
            edit({ op: 'moveScene', sceneId: scene.id, direction: 'down' })
          }}
        >
          <ArrowDown className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('outline.deleteThisScene')}
          data-testid="scene-delete"
          onClick={() => {
            edit({ op: 'deleteScene', sceneId: scene.id })
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <CommitText
        label={t('outline.whatHappensInThisScene')}
        testId="scene-summary"
        value={scene.summary}
        rows={2}
        onCommit={(summary) => {
          patch({ summary })
        }}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-sm font-medium">
          {t('outline.location')}
          <select
            data-testid="scene-location"
            className={SELECT_CLASS}
            value={scene.locationId ?? ''}
            onChange={(event) => {
              patch({ locationId: event.target.value === '' ? null : event.target.value })
            }}
          >
            <option value="">{t('outline.notSet')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <CommitText
          label={t('outline.timeForExampleLateAt')}
          testId="scene-time"
          value={scene.timeOfDay ?? ''}
          maxLength={100}
          onCommit={(timeOfDay) => {
            patch({ timeOfDay: timeOfDay.trim() === '' ? null : timeOfDay })
          }}
        />
        <CommitText
          label={t('outline.moodForExampleTense')}
          testId="scene-mood"
          value={scene.mood ?? ''}
          maxLength={100}
          onCommit={(mood) => {
            patch({ mood: mood.trim() === '' ? null : mood })
          }}
        />
      </div>
      {acts.length > 1 ? (
        <label className="block text-sm font-medium">
          {t('outline.belongsToAct')}
          <select
            data-testid="scene-act"
            className={SELECT_CLASS}
            value={act.id}
            onChange={(event) => {
              patch({ actId: event.target.value })
            }}
          >
            {acts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </li>
  )
}

interface ActProps {
  act: OutlineActView
  index: number
  acts: OutlineActView[]
  locations: OutlineLocationView[]
  edit: Edit
}

function ActCard({ act, index, acts, locations, edit }: ActProps) {
  const [confirming, setConfirming] = useState(false)
  useEscape(confirming, () => {
    setConfirming(false)
  })
  return (
    <section
      aria-label={t('outline.act', { title: act.title })}
      data-testid="act-card"
      className="space-y-3 rounded-lg border border-border bg-surface-raised shadow-card p-4"
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <CommitText
            label={t('outline.act2', { value: String(index + 1) })}
            testId="act-title"
            value={act.title}
            maxLength={200}
            onCommit={(title) => {
              edit({ op: 'updateAct', actId: act.id, patch: { title } })
            }}
          />
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('outline.moveTheWholeActEarlier')}
          data-testid="act-move-up"
          disabled={index === 0}
          onClick={() => {
            edit({ op: 'moveAct', actId: act.id, direction: 'up' })
          }}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('outline.moveTheWholeActLater')}
          data-testid="act-move-down"
          disabled={index === acts.length - 1}
          onClick={() => {
            edit({ op: 'moveAct', actId: act.id, direction: 'down' })
          }}
        >
          <ArrowDown className="size-4" />
        </Button>
      </div>
      <CommitText
        label={t('outline.whatThisActIsAbout')}
        testId="act-summary"
        value={act.summary}
        rows={2}
        onCommit={(summary) => {
          edit({ op: 'updateAct', actId: act.id, patch: { summary } })
        }}
      />

      <ul className="space-y-2" aria-label={t('outline.scenes')}>
        {act.scenes.map((scene, i) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            index={i}
            count={act.scenes.length}
            act={act}
            acts={acts}
            locations={locations}
            edit={edit}
          />
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          data-testid="act-add-scene"
          onClick={() => {
            edit({ op: 'addScene', actId: act.id })
          }}
        >
          <Plus className="size-4" />
          {t('outline.addAScene')}
        </Button>
        <div className="flex-1" />
        {confirming ? (
          <>
            <span className="text-sm">
              {t('outline.deleteThisActAndIts', { length: act.scenes.length })}
            </span>
            <Button
              size="sm"
              data-testid="act-delete-confirm"
              onClick={() => {
                edit({ op: 'deleteAct', actId: act.id })
              }}
            >
              {t('outline.delete')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirming(false)
              }}
            >
              {t('outline.keep')}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            data-testid="act-delete"
            onClick={() => {
              setConfirming(true)
            }}
          >
            <Trash2 className="size-4" />
            {t('outline.deleteThisAct')}
          </Button>
        )}
      </div>
    </section>
  )
}

function Locations({ locations, edit }: { locations: OutlineLocationView[]; edit: Edit }) {
  return (
    <section
      aria-label={t('outline.location')}
      data-testid="locations"
      className="space-y-3 rounded-lg border border-border bg-surface-raised shadow-card p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('outline.location')}</h2>
        <Button
          size="sm"
          data-testid="location-add"
          onClick={() => {
            edit({ op: 'addLocation' })
          }}
        >
          <Plus className="size-4" />
          {t('outline.addALocation')}
        </Button>
      </div>
      {locations.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('outline.noLocationsYetOnceYou')}</p>
      ) : null}
      <ul className="space-y-2">
        {locations.map((l) => (
          <li
            key={l.id}
            data-testid="location-card"
            className="flex items-end gap-2 rounded-md border border-border bg-surface p-3"
          >
            <div className="w-48 shrink-0">
              <CommitText
                label={t('outline.name')}
                testId="location-name"
                value={l.name}
                maxLength={100}
                onCommit={(name) => {
                  if (name.trim() !== '') {
                    edit({ op: 'updateLocation', locationId: l.id, patch: { name } })
                  }
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <CommitText
                label={t('outline.whatItLooksLike')}
                testId="location-description"
                value={l.description}
                onCommit={(description) => {
                  edit({ op: 'updateLocation', locationId: l.id, patch: { description } })
                }}
              />
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('outline.deleteLocation', { name: l.name })}
              data-testid="location-delete"
              onClick={() => {
                edit({ op: 'deleteLocation', locationId: l.id })
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface SplitProps {
  onSplit: (result: OutlineSplitResult) => void
}

/** 貼上故事或劇本，讓 AI 拆成「幕 → 場」，順便抽出角色（草稿）與地點。 */
function SplitBox({ onSplit }: SplitProps) {
  const [text, setText] = useState('')
  const [check, setCheck] = useState<OutlineSplitCheck>()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const latest = useRef(0)
  useEscape(confirming, () => {
    setConfirming(false)
  })

  // 文字改了就重新估價（連續打字時只採用最後一次的答案）
  useEffect(() => {
    const ticket = ++latest.current
    const timer = setTimeout(() => {
      call('outline.splitCheck', { text })
        .then((next) => {
          if (ticket === latest.current) setCheck(next)
        })
        .catch(() => undefined)
    }, 250)
    return () => {
      clearTimeout(timer)
    }
  }, [text])

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setConfirming(false)
    try {
      onSplit(await call('outline.split', { text }))
      setText('')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  // 按下去的當下再問一次：剛拆完或剛改過大綱時，畫面上的估價可能還是舊的
  const start = async (): Promise<void> => {
    setError(undefined)
    try {
      const fresh = await call('outline.splitCheck', { text })
      setCheck(fresh)
      if (!fresh.ok) return
      if (fresh.replacesExisting) setConfirming(true)
      else await run()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const empty = text.trim() === ''
  const cost = check
    ? check.ok
      ? check.demoMode
        ? t('outline.demoModeNothingIsCharged')
        : check.modelName
          ? t('outline.aboutUs', {
              value: check.estimatedUsd.toFixed(2),
              modelName: check.modelName,
            })
          : t('outline.aboutUs2', { value: check.estimatedUsd.toFixed(2) })
      : (check.issue ?? t('outline.canTSplitIntoScenes'))
    : ''

  return (
    <section
      aria-label={t('outline.letAiSplitIt')}
      className="space-y-2 rounded-lg border border-border bg-surface-raised shadow-card p-4"
    >
      <h2 className="text-base font-semibold">{t('outline.letAiSplitItInto')}</h2>
      <p className="text-sm text-fg-muted">{t('outline.pasteAStoryOutlineOr')}</p>
      <textarea
        data-testid="outline-split-text"
        aria-label={t('outline.textToSplitIntoScenes')}
        rows={5}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
        }}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="outline-split-confirm">
          <span className="text-sm">{t('outline.theCurrentActsAndScenes')}</span>
          <Button
            size="sm"
            variant="primary"
            data-testid="outline-split-confirm-yes"
            onClick={() => void run()}
          >
            {t('outline.replaceAndSplitAgain')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirming(false)
            }}
          >
            {t('outline.keepThem')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            data-testid="outline-split"
            disabled={busy || empty || check?.ok === false}
            onClick={() => void start()}
          >
            {busy ? t('outline.aiIsWorking') : t('outline.splitIntoScenes')}
          </Button>
          <span className="text-sm text-fg-muted" data-testid="outline-split-cost">
            {empty ? '' : cost}
          </span>
        </div>
      )}
    </section>
  )
}

/** 大綱頁：貼上故事讓 AI 拆，或自己一幕一幕、一場一場寫。 */
const OUTLINE_EVENTS = ['outline.changed'] as const

export function OutlinePage() {
  const [outline, setOutline] = useState<OutlineView>()
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<OutlineSplitResult>()
  // 復原／重做之後、或別的地方（畫布、分鏡表）改了大綱，重新載入
  const version = useDataVersion(OUTLINE_EVENTS)

  useEffect(() => {
    let alive = true
    call('outline.get', {})
      .then((next) => {
        if (alive) setOutline(next)
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e))
      })
    return () => {
      alive = false
    }
  }, [version])

  const edit = useCallback<Edit>((op) => {
    setError(undefined)
    call('outline.edit', op)
      .then(setOutline)
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }, [])

  const acts = outline?.acts ?? []
  const locations = outline?.locations ?? []

  return (
    <Page
      title={t('outline.outline')}
      hint={t('outline.aStoryIsSplitInto')}
      actions={<UndoRedoButtons />}
      testId="outline-page"
    >
      <div className="max-w-4xl space-y-4">
        <SplitBox
          onSplit={(next) => {
            setOutline(next.outline)
            setResult(next)
          }}
        />

        {result ? (
          <p
            className="rounded-md border border-border bg-surface-raised p-3 text-sm"
            data-testid="outline-split-result"
            role="status"
          >
            {[
              t('outline.doneSplitting'),
              ...(result.newCharacters.length > 0
                ? [
                    t('outline.addedCharactersDraftsCheckThem', {
                      value: result.newCharacters.join(t('list.comma')),
                    }),
                  ]
                : []),
              ...(result.newLocations.length > 0
                ? [
                    t('outline.addedLocations', {
                      value: result.newLocations.join(t('list.comma')),
                    }),
                  ]
                : []),
            ].join(t('list.sentence'))}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {outline === undefined && error === undefined ? (
          <SkeletonCards testId="outline-loading" />
        ) : null}

        {outline && acts.length === 0 ? (
          <p className="text-sm text-fg-muted" data-testid="outline-empty">
            {t('outline.noOutlineYetPasteA')}
          </p>
        ) : null}

        <div className="space-y-4">
          {acts.map((act, i) => (
            <ActCard
              key={act.id}
              act={act}
              index={i}
              acts={acts}
              locations={locations}
              edit={edit}
            />
          ))}
        </div>

        <div>
          <Button
            data-testid="act-add"
            onClick={() => {
              edit({ op: 'addAct' })
            }}
          >
            <Plus className="size-4" />
            {t('outline.addAnAct')}
          </Button>
        </div>

        <Locations locations={locations} edit={edit} />
      </div>
    </Page>
  )
}
