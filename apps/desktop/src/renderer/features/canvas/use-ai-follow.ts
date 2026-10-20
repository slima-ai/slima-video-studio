import { useReactFlow } from '@xyflow/react'
import type { CanvasAiChanged } from '@svs/schema'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { followPan, USER_BUSY_MS } from './ai-follow'
import { markableKeys } from './ai-marks'
import type { CanvasEdge, CanvasNode } from './canvas-model'
import type { RevealMargin } from './geometry'

const STORAGE_KEY = 'svs-follow-ai'
/** 事件到了，節點還沒讀回畫面時，最多等這麼久。 */
const WAIT_NODES_MS = 2000
/** 平順移過去的時間。 */
const MOVE_MS = 500

const readStored = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

/**
 * 「跟著 AI」：AI 工具（MCP）在改東西時，畫面平順地移到正在改的地方，讓人看得到它做了什麼。
 * - 只平移、不改縮放；放不下（一次改很多）就只帶最前面那一個進來；
 * - 使用者在動畫布（按著滑鼠、正在打字或改名、剛按過鍵盤、剛縮放）時不搶畫面，結束後再等一下；
 * - 有開關（記在這台電腦上，預設開），關掉就完全不動。
 */
export function useAiFollow({
  latest,
  nodes,
  container,
  margin,
}: {
  latest: CanvasAiChanged | undefined
  nodes: readonly CanvasNode[]
  container: RefObject<HTMLElement | null>
  margin: RevealMargin
}): { follow: boolean; setFollow: (next: boolean) => void } {
  const rf = useReactFlow<CanvasNode, CanvasEdge>()
  const [follow, setFollowState] = useState(readStored)
  const setFollow = useCallback((next: boolean): void => {
    setFollowState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      // 記不起來也沒關係：這一次還是照選的
    }
  }, [])

  // 使用者正在動畫布：按鍵還按著、焦點在畫布裡能輸入的地方（打字、改名），
  // 或這些剛結束、剛按過鍵盤、剛滾動縮放不久（結束之後再多等 USER_BUSY_MS）
  const down = useRef(false)
  const busyUntil = useRef(0)
  const typing = useCallback((): boolean => {
    const el = container.current
    const active = document.activeElement
    return (
      el !== null &&
      active instanceof HTMLElement &&
      el.contains(active) &&
      active.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
    )
  }, [container])
  useEffect(() => {
    const el = container.current
    if (!el) return undefined
    const later = (): void => {
      busyUntil.current = Date.now() + USER_BUSY_MS
    }
    const onDown = (): void => {
      down.current = true
    }
    // 只算「在畫布上按下去」的那一次放開；點別的地方（左邊導覽、按鈕）不算在動畫布
    const onUp = (): void => {
      if (!down.current) return
      down.current = false
      later()
    }
    el.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    el.addEventListener('wheel', later, { passive: true })
    el.addEventListener('keydown', later, true)
    el.addEventListener('focusout', later, true)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      el.removeEventListener('wheel', later)
      el.removeEventListener('keydown', later, true)
      el.removeEventListener('focusout', later, true)
    }
  }, [container])

  // 新的事件：記下要帶進畫面的節點；節點已經在畫面上（畫布比事件早讀回來）就馬上移，還沒有就等它讀回來再移
  const pending = useRef<{ keys: string[]; until: number } | undefined>(undefined)
  useEffect(() => {
    if (!latest || !follow) return
    const keys = markableKeys(latest)
    if (keys.length > 0) pending.current = { keys, until: Date.now() + WAIT_NODES_MS }
  }, [latest, follow])

  useEffect(() => {
    const wanted = pending.current
    if (!wanted) return
    if (Date.now() > wanted.until || !follow) {
      pending.current = undefined
      return
    }
    const known = new Set(nodes.map((n) => n.id))
    if (!wanted.keys.some((key) => known.has(key))) return
    pending.current = undefined
    if (down.current || typing() || Date.now() < busyUntil.current) return
    const el = container.current
    if (!el) return
    const viewport = rf.getViewport()
    const pan = followPan(
      viewport,
      { width: el.clientWidth, height: el.clientHeight },
      nodes,
      wanted.keys,
      margin,
    )
    if (pan) void rf.setViewport({ ...viewport, ...pan }, { duration: MOVE_MS })
  }, [nodes, latest, follow, rf, container, margin, typing])

  return { follow, setFollow }
}
