import type { MessageRef, ShotView } from '@svs/schema'
import { msg, secLabel, t } from '@svs/schema'
import { AlertTriangle, Film, Heading, ImageIcon, Loader2, Type } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { assetUrl } from '../../lib/asset'
import { cn } from '../../lib/cn'
import {
  cellFit,
  cellWidthPx,
  gridColumns,
  segmentGroups,
  stripWidth,
  totalSecOf,
} from './strip-math'
import { previewOf } from './trailer-player'

type BeatKind = 'video' | 'still' | 'card' | 'title'

const KIND: Record<BeatKind, { icon: LucideIcon; label: MessageRef }> = {
  video: { icon: Film, label: msg('trailer.beatVideo') },
  still: { icon: ImageIcon, label: msg('trailer.beatStill') },
  card: { icon: Type, label: msg('trailer.beatCard') },
  title: { icon: Heading, label: msg('trailer.beatTitle') },
}

const SEGMENTS: Record<string, MessageRef> = {
  hook: msg('trailer.segment.hook'),
  world: msg('trailer.segment.world'),
  turn: msg('trailer.segment.turn'),
  escalate: msg('trailer.segment.escalate'),
  suspense: msg('trailer.segment.suspense'),
  montage: msg('trailer.segment.montage'),
  title: msg('trailer.segment.title'),
}

/** 段落的顯示名；不認得的代號（之後新增的類型）原樣顯示，沒有段落就留空。 */
export function segmentLabel(segment: string | undefined): string {
  if (segment === undefined) return ''
  const known = SEGMENTS[segment]
  return known ? t(known) : segment
}

export const kindOf = (beat: ShotView): BeatKind => beat.beatKind ?? 'video'

/** 這一格做好了沒：影片格要有影片、靜態格要有圖、字卡與片名卡看狀態。 */
export function isMade(beat: ShotView): boolean {
  switch (kindOf(beat)) {
    case 'video':
      return beat.videos.length > 0
    case 'still':
      return beat.firstFrames.length > 0
    default:
      return beat.status === 'done'
  }
}

/** 格子的狀態：生成中（含排隊）、失敗、做好了、還沒做。 */
export type CellState = 'generating' | 'failed' | 'made' | 'empty'

export function cellState(beat: ShotView): CellState {
  if (beat.status === 'generating' || beat.status === 'queued') return 'generating'
  if (beat.status === 'failed') return 'failed'
  return isMade(beat) ? 'made' : 'empty'
}

/**
 * 腳本條：段落、格子（寬度照秒數）、旁白、配樂四排。還沒生成任何東西也畫得出來。
 * 格子依寬度放圖示、縮圖、秒數；太窄只留圖示，再窄只留色塊。
 */
export function ScriptStrip({
  beats,
  selectedId,
  onSelect,
  availablePx,
  playheadSec,
  musicOn,
  onMenu,
}: {
  beats: readonly ShotView[]
  selectedId: string | undefined
  onSelect: (id: string) => void
  /** 可用的寬度（px）；30 秒塞進這個寬度，更長的片子超過就橫向捲。 */
  availablePx: number
  playheadSec: number | undefined
  musicOn: boolean
  /** 在格子上按右鍵。 */
  onMenu?: (beat: ShotView, at: { x: number; y: number }) => void
}) {
  const total = totalSecOf(beats)
  const width = stripWidth(total, availablePx)
  const columns = gridColumns(beats)
  const groups = segmentGroups(beats)
  return (
    <div className="flex gap-2" data-testid="script-strip">
      <div
        aria-hidden
        className="flex w-8 shrink-0 flex-col gap-1 pt-[22px] text-[10px] leading-none text-fg-subtle"
      >
        <span className="h-12" />
        <span className="h-3.5">{t('trailer.page.narrationRow')}</span>
        <span className="h-3.5">{t('trailer.page.musicRow')}</span>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto" data-testid="script-strip-scroll">
        <div
          role="group"
          aria-label={t('trailer.page.strip')}
          style={{ width }}
          className="relative flex flex-col gap-1"
        >
          <div className="grid gap-px" style={{ gridTemplateColumns: columns }}>
            {groups.map((group) => (
              <span
                key={group.from}
                data-testid="strip-segment"
                data-segment={group.segment ?? ''}
                style={{ gridColumn: `${String(group.from + 1)} / span ${String(group.count)}` }}
                className="truncate rounded-sm bg-surface-overlay px-1.5 py-0.5 text-[11px] leading-4 text-fg-muted"
              >
                {segmentLabel(group.segment)}
              </span>
            ))}
          </div>
          <div className="grid gap-px" style={{ gridTemplateColumns: columns }}>
            {beats.map((beat, index) => (
              <Cell
                key={beat.id}
                beat={beat}
                index={index}
                widthPx={cellWidthPx(beat, total, width)}
                selected={beat.id === selectedId}
                onSelect={onSelect}
                onMenu={onMenu}
              />
            ))}
          </div>
          <div className="grid h-3.5 items-center gap-px" style={{ gridTemplateColumns: columns }}>
            {beats.map((beat) => (
              <span
                key={beat.id}
                data-testid="strip-narration"
                data-has={beat.dialogue !== ''}
                className={cn('h-1.5 rounded-full', beat.dialogue !== '' && 'bg-accent/60')}
              />
            ))}
          </div>
          <div className="h-3.5">
            {musicOn ? (
              <span data-testid="strip-music" className="block h-1.5 rounded-full bg-fg/25" />
            ) : null}
          </div>
          {playheadSec !== undefined && total > 0 ? (
            <span
              aria-hidden
              data-testid="strip-playhead"
              style={{ left: `${String((Math.min(playheadSec, total) / total) * 100)}%` }}
              className="pointer-events-none absolute inset-y-0 w-px bg-accent"
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Cell({
  beat,
  index,
  widthPx,
  selected,
  onSelect,
  onMenu,
}: {
  beat: ShotView
  index: number
  widthPx: number
  selected: boolean
  onSelect: (id: string) => void
  onMenu: ((beat: ShotView, at: { x: number; y: number }) => void) | undefined
}) {
  const kind = kindOf(beat)
  const { icon: Icon } = KIND[kind]
  const fit = cellFit(widthPx)
  const state = cellState(beat)
  const image = previewOf(beat).image
  const label = t('trailer.page.cell', {
    n: index + 1,
    kind: t(KIND[kind].label),
    sec: secLabel(beat.durationSec),
  })
  const note =
    state === 'generating'
      ? t('trailer.page.cellGenerating')
      : state === 'failed'
        ? `${t('trailer.page.cellFailed')}${beat.error ? `：${beat.error}` : ''}`
        : state === 'empty'
          ? t('trailer.page.cellEmpty')
          : ''
  return (
    <button
      type="button"
      data-testid={`strip-cell-${String(index)}`}
      data-beat-id={beat.id}
      data-kind={kind}
      data-state={state}
      data-fit={fit}
      aria-pressed={selected}
      aria-label={label}
      title={note === '' ? label : `${label}\n${note}`}
      onClick={() => {
        onSelect(beat.id)
      }}
      onContextMenu={(event) => {
        if (!onMenu) return
        event.preventDefault()
        onSelect(beat.id)
        onMenu(beat, { x: event.clientX, y: event.clientY })
      }}
      className={cn(
        'relative flex h-12 min-w-0 items-center justify-center gap-1 overflow-hidden rounded-sm bg-cover bg-center px-0.5 text-[11px] text-fg',
        state === 'empty' ? 'border border-dashed border-fg/40 bg-surface' : 'bg-surface-overlay',
        state === 'failed' && 'ring-1 ring-danger',
        selected && 'z-10 ring-2 ring-accent',
      )}
      style={
        fit === 'full' && image && state !== 'empty'
          ? { backgroundImage: `url(${assetUrl(image)})` }
          : undefined
      }
    >
      {fit === 'block' ? null : state === 'generating' ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
      ) : state === 'failed' ? (
        <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-hidden />
      ) : (
        <Icon className="size-3.5 shrink-0 drop-shadow" aria-hidden />
      )}
      {fit === 'full' ? (
        <span className="truncate rounded bg-black/50 px-1 text-white">
          {secLabel(beat.durationSec)}
        </span>
      ) : null}
    </button>
  )
}
