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
  beatKindLabel,
  secLabel,
  t,
  getLocale,
  msg,
  type MessageRef,
} from '@svs/schema'
import { GripVertical } from 'lucide-react'
import { createContext, useContext, useMemo, useState, type HTMLAttributes } from 'react'

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
  start: 80,
  segment: 90,
  scene: 220,
  description: 280,
  size: 104,
  angle: 120,
  camera: 120,
  duration: 80,
  beat: 84,
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
/** 預告片專案的分鏡表預設只看這幾欄；其餘（場、景別、角度、運鏡、角色…）收進「更多欄位」。 */
const TRAILER_COLUMNS: readonly string[] = [
  'handle',
  'select',
  'number',
  'start',
  'segment',
  'beat',
  'description',
  'dialogue',
  'duration',
]

const SEGMENT_NAMES: Record<string, MessageRef> = {
  hook: msg('storyboard.segment.hook'),
  world: msg('storyboard.segment.world'),
  turn: msg('storyboard.segment.turn'),
  escalate: msg('storyboard.segment.escalate'),
  suspense: msg('storyboard.segment.suspense'),
  montage: msg('storyboard.segment.montage'),
  title: msg('storyboard.segment.title'),
}

/** 段落的顯示名；不認得的代號原樣顯示，沒有段落留空。 */
export const segmentName = (segment: string | undefined): string => {
  if (segment === undefined) return ''
  const known = SEGMENT_NAMES[segment]
  return known ? t(known) : segment
}

/** 這一格從影片的第幾秒開始（前面各格秒數的和）：「0:08.5」。 */
export function startClock(sec: number): string {
  const whole = Math.floor(sec / 60)
  return `${String(whole)}:${(sec - whole * 60).toFixed(1).padStart(4, '0')}`
}

/** 哪些欄位現在要顯示：一般專案跟以前一樣；預告片專案預設只看六欄，按「更多欄位」才全部。 */
export function visibleColumns(
  ids: readonly string[],
  options: { trailer: boolean; showMore: boolean; showBeat: boolean },
): Record<string, boolean> {
  return Object.fromEntries(
    ids.map((id) => {
      if (!options.trailer) {
        return [id, id !== 'start' && id !== 'segment' && (id !== 'beat' || options.showBeat)]
      }
      return [id, options.showMore || TRAILER_COLUMNS.includes(id)]
    }),
  )
}

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
  /** 預告片專案：預設欄位換成時間、段落、種類、畫面或字、旁白、秒數。 */
  trailer?: boolean
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
  trailer = false,
}: StoryboardTableProps) {
  const [showMore, setShowMore] = useState(false)
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

  // 每一格從第幾秒開始（依表裡的順序）
  const starts = useMemo(() => {
    let at = 0
    const result = new Map<string, number>()
    for (const shot of shots) {
      result.set(shot.id, at)
      at += shot.durationSec
    }
    return result
  }, [shots])

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
        // 唯讀：這一格從影片的第幾秒開始（預告片專案才顯示）
        id: 'start',
        header: t('storyboard.start'),
        cell: ({ row }) => (
          <span
            className="block truncate px-2 text-sm tabular-nums text-fg-muted"
            data-testid="shot-start"
          >
            {startClock(starts.get(row.original.id) ?? 0)}
          </span>
        ),
      },
      {
        // 唯讀：這一格屬於預告片的哪一段（預告片專案才顯示；沒有段落留空）
        id: 'segment',
        header: t('storyboard.segment'),
        cell: ({ row }) => (
          <span
            className="block truncate px-2 text-sm text-fg-muted"
            data-testid="shot-segment"
            data-segment={row.original.segment ?? ''}
          >
            {segmentName(row.original.segment)}
          </span>
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
        header: trailer ? t('storyboard.pictureOrText') : t('storyboard.pictureDescription'),
        cell: ({ row }) =>
          trailer && (row.original.beatKind === 'card' || row.original.beatKind === 'title') ? (
            // 字卡寫字卡上的字、片名卡寫「片名卡」（要改請打開鏡頭面板或預告片頁）；不是畫面描述
            <span
              className="block truncate border border-transparent px-2 py-1 text-sm"
              data-testid="shot-card-text"
              title={row.original.card?.text}
            >
              {row.original.beatKind === 'title'
                ? t('storyboard.titleCardRow')
                : (row.original.card?.text ?? '')}
            </span>
          ) : (
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
            value={secLabel(row.original.durationSec)}
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
        // 唯讀：這一格是會動的影片、不動的畫面還是字卡（要改請打開鏡頭面板）
        id: 'beat',
        header: t('storyboard.beatKind'),
        cell: ({ row }) => (
          <span
            className="block truncate border border-transparent px-2 py-1 text-sm text-fg-muted"
            data-testid="shot-beat-kind"
            data-beat={row.original.beatKind ?? 'video'}
            title={t('storyboard.beatKindTip')}
          >
            {beatKindLabel(row.original.beatKind ?? 'video')}
          </span>
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
        header: trailer ? t('storyboard.narration') : t('storyboard.lines'),
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
    [
      sceneOptions,
      locationOptions,
      sizeChoices,
      angleChoices,
      cameraOptions,
      onEdit,
      starts,
      trailer,
    ],
  )

  // 「種類」欄只有專案裡有不動的畫面或字卡時才出現：一般專案的分鏡表跟以前一樣
  const showBeat = shots.some((shot) => shot.beatKind !== undefined && shot.beatKind !== 'video')
  const visibility = visibleColumns(
    columns.map((column) => column.id ?? ''),
    { trailer, showMore, showBeat },
  )
  const widths = Object.fromEntries(
    Object.entries(columnWidths()).filter(([id]) => visibility[id] !== false),
  )
  const table = useReactTable({
    data: shots,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (shot) => shot.id,
    state: { rowSelection: selected, columnVisibility: visibility },
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
    <>
      {trailer ? (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            data-testid="storyboard-more-columns"
            aria-pressed={showMore}
            className="rounded-lg border border-border bg-surface-raised px-2.5 py-1 text-xs hover:bg-accent/10"
            onClick={() => {
              setShowMore((on) => !on)
            }}
          >
            {showMore ? t('storyboard.fewerColumns') : t('storyboard.moreColumns')}
          </button>
        </div>
      ) : null}
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
    </>
  )
}
