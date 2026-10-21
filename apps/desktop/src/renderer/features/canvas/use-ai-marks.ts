import type { CanvasAiChanged } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { markableKeys, removedMessage } from './ai-marks'

/** 剛被改的節點亮多久（之後留著小標記，直到看過或動過）。 */
const FLASH_MS = 2200
/** 刪除的提示等多久再出：同一輪連著刪好幾次，合成一則。 */
const REMOVED_MERGE_MS = 800
/** 這麼久沒有新的刪除，下一次刪除就當成新的一批（不跟前面的合在一起）。 */
const REMOVED_BATCH_MS = 8000

/**
 * 畫布上「AI 剛改」的標記：訂 `canvas.aiChanged`。
 * - `fresh`：標著「AI 剛改」的節點，直到使用者看過（選取、滑過一下）或動過就消失；
 * - `flash`：剛被改、正在亮一下的節點（幾秒後只剩標記）；
 * - 刪掉的東西交給 `onRemoved`（畫面用提示說「AI 刪了第 3 鏡…，按「復原」可以找回來」）；
 *   連著刪好幾次（同一輪）合成一則，使用者復原之後重新算。
 * 已經標著的節點之後內容又變了（例如 AI 叫的生成做完了），畫布頁用 `rekindle` 再亮一次。
 */
export function useAiMarks(
  onRemoved: (message: string) => void,
  /** 這個當下是不是右下角 Claude 對話正在做事（那一輪的改動合成一步復原，提示要這樣說）。 */
  inChatTurn: () => boolean = () => false,
): {
  fresh: ReadonlySet<string>
  flash: ReadonlySet<string>
  seen: (keys: Iterable<string>) => void
  /** 已經標著的節點內容變了（例如 AI 叫的生成做完了）：再亮一次。 */
  rekindle: (keys: readonly string[]) => void
  /** 只留這些節點的標記（節點不在了就不用記著）。 */
  prune: (existing: ReadonlySet<string>) => void
  /** 剛有人改過的節點鍵（給「畫面跟著 AI」用）。 */
  latest: CanvasAiChanged | undefined
} {
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const [flash, setFlash] = useState<ReadonlySet<string>>(new Set())
  const [latest, setLatest] = useState<CanvasAiChanged>()
  const timers = useRef(new Map<string, number>())
  const removedRef = useRef(onRemoved)
  removedRef.current = onRemoved
  const turnRef = useRef(inChatTurn)
  turnRef.current = inChatTurn
  // 這一批連著刪掉的節點（合成一則提示）
  const batch = useRef<{
    removed: CanvasAiChanged['removed']
    wholeTurn: boolean
    flush?: number
    reset?: number
  }>({ removed: [], wholeTurn: false })

  const stopFlash = useCallback((key: string): void => {
    window.clearTimeout(timers.current.get(key))
    timers.current.delete(key)
  }, [])

  const kindle = useCallback(
    (keys: readonly string[]): void => {
      setFlash((now) => new Set([...now, ...keys]))
      for (const key of keys) {
        stopFlash(key)
        timers.current.set(
          key,
          window.setTimeout(() => {
            timers.current.delete(key)
            setFlash((now) => {
              const next = new Set(now)
              next.delete(key)
              return next
            })
          }, FLASH_MS),
        )
      }
    },
    [stopFlash],
  )

  useEffect(() => {
    const pending = timers.current
    const off = window.svs.on('canvas.aiChanged', (event) => {
      const keys = markableKeys(event)
      setLatest(event)
      if (keys.length > 0) {
        setFresh((now) => new Set([...now, ...keys]))
        kindle(keys)
      }
      if (event.removed.length > 0) {
        const now = batch.current
        window.clearTimeout(now.flush)
        window.clearTimeout(now.reset)
        const known = new Set(now.removed.map((node) => node.key))
        now.removed = [...now.removed, ...event.removed.filter((node) => !known.has(node.key))]
        now.wholeTurn = now.wholeTurn || turnRef.current()
        now.flush = window.setTimeout(() => {
          const message = removedMessage(batch.current.removed, batch.current.wholeTurn)
          if (message !== undefined) removedRef.current(message)
        }, REMOVED_MERGE_MS)
        now.reset = window.setTimeout(() => {
          batch.current = { removed: [], wholeTurn: false }
        }, REMOVED_BATCH_MS)
      }
    })
    return () => {
      off()
      window.clearTimeout(batch.current.flush)
      window.clearTimeout(batch.current.reset)
      for (const timer of pending.values()) window.clearTimeout(timer)
      pending.clear()
    }
  }, [kindle])

  const seen = useCallback(
    (keys: Iterable<string>): void => {
      const list = [...keys]
      setFresh((now) => {
        if (!list.some((key) => now.has(key))) return now
        const next = new Set(now)
        for (const key of list) next.delete(key)
        return next
      })
      for (const key of list) stopFlash(key)
      setFlash((now) =>
        list.some((key) => now.has(key)) ? new Set([...now].filter((k) => !list.includes(k))) : now,
      )
    },
    [stopFlash],
  )

  // 使用者復原／重做之後，因此變了的節點：內容已經退回去（或是使用者自己要的），「AI 剛改」不再對，一起拿掉
  useEffect(
    () =>
      window.svs.on('canvas.marksReverted', (event) => {
        seen(event.keys)
        // 使用者復原了：刪掉的東西回來了，之後的刪除另外算一批
        window.clearTimeout(batch.current.flush)
        window.clearTimeout(batch.current.reset)
        batch.current = { removed: [], wholeTurn: false }
      }),
    [seen],
  )

  // 畫面上出現過的節點：事件比畫布重新載入早到時，新節點還不在畫面裡，不能當成「不見了」
  const known = useRef(new Set<string>())
  const prune = useCallback((existing: ReadonlySet<string>): void => {
    const gone = [...known.current].filter((key) => !existing.has(key))
    for (const key of existing) known.current.add(key)
    for (const key of gone) known.current.delete(key)
    if (gone.length === 0) return
    setFresh((now) => {
      const next = new Set([...now].filter((key) => !gone.includes(key)))
      return next.size === now.size ? now : next
    })
  }, [])

  return { fresh, flash, seen, rekindle: kindle, prune, latest }
}
