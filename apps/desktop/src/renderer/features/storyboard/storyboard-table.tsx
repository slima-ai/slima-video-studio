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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from '@tanstack/react-table'
import {
  type OutlineView,
  type ShotAngle,
  type ShotEdit,
  type ShotSize,
  type ShotView,
  t,
  getLocale,
} from '@svs/schema'
import { GripVertical } from 'lucide-react'
import { createContext, useContext, useMemo, type HTMLAttributes } from 'react'

import { fmtSec1 } from '../shots/trim-math'
import { SelectCell, TextCell } from './cells'
import { STATUS_LABELS, angleOptions, cameraMoveOptions, parseNames, sizeOptions } from './labels'

const NONE = ''

/** 「成品用到」那一欄：沒有影片是「—」；沒裁是整支（0.0–5.0）；裁過是留下的那一段（0.0–3.5）。 */
export function usedInFilm(shot: ShotView): string {
  const video = shot.videos.find((v) => v.adopted)
  if (!video) return '—'
  const total = video.videoSec ?? shot.filmSeconds
  const start = video.trim?.inSec ?? 0
  const end = video.trim?.outSec ?? total
  return end === undefined ? '—' : `${fmtSec1(start)}–${fmtSec1(end)}`
}

/** 每一欄的寬度（px）：固定下來，內容太長就用省略號並在滑過時顯示全文，不會把欄位擠成一個字寬。 */
const ZH_COLUMN_WIDTHS: Record<string, number> = {
  handle: 36,
  select: 40,
  number: 64,
  scene: 220,
  description: 280,
  size: 104,
  angle: 120,
  camera: 120,
  duration: 80,
  used: 110,
  characters: 150,
  dialogue: 200,
  location: 150,
  lighting: 120,
  time: 104,
  mood: 104,
  status: 96,
}
/** 英文的景別、角度、運鏡名稱比中文長（Extreme close-up、Over the shoulder）：這幾欄寬一點；繁中維持原樣。 */
const columnWidths = (): Record<string, number> =>
  getLocale() === 'zh-TW'
    ? ZH_COLUMN_WIDTHS
    : { ...ZH_COLUMN_WIDTHS, size: 175, angle: 175, camera: 130 }
const tableWidth = (widths: Record<string, number>): number =>
  Object.values(widths).reduce((sum, w) => sum + w, 0)

interface Handle {
  attributes: HTMLAttributes<HTMLButtonElement>
  listeners: HTMLAttributes<HTMLButtonElement> | undefined
}
const HandleContext = createContext<Handle | undefined>(undefined)

function DragHandle({ shot }: { shot: ShotView }) {
  const handle = useContext(HandleContext)
  return (
    <button
      type="button"
      data-testid="row-handle"
      aria-label={t('storyboard.dragToReorderShot', { value: String(shot.number) })}
      className="cursor-grab touch-none rounded p-1 text-fg-muted hover:bg-surface-overlay"
      {...handle?.attributes}
      {...handle?.listeners}
    >
      <GripVertical className="size-4" />
    </button>
  )
}

export interface StoryboardTableProps {
  shots: ShotView[]
  outline: OutlineView
  selected: RowSelectionState
  onSelect: (next: RowSelectionState) => void
  onEdit: (shotId: string, edit: ShotEdit) => void
  onReorder: (orderedIds: string[]) => void
}

function statusText(shot: ShotView): string {
  if (shot.activity) return t(STATUS_LABELS.generating)
  if (shot.error) return t(STATUS_LABELS.failed)
  return t(STATUS_LABELS[shot.status])
}

function SortableRow({ shot, children }: { shot: ShotView; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: shot.id,
  })
  return (
    <HandleContext.Provider value={{ attributes, listeners }}>
      <tr
        ref={setNodeRef}
        data-testid="shot-row"
        data-shot-id={shot.id}
        data-number={shot.number}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={`border-b border-border align-top ${isDragging ? 'relative z-10 bg-surface-overlay' : ''}`}
      >
        {children}
      </tr>
    </HandleContext.Provider>
  )
}

/** 分鏡表：每個鏡頭一列，欄位都能直接改；拖拉（或用鍵盤）調整順序。 */
export function StoryboardTable({
  shots,
  outline,
  selected,
  onSelect,
  onEdit,
  onReorder,
}: StoryboardTableProps) {
  const sceneOptions = useMemo(
    () => [
      { value: NONE, label: t('storyboard.notInAnyScene') },
      ...outline.acts.flatMap((act) =>
        act.scenes.map((scene) => ({
          value: scene.id,
          label: t('storyboard.actScene', { act: act.title, scene: scene.title }),
        })),
      ),
    ],
    [outline],
  )
  const locationOptions = useMemo(
    () => [
      { value: NONE, label: t('storyboard.notSet') },
      ...outline.locations.map((l) => ({ value: l.id, label: l.name })),
    ],
    [outline],
  )
  const sizeChoices = useMemo(() => sizeOptions(), [])
  const angleChoices = useMemo(() => angleOptions(), [])
  const cameraOptions = useMemo(
    () => [
      { value: NONE, label: t('storyboard.fixed') },
      ...cameraMoveOptions().map(({ value, label }) => ({ value, label })),
    ],
    [],
  )

  const columns = useMemo<ColumnDef<ShotView>[]>(
    () => [
      {
        id: 'handle',
        header: '',
        cell: ({ row }) => <DragHandle shot={row.original} />,
      },
      {
        id: 'select',
        header: () => <span className="sr-only">{t('storyboard.select')}</span>,
        cell: ({ row }) => (
          <input
            type="checkbox"
            data-testid="row-select"
            aria-label={t('storyboard.selectShot', { value: String(row.original.number) })}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      },
      {
        id: 'number',
        header: t('storyboard.no'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap px-2 text-sm">{row.original.number}</span>
        ),
      },
      {
        id: 'scene',
        header: t('storyboard.scene'),
        cell: ({ row }) => (
          <SelectCell
            column="scene"
            label={t('storyboard.belongsToScene')}
            value={row.original.sceneId ?? NONE}
            options={sceneOptions}
            onCommit={(value) => {
              onEdit(row.original.id, { sceneId: value === NONE ? null : value })
            }}
          />
        ),
      },
      {
        id: 'description',
        header: t('storyboard.pictureDescription'),
        cell: ({ row }) => (
          <TextCell
            column="description"
            label={t('storyboard.pictureDescription')}
            value={row.original.description}
            onCommit={(value) => {
              if (value.trim() !== '') onEdit(row.original.id, { description: value })
            }}
          />
        ),
      },
      {
        id: 'size',
        header: t('storyboard.shotSize'),
        cell: ({ row }) => (
          <SelectCell
            column="size"
            label={t('storyboard.shotSize')}
            value={row.original.size}
            options={sizeChoices}
            onCommit={(value) => {
              onEdit(row.original.id, { size: value as ShotSize })
            }}
          />
        ),
      },
      {
        id: 'angle',
        header: t('storyboard.angle'),
        cell: ({ row }) => (
          <SelectCell
            column="angle"
            label={t('storyboard.cameraAngle')}
            value={row.original.angle}
            options={angleChoices}
            onCommit={(value) => {
              onEdit(row.original.id, { angle: value as ShotAngle })
            }}
          />
        ),
      },
      {
        id: 'camera',
        header: t('storyboard.cameraMove'),
        cell: ({ row }) => (
          <SelectCell
            column="camera"
            label={t('storyboard.cameraMove')}
            value={row.original.cameraMove ?? NONE}
            options={cameraOptions}
            onCommit={(value) => {
              onEdit(row.original.id, { cameraMove: value === NONE ? null : value })
            }}
          />
        ),
      },
      {
        id: 'duration',
        header: t('storyboard.seconds'),
        cell: ({ row }) => (
          <TextCell
            column="duration"
            label={t('storyboard.seconds')}
            type="number"
            min={1}
            max={15}
            value={String(row.original.durationSec)}
            onCommit={(value) => {
              const seconds = Number(value)
              if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 15) {
                onEdit(row.original.id, { durationSec: seconds })
              }
            }}
          />
        ),
      },
      {
        // 唯讀：成品實際用到這支影片的哪一段（秒）。要改請打開鏡頭面板剪裁
        id: 'used',
        header: t('storyboard.usedInFilm'),
        cell: ({ row }) => {
          const text = usedInFilm(row.original)
          return (
            <span
              className="block truncate border border-transparent px-2 py-1 text-sm tabular-nums text-fg-muted"
              data-testid="shot-used"
              title={t('storyboard.usedInFilmTip')}
            >
              {text}
            </span>
          )
        },
      },
      {
        id: 'characters',
        header: t('storyboard.characters'),
        cell: ({ row }) => (
          <TextCell
            column="characters"
            label={t('storyboard.charactersInTheShotSeparate')}
            placeholder={t('storyboard.forExampleIronMina')}
            value={row.original.characters.join(t('list.comma'))}
            onCommit={(value) => {
              onEdit(row.original.id, { characters: parseNames(value) })
            }}
          />
        ),
      },
      {
        id: 'dialogue',
        header: t('storyboard.lines'),
        cell: ({ row }) => (
          <TextCell
            column="dialogue"
            label={t('storyboard.lines')}
            value={row.original.dialogue}
            onCommit={(value) => {
              onEdit(row.original.id, { dialogue: value })
            }}
          />
        ),
      },
      {
        id: 'location',
        header: t('storyboard.location'),
        cell: ({ row }) => (
          <SelectCell
            column="location"
            label={t('storyboard.location')}
            value={row.original.locationId ?? NONE}
            options={locationOptions}
            onCommit={(value) => {
              onEdit(row.original.id, { locationId: value === NONE ? null : value })
            }}
          />
        ),
      },
      {
        id: 'lighting',
        header: t('storyboard.lighting'),
        cell: ({ row }) => (
          <TextCell
            column="lighting"
            label={t('storyboard.lighting')}
            placeholder={t('storyboard.forExampleBacklit')}
            value={row.original.lighting ?? ''}
            onCommit={(value) => {
              onEdit(row.original.id, { lighting: value.trim() === '' ? null : value })
            }}
          />
        ),
      },
      {
        id: 'time',
        header: t('storyboard.timeOfDay'),
        cell: ({ row }) => (
          <TextCell
            column="time"
            label={t('storyboard.timeOfDay')}
            placeholder={t('storyboard.forExampleDusk')}
            value={row.original.timeOfDay ?? ''}
            onCommit={(value) => {
              onEdit(row.original.id, { timeOfDay: value.trim() === '' ? null : value })
            }}
          />
        ),
      },
      {
        id: 'mood',
        header: t('storyboard.mood'),
        cell: ({ row }) => (
          <TextCell
            column="mood"
            label={t('storyboard.mood')}
            value={row.original.mood ?? ''}
            onCommit={(value) => {
              onEdit(row.original.id, { mood: value.trim() === '' ? null : value })
            }}
          />
        ),
      },
      {
        id: 'status',
        header: t('storyboard.status'),
        cell: ({ row }) => (
          <span
            className={`block truncate px-2 text-sm ${row.original.error ? 'text-danger' : 'text-fg-muted'}`}
            data-testid="shot-status"
            title={row.original.error}
          >
            {statusText(row.original)}
          </span>
        ),
      },
    ],
    [sceneOptions, locationOptions, sizeChoices, angleChoices, cameraOptions, onEdit],
  )

  const widths = columnWidths()
  const table = useReactTable({
    data: shots,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (shot) => shot.id,
    state: { rowSelection: selected },
    onRowSelectionChange: (updater) => {
      onSelect(typeof updater === 'function' ? updater(selected) : updater)
    },
    enableRowSelection: true,
  })

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
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised shadow-card">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <table
          style={{ width: tableWidth(widths) }}
          className="table-fixed border-collapse text-left"
          data-testid="storyboard-table"
        >
          <thead className="border-b border-border text-xs text-fg-muted">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ width: widths[header.column.id] }}
                    className="whitespace-nowrap px-2 py-2 font-medium"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {table.getRowModel().rows.map((row) => (
                <SortableRow key={row.id} shot={row.original}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-1 py-1">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </SortableRow>
              ))}
            </SortableContext>
          </tbody>
        </table>
      </DndContext>
    </div>
  )
}
