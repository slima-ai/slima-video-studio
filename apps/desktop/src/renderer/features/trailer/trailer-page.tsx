import type { ProjectInfo, ShotView, TrailerStatus } from '@svs/schema'
import { t } from '@svs/schema'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { cn } from '../../lib/cn'
import { call } from '../../lib/svs'
import { trailerBadgeLength, TrailerBadge } from '../canvas/trailer-badge'
import { TrailerStartCard } from '../canvas/trailer-start'
import { useShots } from '../shots/use-shots'
import { TrailerPlayer } from './trailer-player'

/** 內容區窄於這麼多（px）時，右邊的設定欄移到播放器下面。 */
export const WIDE_PX = 1100

/** 量一個元素的寬度（ResizeObserver）；量不到（還沒掛上、測試環境）回 0。 */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    setWidth(node.getBoundingClientRect().width)
    return () => {
      observer.disconnect()
    }
  }, [])
  return [ref, width]
}

/** 目前專案的名字與畫面比例（書名沒填時標題用專案名；直式時播放器照 9:16）。 */
function useProject(): ProjectInfo | undefined {
  const [info, setInfo] = useState<ProjectInfo>()
  useEffect(() => {
    let alive = true
    call('project.current', {})
      .then((next) => {
        if (alive && next) setInfo(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return info
}

/** 預告片這一場的格子：只取預告片的場、要放進成品的，依鏡號排。 */
export function trailerBeats(shots: readonly ShotView[], sceneId: string | undefined): ShotView[] {
  return shots
    .filter((shot) => (sceneId === undefined || shot.sceneId === sceneId) && shot.inCut !== false)
    .sort((a, b) => a.number - b.number)
}

/**
 * 「預告片」整頁：上面標題列，左邊播放器，右邊設定（共用畫布上那顆標籤的面板）。
 * 腳本還是空的就放「做預告片」那張卡。
 */
export function TrailerPage({ status }: { status: TrailerStatus }) {
  const { shots, finalVideoHash } = useShots()
  const project = useProject()
  const beats = useMemo(
    () => trailerBeats(shots, status.settings.sceneId),
    [shots, status.settings.sceneId],
  )
  const video = useRef<HTMLVideoElement>(null)
  const [pageRef, pageWidth] = useWidth<HTMLDivElement>()
  const wide = pageWidth === 0 || pageWidth >= WIDE_PX

  const name = status.settings.title.trim() || project?.name || ''
  const kind = status.settings.kind === 'teaser' ? t('trailer.kindTeaser') : t('trailer.kindStory')

  return (
    <div ref={pageRef} data-testid="trailer-page" className="flex min-h-full flex-col gap-4 p-4">
      <header className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold">
        <h1 data-testid="trailer-page-title">{name}</h1>
        <span className="text-fg-muted">·</span>
        <span data-testid="trailer-page-kind" className="text-fg-muted">
          {kind}
        </span>
        <span className="text-fg-muted">·</span>
        <span
          data-testid="trailer-page-length"
          data-matches={status.matches}
          className={cn(status.matches ? 'text-fg-muted' : 'text-warning')}
        >
          {trailerBadgeLength(status)}
        </span>
      </header>
      {beats.length === 0 ? (
        <div data-testid="trailer-page-empty" className="flex justify-center py-8">
          <TrailerStartCard />
        </div>
      ) : (
        <div className={cn('flex gap-4', wide ? 'flex-row items-start' : 'flex-col')}>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <TrailerPlayer
              finalHash={finalVideoHash}
              beat={beats[0]}
              portrait={project?.aspectRatio === '9:16'}
              title={name}
              videoRef={video}
            />
          </div>
          <aside
            data-testid="trailer-page-settings"
            className={cn('shrink-0', wide ? 'w-[320px]' : 'w-full')}
          >
            <TrailerBadge status={status} inline />
          </aside>
        </div>
      )}
    </div>
  )
}
