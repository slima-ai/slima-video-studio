import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '../../components/button'

/** 確認面板貼在哪個按鈕旁邊（畫面座標）：按鈕的左右上下緣。 */
export interface ConfirmAnchor {
  left: number
  right: number
  top: number
  bottom: number
  /** 按鈕在畫布的格子上：畫面平移時它跟著動（上方列的按鈕不會）。 */
  onCanvas?: boolean
}

/** 按鈕的位置（確認面板貼在它旁邊）。 */
export function anchorOf(element: Element): ConfirmAnchor {
  const box = element.getBoundingClientRect()
  return {
    left: box.left,
    right: box.right,
    top: box.top,
    bottom: box.bottom,
    onCanvas: element.closest('.react-flow__node') !== null,
  }
}

/** 畫面平移了 (dx, dy)：在格子上的按鈕跟著動，面板也要跟著貼過去。 */
export function shiftAnchor(
  anchor: ConfirmAnchor,
  moved: { dx: number; dy: number },
): ConfirmAnchor {
  if (anchor.onCanvas !== true) return anchor
  return {
    ...anchor,
    left: anchor.left + moved.dx,
    right: anchor.right + moved.dx,
    top: anchor.top + moved.dy,
    bottom: anchor.bottom + moved.dy,
  }
}

const WIDTH = 340
const GAP = 12
const MARGIN = 12

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top))

/**
 * 確認面板放哪裡：依序試按鈕的右邊、左邊、下面、上面（都貼著按鈕、不超出視窗），
 * 選第一個不蓋住按鈕、也不蓋住被標亮的格子的位置；都會蓋到就選蓋得最少的。
 * 所以面板永遠在按鈕附近，不會跑到畫面另一頭。
 */
export function placeConfirm(
  anchor: ConfirmAnchor,
  size: { width: number; height: number },
  view: { width: number; height: number },
  avoid: readonly Box[] = [],
): { left: number; top: number } {
  const clampX = (x: number): number =>
    Math.max(MARGIN, Math.min(x, view.width - size.width - MARGIN))
  const clampY = (y: number): number =>
    Math.max(MARGIN, Math.min(y, view.height - size.height - MARGIN))
  const middleY = (anchor.top + anchor.bottom) / 2 - size.height / 2
  const candidates = [
    {
      left: anchor.right + GAP,
      top: clampY(middleY),
      fits: anchor.right + GAP + size.width <= view.width - MARGIN,
    },
    {
      left: anchor.left - GAP - size.width,
      top: clampY(middleY),
      fits: anchor.left - GAP - size.width >= MARGIN,
    },
    {
      left: clampX(anchor.right - size.width),
      top: anchor.bottom + GAP,
      fits: anchor.bottom + GAP + size.height <= view.height - MARGIN,
    },
    {
      left: clampX(anchor.right - size.width),
      top: anchor.top - GAP - size.height,
      fits: anchor.top - GAP - size.height >= MARGIN,
    },
  ]
  const button: Box = {
    left: anchor.left,
    top: anchor.top,
    width: anchor.right - anchor.left,
    height: anchor.bottom - anchor.top,
  }
  let best: { left: number; top: number } | undefined
  let bestCost = Infinity
  for (const c of candidates) {
    if (!c.fits) continue
    const box = { left: c.left, top: c.top, ...size }
    const cost = avoid.reduce((sum, rect) => sum + overlap(box, rect), overlap(box, button) * 4)
    if (cost === 0) return { left: c.left, top: c.top }
    if (cost < bestCost) {
      bestCost = cost
      best = { left: c.left, top: c.top }
    }
  }
  // 視窗太小，四邊都放不下：貼在按鈕下方並收進視窗
  return best ?? { left: clampX(anchor.right - size.width), top: clampY(anchor.bottom + GAP) }
}

/** 畫面上被標亮的格子（確認面板不能蓋住）。 */
const glowingBoxes = (): Box[] =>
  [...document.querySelectorAll('.svs-glow')].map((el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })

/**
 * 步驟清單：內容不多就整個放下；太多（例如 27 鏡）才捲動，而且要看得出下面還有東西
 * （底部漸層＋一行「往下還有…」，macOS 的捲動條平常是隱藏的，不能只靠它）。
 */
function StepList({ lines }: { lines: readonly string[] }) {
  const listRef = useRef<HTMLUListElement>(null)
  const [more, setMore] = useState(false)
  const measure = useCallback((): void => {
    const el = listRef.current
    if (!el) return
    setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
  }, [])
  useLayoutEffect(() => {
    measure()
    const el = listRef.current
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    if (el) observer?.observe(el)
    return () => {
      observer?.disconnect()
    }
  }, [measure, lines])
  return (
    <div className="relative min-h-0" data-testid="run-confirm-steps" data-more={more}>
      <ul
        ref={listRef}
        onScroll={measure}
        className="flex max-h-[min(22rem,40vh)] flex-col gap-0.5 overflow-auto text-sm text-fg-muted"
      >
        {lines.map((line, index) => (
          <li key={`${line}-${String(index)}`}>{line}</li>
        ))}
      </ul>
      {more ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-5 h-6 bg-gradient-to-t from-surface-raised to-transparent"
          />
          <p className="pt-1 text-xs text-fg-muted" data-testid="run-confirm-more">
            ↓ 往下還有，捲動看全部
          </p>
        </>
      ) : null}
    </div>
  )
}

/**
 * 執行前的花費確認：貼在按下去的 ▶ 旁邊的小面板（不蓋住被標亮的格子），不蓋全畫面的暗幕。
 * 這樣被標亮的那一串節點與流動的連線還看得清楚，使用者可以邊看邊決定。
 * Esc 取消、Enter 確認。
 */
export function RunConfirm({
  anchor,
  count,
  lines,
  pinnedLines = [],
  costUsd,
  lowerBound = false,
  title,
  okLabel = '執行',
  danger = false,
  cachedNote = true,
  costLabel = '預估約',
  extra,
  free = false,
  onOk,
  onCancel,
}: {
  anchor: ConfirmAnchor
  count: number
  lines: readonly string[]
  /** 不跟著清單捲動的幾行（用哪個模型、示範模式不花錢）：清單再長也永遠看得到。 */
  pinnedLines?: readonly string[]
  costUsd: number
  /** 有些步驟估不出來，實際花費可能比預估多。 */
  lowerBound?: boolean
  title?: string
  okLabel?: string
  /** 確認的是會刪東西的動作：確認鈕用警示色。 */
  danger?: boolean
  /** 花費後面註明「已經有結果的不會重跑」；會重做已有結果的動作要關掉。 */
  cachedNote?: boolean
  /** 花費那一行開頭的字（預設「預估約」）。 */
  costLabel?: string
  /** 清單下方多放的選項或說明。 */
  extra?: ReactNode
  /** 不花錢的動作（例如只在本機接成品）：不顯示預估花費那一行。 */
  free?: boolean
  onOk: () => void
  onCancel: () => void
}) {
  const okRef = useRef<HTMLButtonElement>(null)
  // 畫面一出現就要能按 Esc、焦點就在「確認」上：用 layout effect（畫出來之前就掛好），
  // 一般 effect 要等畫完才跑，這段空檔按的 Esc 會沒反應
  useLayoutEffect(() => {
    const opener = document.activeElement
    okRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [onCancel])

  // 量到面板實際的高度才決定位置（內容多寡不同）；量好之前先不顯示，免得在別處閃一下
  const panelRef = useRef<HTMLElement>(null)
  const [at, setAt] = useState<{ left: number; top: number }>()
  useLayoutEffect(() => {
    const place = (): void => {
      const height = panelRef.current?.offsetHeight ?? 0
      setAt(
        placeConfirm(
          anchor,
          { width: WIDTH, height },
          { width: window.innerWidth, height: window.innerHeight },
          glowingBoxes(),
        ),
      )
    }
    place()
    // 內容變了（例如勾了「刪掉現有的內容」多出警告）高度跟著變，要重新放
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    if (panelRef.current) observer?.observe(panelRef.current)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  // 不淡入：淡入的那一下面板是半透明的，看起來像灰色殘影
  return (
    <section
      role="dialog"
      aria-label="執行確認"
      data-testid="run-confirm"
      ref={panelRef}
      data-placed={at !== undefined}
      className="fixed z-50 flex max-h-[calc(100vh-24px)] flex-col gap-3 rounded-lg border border-border bg-surface-raised p-5 text-fg shadow-panel"
      style={{
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        width: WIDTH,
        ...(at ? {} : { opacity: 0 }),
      }}
    >
      <h2 className="text-base font-semibold">{title ?? `這次會做 ${String(count)} 步`}</h2>
      {lines.length > 0 ? <StepList lines={lines} /> : null}
      {/* 用哪個模型、示範模式的說明：永遠在捲動區外面看得到（真實模式這行是「用什麼、多少錢」的一半） */}
      {pinnedLines.length > 0 ? (
        <ul
          className="flex flex-col gap-0.5 text-sm text-fg-muted"
          data-testid="run-confirm-pinned"
        >
          {pinnedLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {extra}
      {free ? null : (
        <p className="text-sm">
          {costLabel} <b className="font-semibold">US${costUsd.toFixed(2)}</b>
          {lowerBound ? '（至少，實際可能更多）' : ''}
          {cachedNote ? '（已經有結果的不會重跑）' : ''}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button
          ref={okRef}
          variant={danger ? 'danger' : 'primary'}
          data-testid="run-confirm-ok"
          onClick={onOk}
        >
          {okLabel}
        </Button>
      </div>
    </section>
  )
}
