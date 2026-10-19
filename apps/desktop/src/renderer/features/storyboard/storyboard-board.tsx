import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { OutlineView, ShotEdit, ShotView } from '@svs/schema'
import { GripVertical } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { assetUrl } from '../../lib/asset'
import { CardFooter } from '../shots/card-footer'
import { cardUsage } from '../shots/card-usage'
import { SelectCell, TextCell } from './cells'
import { ANGLE_LABELS, SIZE_LABELS, STATUS_LABELS } from './labels'

export interface StoryboardBoardProps {
  shots: ShotView[]
  outline: OutlineView
  /** 跟分鏡表共用的勾選狀態：在哪個檢視勾選，換過去還是勾著。 */
  selected: Record<string, boolean>
  onSelect: (next: Record<string, boolean>) => void
  onEdit: (shotId: string, edit: ShotEdit) => void
  onReorder: (orderedIds: string[]) => void
}

/** 縮圖用目前採用的首幀圖；還沒採用任何一張就用最新的。 */
export function thumbnailHash(shot: ShotView): string | undefined {
  return (shot.firstFrames.find((take) => take.adopted) ?? shot.firstFrames.at(-1))?.assetHash
}

function statusText(shot: ShotView): string {
  if (shot.activity) return STATUS_LABELS.generating
  if (shot.error) return STATUS_LABELS.failed
  return STATUS_LABELS[shot.status]
}

/** 多行的描述框：離開才存，Esc 放棄這次的修改（外面的值變了就重新開始）。 */
function DescriptionBox({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  return <DescriptionInner key={value} value={value} onCommit={onCommit} />
}

function DescriptionInner({
  value,
  onCommit,
}: {
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const sent = useRef(value)
  const commit = (): void => {
    // 描述不能是空的，空白就當作沒改
    if (draft.trim() === '' || draft === value || draft === sent.current) return
    sent.current = draft
    onCommit(draft)
  }
  return (
    <textarea
      data-testid="board-description"
      aria-label="畫面描述"
      rows={3}
      value={draft}
      onChange={(event) => {
        sent.current = value
        setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setDraft(value)
      }}
      className="w-full resize-none rounded border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-accent focus:bg-surface focus:outline-none"
    />
  )
}

interface CardProps {
  shot: ShotView
  sceneLabel: string | undefined
  checked: boolean
  onCheck: (checked: boolean) => void
  onEdit: (edit: ShotEdit) => void
}

const SIZE_OPTIONS = Object.entries(SIZE_LABELS).map(([value, label]) => ({ value, label }))
const ANGLE_OPTIONS = Object.entries(ANGLE_LABELS).map(([value, label]) => ({ value, label }))

function SortableCard({ shot, sceneLabel, checked, onCheck, onEdit }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: shot.id,
  })
  const hash = thumbnailHash(shot)
  const usage = cardUsage(shot)
  return (
    <li
      ref={setNodeRef}
      data-testid="board-card"
      data-shot-id={shot.id}
      data-number={shot.number}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`overflow-hidden rounded-lg border bg-surface-raised ${
        isDragging ? 'relative z-10 border-accent' : 'border-border'
      }`}
    >
      <div className="flex aspect-video items-center justify-center bg-surface-overlay">
        {hash ? (
          <img
            src={assetUrl(hash)}
            alt={`第 ${String(shot.number)} 鏡的畫面`}
            className="size-full object-cover"
          />
        ) : (
          <span className="text-xs text-fg-muted">還沒有畫面</span>
        )}
      </div>
      <div className="space-y-1 p-2">
        <div className="flex items-center gap-1 text-sm">
          <button
            type="button"
            data-testid="board-handle"
            aria-label={`拖拉調整第 ${String(shot.number)} 鏡的順序`}
            className="cursor-grab touch-none rounded p-1 text-fg-muted hover:bg-surface-overlay"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <input
            type="checkbox"
            data-testid="board-select"
            aria-label={`選取第 ${String(shot.number)} 鏡`}
            checked={checked}
            onChange={(event) => {
              onCheck(event.target.checked)
            }}
          />
          <span className="font-medium">第 {shot.number} 鏡</span>
          <span
            className={`ml-auto text-xs ${shot.error ? 'text-danger' : 'text-fg-muted'}`}
            data-testid="board-status"
            title={shot.error}
          >
            {statusText(shot)}
          </span>
        </div>
        {sceneLabel ? (
          <p className="truncate px-2 text-xs text-fg-muted" data-testid="board-scene">
            {sceneLabel}
          </p>
        ) : null}
        <DescriptionBox
          value={shot.description}
          onCommit={(value) => {
            onEdit({ description: value })
          }}
        />
        <div className="grid grid-cols-3 gap-1">
          <SelectCell
            column="board-size"
            label="景別"
            value={shot.size}
            options={SIZE_OPTIONS}
            onCommit={(value) => {
              onEdit({ size: value as ShotView['size'] })
            }}
          />
          <SelectCell
            column="board-angle"
            label="角度"
            value={shot.angle}
            options={ANGLE_OPTIONS}
            onCommit={(value) => {
              onEdit({ angle: value as ShotView['angle'] })
            }}
          />
          <TextCell
            column="board-duration"
            label="秒數"
            type="number"
            min={1}
            max={15}
            value={String(shot.durationSec)}
            onCommit={(value) => {
              const seconds = Number(value)
              if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 15) {
                onEdit({ durationSec: seconds })
              }
            }}
          />
        </div>
      </div>
      {usage ? (
        <CardFooter
          shotId={shot.id}
          number={shot.number}
          usage={usage}
          busy={shot.activity !== undefined}
        />
      ) : null}
    </li>
  )
}

/** 故事板：鏡頭排成一張張卡片（縮圖＋描述），跟分鏡表是同一份資料，改哪邊另一邊都會跟著變。 */
export function StoryboardBoard({
  shots,
  outline,
  selected,
  onSelect,
  onEdit,
  onReorder,
}: StoryboardBoardProps) {
  const sceneLabels = useMemo(
    () =>
      new Map(
        outline.acts.flatMap((act) =>
          act.scenes.map((scene) => [scene.id, `${act.title}／${scene.title}`] as const),
        ),
      ),
    [outline],
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = shots.map((s) => s.id)
  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ol
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-label="鏡頭卡片"
          data-testid="storyboard-board"
        >
          {shots.map((shot) => (
            <SortableCard
              key={shot.id}
              shot={shot}
              sceneLabel={shot.sceneId ? sceneLabels.get(shot.sceneId) : undefined}
              checked={selected[shot.id] === true}
              onCheck={(checked) => {
                onSelect({ ...selected, [shot.id]: checked })
              }}
              onEdit={(edit) => {
                onEdit(shot.id, edit)
              }}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}
