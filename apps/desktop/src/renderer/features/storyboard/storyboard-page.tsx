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

const EMPTY_OUTLINE: OutlineView = { acts: [], locations: [] }

interface SplitProps {
  outline: OutlineView
  onError: (message: string | undefined) => void
}

/** 選一個場，讓 AI 依劇情拆成鏡頭（這個場原本的鏡頭會被換掉）。 */
function SplitScene({ outline, onError }: SplitProps) {
  const scenes = outline.acts.flatMap((act) =>
    act.scenes.map((scene) => ({ id: scene.id, label: `${act.title}／${scene.title}` })),
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
        想讓 AI 幫你把場分成幾個畫面，請先到「大綱」建立場。
      </p>
    )
  }

  const cost = check
    ? check.ok
      ? check.demoMode
        ? '示範模式，不會花錢'
        : `預估約 US$${check.estimatedUsd.toFixed(2)}${check.modelName ? `（${check.modelName}）` : ''}`
      : (check.issue ?? '現在不能讓 AI 分畫面。')
    : ''
  const warn =
    check && check.existingShots > 0
      ? `這個場目前有 ${String(check.existingShots)} 個鏡頭` +
        (check.generatedShots > 0 ? `，其中 ${String(check.generatedShots)} 個已經生成過` : '') +
        '，拆完會整批換掉。要繼續嗎？'
      : ''

  return (
    <div className="space-y-2" data-testid="storyboard-split">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium" htmlFor="storyboard-scene">
          讓 AI 幫我分成幾個畫面：
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
            {busy ? 'AI 整理中…' : '請 AI 拆這個場'}
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
            換掉並重新拆
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirming(false)
            }}
          >
            不換
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
    setNotice(`已開始生成 ${String(result.started)} 個鏡頭。`)
    const [first] = result.failed
    if (first) {
      setError(
        `有 ${String(result.failed.length)} 個鏡頭沒辦法開始（例如第 ${String(first.number)} 鏡）：${first.error}`,
      )
    }
  }

  return (
    <Page
      title="分鏡表"
      hint="每一列是一個鏡頭。欄位點一下就能改，按 Enter 跳到下一列；左邊的把手可以拖拉換順序。想看畫面可以切到「故事板」，兩邊是同一份資料。"
      actions={<UndoRedoButtons />}
      width="full"
      testId="storyboard-page"
    >
      <div className="space-y-4">
        <SplitScene outline={outline} onError={setError} />

        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="storyboard-add" onClick={add}>
            <Plus className="size-4" />
            新增鏡頭
          </Button>
          {confirmingDelete ? (
            <>
              <span className="text-sm">
                確定刪除選取的 {picked.length} 個鏡頭（連同生成過的版本）？
              </span>
              <Button size="sm" data-testid="storyboard-delete-confirm" onClick={remove}>
                確定刪除
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirmingDelete(false)
                }}
              >
                不刪
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
                生成選取的鏡頭{picked.length > 0 ? `（${String(picked.length)}）` : ''}
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
                刪除選取
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

        <div className="flex gap-1" role="group" aria-label="檢視方式">
          {(
            [
              ['table', '表格', Table2],
              ['board', '故事板', LayoutGrid],
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
            還沒有鏡頭。按「新增鏡頭」，或到「大綱」建立場後讓 AI 幫你拆。
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
