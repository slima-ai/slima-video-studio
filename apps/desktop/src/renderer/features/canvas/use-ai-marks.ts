import type { CanvasAiChanged } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { markableKeys, removedMessage } from './ai-marks'

/** 剛被改的節點亮多久（之後留著小標記，直到看過或動過）。 */
const FLASH_MS = 2200

/**
 * 畫布上「AI 剛改」的標記：訂 `canvas.aiChanged`。
 * - `fresh`：標著「AI 剛改」的節點，直到使用者看過（選取、滑過一下）或動過就消失；
 * - `flash`：剛被改、正在亮一下的節點（幾秒後只剩標記）；
 * - 刪掉的東西交給 `onRemoved`（畫面用提示說「AI 刪了第 3 鏡，可以復原」）。
 * 已經標著的節點之後又被改（例如 AI 叫的生成做完了），再亮一次。
 */
export function useAiMarks(onRemoved: (message: string) => void): {
  fresh: ReadonlySet<string>
  flash: ReadonlySet<string>
  seen: (keys: Iterable<string>) => void
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

  const stopFlash = useCallback((key: string): void => {
    window.clearTimeout(timers.current.get(key))
    timers.current.delete(key)
  }, [])

  useEffect(() => {
    const pending = timers.current
    const off = window.svs.on('canvas.aiChanged', (event) => {
      const keys = markableKeys(event)
      setLatest(event)
      if (keys.length > 0) {
        setFresh((now) => new Set([...now, ...keys]))
        setFlash((now) => new Set([...now, ...keys]))
        for (const key of keys) {
          stopFlash(key)
          pending.set(
            key,
            window.setTimeout(() => {
              pending.delete(key)
              setFlash((now) => {
                const next = new Set(now)
                next.delete(key)
                return next
              })
            }, FLASH_MS),
          )
        }
      }
      const message = removedMessage(event.removed)
      if (message !== undefined) removedRef.current(message)
    })
    return () => {
      off()
      for (const timer of pending.values()) window.clearTimeout(timer)
      pending.clear()
    }
  }, [stopFlash])

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

  const prune = useCallback((existing: ReadonlySet<string>): void => {
    setFresh((now) => {
      const next = new Set([...now].filter((key) => existing.has(key)))
      return next.size === now.size ? now : next
    })
  }, [])

  return { fresh, flash, seen, prune, latest }
}
