import type { CanvasGraph } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useHistory } from '../../lib/history'
import { call, errorText } from '../../lib/svs'

export type CanvasState =
  | { status: 'loading' }
  | { status: 'ready'; graph: CanvasGraph }
  | { status: 'error'; message: string }

/**
 * 事件連續來的時候，每 120ms 最多重新載入一次（例如生成中 shots.changed、queue.changed 一直推）。
 * 是節流不是「等安靜下來才載入」：後者在生成中事件不斷時會一直延後，節點停在「生成中」，
 * 佇列卻已經寫「完成」。
 */
export const RELOAD_DELAY_MS = 120

/** 沒有展開步驟的鏡頭（固定同一個物件，免得每次都當成「變了」重新讀）。 */
const NONE: ReadonlySet<string> = new Set()

/**
 * 畫布首頁的資料：進來時讀一次 `canvas.get`；畫布、鏡頭、角色、地點有變動、
 * 或復原／重做之後重新讀取。重新讀取失敗時保留舊畫面（不閃成錯誤頁）。
 */
export function useCanvas(expanded: ReadonlySet<string> = NONE): {
  state: CanvasState
  reload: () => void
  /** 馬上重新讀取（不等合併），讀完才 resolve。 */
  refresh: () => Promise<void>
} {
  const [state, setState] = useState<CanvasState>({ status: 'loading' })
  const { revision } = useHistory()
  const alive = useRef(true)
  const timer = useRef<number | undefined>(undefined)
  // 展開步驟的鏡頭：每次讀畫布都帶上（只影響排版，不存）
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const load = useCallback((): Promise<void> => {
    const ids = [...expandedRef.current]
    return call('canvas.get', ids.length > 0 ? { expanded: ids } : {})
      .then((graph) => {
        if (alive.current) setState({ status: 'ready', graph })
      })
      .catch((error: unknown) => {
        if (!alive.current) return
        setState((prev) =>
          prev.status === 'ready' ? prev : { status: 'error', message: errorText(error) },
        )
      })
  }, [])

  const reload = useCallback((): void => {
    // 已經排了一次：這次的變動會一起被讀到，不用再排（也不把它往後延）
    if (timer.current !== undefined) return
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      void load()
    }, RELOAD_DELAY_MS)
  }, [load])
  const refresh = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    return load()
  }, [load])

  useEffect(() => {
    alive.current = true
    void load()
    const offs = [
      window.svs.on('canvas.changed', reload),
      window.svs.on('shots.changed', reload),
      // 佇列的任務變了（開始、完成、失敗）：節點的狀態跟著更新，和佇列同一個時間點
      window.svs.on('queue.changed', reload),
      window.svs.on('characters.conceptsChanged', reload),
      window.svs.on('locations.imagesChanged', reload),
      // 角色、地點、大綱在別的頁面改了（或浮動面板裡改了）：畫布跟著更新
      window.svs.on('characters.changed', reload),
      window.svs.on('locations.changed', reload),
      window.svs.on('outline.changed', reload),
    ]
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
      timer.current = undefined
      for (const off of offs) off()
    }
  }, [load, reload])

  // 展開或收合了步驟：馬上重排（不等合併）
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    void load()
  }, [expanded, load])

  // 復原／重做過：資料可能整個不一樣了
  useEffect(() => {
    if (revision > 0) reload()
  }, [revision, reload])

  return { state, reload, refresh }
}
