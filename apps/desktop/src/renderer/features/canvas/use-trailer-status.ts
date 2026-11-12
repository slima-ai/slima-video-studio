import type { IpcEventName, TrailerStatus } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { call } from '../../lib/svs'

/** 這些事件發生，預告片的腳本加總或目標可能變了：重新問一次 trailer.status。 */
const WATCHED: readonly IpcEventName[] = [
  'trailer.changed',
  'shots.changed',
  'outline.changed',
  'history.changed',
  'queue.reset',
]

/**
 * 目前專案的預告片狀態（目標秒數、腳本加總、成品長度、檢查結果）。
 * `undefined` 是還沒問到；一般專案（沒有預告片設定）回 `exists: false`，畫面不顯示任何預告片的東西。
 */
export function useTrailerStatus(): { status: TrailerStatus | undefined; refresh: () => void } {
  const [status, setStatus] = useState<TrailerStatus>()
  const latest = useRef(0)
  const load = useCallback((): void => {
    const mine = ++latest.current
    call('trailer.status', {})
      .then((next) => {
        if (mine === latest.current) setStatus(next)
      })
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    load()
    const offs = WATCHED.map((event) => window.svs.on(event, load))
    return () => {
      for (const off of offs) off()
      latest.current++
    }
  }, [load])
  return { status, refresh: load }
}
