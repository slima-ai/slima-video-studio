import type { CanvasNode } from './canvas-model'
import { panToReveal, rectOf, type RevealMargin } from './geometry'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const unionOf = (boxes: readonly Box[]): Box => {
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * AI 剛動了這些節點：畫面要平移到哪裡才看得到（不改縮放，免得使用者的視角被搶走）。
 * 全部放得進畫面就讓全部都看得到；放不下（例如 AI 一次拆了 27 個鏡頭）就只帶最前面（最上面最左邊）
 * 那一個進來。本來就看得到就回 undefined（不動）。
 */
export function followPan(
  viewport: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
  nodes: readonly CanvasNode[],
  keys: readonly string[],
  margin: number | RevealMargin,
): { x: number; y: number } | undefined {
  const wanted = new Set(keys)
  const boxes = nodes.filter((n) => wanted.has(n.id)).map(rectOf)
  if (boxes.length === 0) return undefined
  const m =
    typeof margin === 'number'
      ? { top: margin, left: margin, right: margin, bottom: margin }
      : margin
  const all = unionOf(boxes)
  const fits =
    all.w * viewport.zoom <= size.width - m.left - m.right &&
    all.h * viewport.zoom <= size.height - m.top - m.bottom
  const target = fits ? all : ([...boxes].sort((a, b) => a.y - b.y || a.x - b.x)[0] ?? all)
  return panToReveal(viewport, size, target, margin)
}

/** 使用者自己在動畫布（按著滑鼠、剛拖過或縮放）的這段時間，不搶畫面。 */
export const USER_BUSY_MS = 1500
