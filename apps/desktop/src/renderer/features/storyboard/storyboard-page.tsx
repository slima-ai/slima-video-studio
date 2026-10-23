import type { OutlineView, ShotBatchResult, ShotEdit, StoryboardSplitCheck } from '@svs/schema'
import type { RowSelectionState } from '@tanstack/react-table'
import { LayoutGrid, Plus, Sparkles, Table2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button'
import { UndoRedoButtons } from '../../components/undo-redo-buttons'
import { useDataVersion } from '../../lib/data-version'
import { call, errorText } from '../../lib/svs'
import { useEscape } from '../../lib/use-escape'
import { useShots } from '../shots/use-shots'
import { BatchConfirm } from './batch-confirm'
import { StoryboardBoard } from './storyboard-board'
import { StoryboardTable } from './storyboard-table'
import { Page, SELECT_CLASS } from '../../components/page'
import { t } from '@svs/schema'

const EMPTY_OUTLINE: OutlineView = { acts: [], locations: [] }

interface SplitProps {
  outline: OutlineView
  onError: (message: string | undefined) => void
}

/** 選一個場，讓 AI 依劇情拆成鏡頭（這個場原本的鏡頭會被換掉）。 */
function SplitScene({ outline, onError }: SplitProps) {
  const scenes = outline.acts.flatMap((act) =>
    act.scenes.map((scene) => ({
      id: scene.id,
      label: t('storyboard.actScene', { act: act.title, scene: scene.title }),
    })),
  )
  const [sceneId, setSceneId] = useState('')
  const [check, setCheck] = useState<StoryboardSplitCheck>()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const latest = useRef(0)
  useEscape(confirming, () => {
    setConfirming(false)
  })
  const chosen = scenes.some((s) => s.id === sceneId) ? sceneId : (scenes[0]?.id ?? '')

  useEffect(() => {
    if (chosen === '') return
    const ticket = ++latest.current
    call('storyboard.splitCheck', { sceneId: chosen })
      .then((next) => {
        if (ticket === latest.current) setCheck(next)
      })
      .catch(() => undefined)
  }, [chosen])

  const run = async (): Promise<void> => {
    setBusy(true)
    setConfirming(false)
    onError(undefined)
    try {
      await call('storyboard.splitScene', { sceneId: chosen })
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
      call('storyboard.splitCheck', { sceneId: chosen })
        .then(setCheck)
        .catch(() => undefined)
    }
  }

  // 按下去的當下再問一次：剛拆完或剛改過鏡頭時，畫面上的數字可能是舊的
  const start = async (): Promise<void> => {
    onError(undefined)
    try {
      const fresh = await call('storyboard.splitCheck', { sceneId: chosen })
      setCheck(fresh)
      if (!fresh.ok) return
      if (fresh.existingShots > 0) setConfirming(true)
      else await run()
    } catch (e) {
      onError(errorText(e))
    }
  }

  if (scenes.length === 0) {
    return (
      <p className="text-sm text-fg-muted" data-testid="storyboard-no-scenes">
        {t('storyboard.toHaveAiSplitA')}
      </p>
    )
  }

  const cost = check
    ? check.ok
      ? check.demoMode
        ? t('storyboard.demoModeNothingIsCharged')
        : check.modelName
          ? t('storyboard.aboutUs2', {
              value: check.estimatedUsd.toFixed(2),
              modelName: check.modelName,
            })
          : t('storyboard.aboutUs', { value: check.estimatedUsd.toFixed(2) })
      : (check.issue ?? t('storyboard.aiCanTSplitInto'))
    : ''
  const warn =
    check && check.existingShots > 0
      ? check.generatedShots > 0
        ? t('storyboard.thisSceneHasShotsOf', {
            value: String(check.existingShots),
            value2: String(check.generatedShots),
          })
        : t('storyboard.thisSceneHasShotsSplitting', { value: String(check.existingShots) })
      : ''

  return (
    <div className="space-y-2" data-testid="storyboard-split">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium" htmlFor="storyboard-scene">
          {t('storyboard.letAiSplitItInto')}
        </label>
        <select
          id="storyboard-scene"
          data-testid="storyboard-scene"
          value={chosen}
          onChange={(event) => {
            setSceneId(event.target.value)
            setConfirming(false)
          }}
          className={SELECT_CLASS}
        >
          {scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {confirming ? null : (
          <Button
            data-testid="storyboard-split-run"
            disabled={busy || check?.ok === false}
            onClick={() => void start()}
          >
            <Sparkles className="size-4" />
            {busy ? t('storyboard.aiIsWorking') : t('storyboard.splitThisScene')}
          </Button>
        )}
        <span className="text-sm text-fg-muted" data-testid="storyboard-split-cost">
          {cost}
        </span>
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="storyboard-split-confirm">
          <span className="text-sm">{warn}</span>
          <Button
            size="sm"
            variant="primary"
            data-testid="storyboard-split-confirm-yes"
            onClick={() => void run()}
          >
            {t('storyboard.replaceAndSplitAgain')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirming(false)
            }}
          >
            {t('storyboard.keepThem')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** 分鏡表：所有鏡頭一列一列排開，直接改欄位、拖拉排序、多選後送去生成。 */
const OUTLINE_EVENTS = ['outline.changed'] as const

export function StoryboardPage() {
  const { shots } = useShots()
  const [outline, setOutline] = useState<OutlineView>(EMPTY_OUTLINE)
  const [selected, setSelected] = useState<RowSelectionState>({})
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingGenerate, setConfirmingGenerate] = useState(false)
  // 表格與故事板看的是同一份鏡頭，勾選也共用，所以切換檢視不會丟掉任何東西
  const [view, setView] = useState<'table' | 'board'>('table')
  // 復原／重做之後、或別的地方改了大綱（場的清單），重新讀
  const version = useDataVersion(OUTLINE_EVENTS)
  useEscape(confirmingDelete, () => {
    setConfirmingDelete(false)
  })
  useEscape(confirmingGenerate, () => {
    setConfirmingGenerate(false)
  })

  useEffect(() => {
    let alive = true
    call('outline.get', {})
      .then((next) => {
        if (alive) setOutline(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [version])

  // 鏡頭被刪掉、換掉之後，不存在的列不再算選取
  const picked = shots.filter((s) => selected[s.id]).map((s) => s.id)

  const edit = useCallback((shotId: string, patch: ShotEdit): void => {
    setError(undefined)
    call('shots.update', { shotId, patch }).catch((e: unknown) => {
      setError(errorText(e))
    })
  }, [])

  const reorder = useCallback((orderedIds: string[]): void => {
    setError(undefined)
    call('shots.reorder', { orderedIds }).catch((e: unknown) => {
      setError(errorText(e))
    })
  }, [])

  const add = (): void => {
    setError(undefined)
    const last = shots.at(-1)
    call('shots.create', {
      ...(last?.sceneId ? { sceneId: last.sceneId } : {}),
      ...(last ? { afterShotId: last.id } : {}),
    }).catch((e: unknown) => {
      setError(errorText(e))
    })
  }

  const remove = (): void => {
    setConfirmingDelete(false)
    setError(undefined)
    call('shots.delete', { shotIds: picked })
      .then(() => {
        setSelected({})
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }

  const generated = (result: ShotBatchResult): void => {
    setConfirmingGenerate(false)
    setNotice(t('storyboard.startedGeneratingShots', { value: String(result.started) }))
    const [first] = result.failed
    if (first) {
      setError(
        t('storyboard.shotsCouldnTStartFor', {
          value: String(result.failed.length),
          value2: String(first.number),
          error: first.error,
        }),
      )
    }
  }

  return (
    <Page
      title={t('storyboard.storyboard')}
      hint={t('storyboard.eachRowIsOneShot')}
      actions={<UndoRedoButtons />}
      width="full"
      testId="storyboard-page"
    >
      <div className="space-y-4">
        <SplitScene outline={outline} onError={setError} />

        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="storyboard-add" onClick={add}>
            <Plus className="size-4" />
            {t('storyboard.addAShot')}
          </Button>
          {confirmingDelete ? (
            <>
              <span className="text-sm">
                {t('storyboard.deleteTheSelectedShotsIncluding', { length: picked.length })}
              </span>
              <Button size="sm" data-testid="storyboard-delete-confirm" onClick={remove}>
                {t('storyboard.delete')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirmingDelete(false)
                }}
              >
                {t('storyboard.keep')}
              </Button>
            </>
          ) : confirmingGenerate ? (
            <BatchConfirm
              shotIds={picked}
              onCancel={() => {
                setConfirmingGenerate(false)
              }}
              onStarted={generated}
              onError={setError}
            />
          ) : (
            <>
              <Button
                data-testid="storyboard-generate"
                variant="primary"
                disabled={picked.length === 0}
                onClick={() => {
                  setError(undefined)
                  setNotice(undefined)
                  setConfirmingGenerate(true)
                }}
              >
                {picked.length > 0
                  ? t('storyboard.generateSelectedShots', { value: String(picked.length) })
                  : t('storyboard.generateSelectedShots2')}
              </Button>
              <Button
                data-testid="storyboard-delete"
                variant="ghost"
                disabled={picked.length === 0}
                onClick={() => {
                  setConfirmingDelete(true)
                }}
              >
                <Trash2 className="size-4" />
                {t('storyboard.deleteSelected')}
              </Button>
            </>
          )}
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-fg-muted" data-testid="storyboard-notice">
            {notice}
          </p>
        ) : null}

        <div className="flex gap-1" role="group" aria-label={t('storyboard.view')}>
          {(
            [
              ['table', t('storyboard.table'), Table2],
              ['board', t('storyboard.board'), LayoutGrid],
            ] as const
          ).map(([id, label, Icon]) => (
            <Button
              key={id}
              size="sm"
              variant={view === id ? 'primary' : 'ghost'}
              aria-pressed={view === id}
              data-testid={`storyboard-view-${id}`}
              onClick={() => {
                setView(id)
              }}
            >
              <Icon className="size-4" />
              {label}
            </Button>
          ))}
        </div>

        {shots.length === 0 ? (
          <p className="text-sm text-fg-muted" data-testid="storyboard-empty">
            {t('storyboard.noShotsYetPressAdd')}
          </p>
        ) : view === 'board' ? (
          <StoryboardBoard
            shots={shots}
            outline={outline}
            selected={selected}
            onSelect={setSelected}
            onEdit={edit}
            onReorder={reorder}
          />
        ) : (
          <StoryboardTable
            shots={shots}
            outline={outline}
            selected={selected}
            onSelect={setSelected}
            onEdit={edit}
            onReorder={reorder}
          />
        )}
      </div>
    </Page>
  )
}
