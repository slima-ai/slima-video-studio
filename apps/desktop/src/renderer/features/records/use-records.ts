import type { RecordsFilter, RecordsSnapshot } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { call, errorText } from '../../lib/svs'

export interface RecordsState {
  snapshot: RecordsSnapshot | undefined
  error: string | undefined
  reload: () => void
}

/** 生成紀錄：依篩選讀取；有任務結束（queue.changed）或鏡頭有新結果（shots.changed）就重新讀。 */
export function useRecords(filter: RecordsFilter): RecordsState {
  const [snapshot, setSnapshot] = useState<RecordsSnapshot>()
  const [error, setError] = useState<string>()
  const latest = useRef(0)
  const { kind, outcome, shotId } = filter

  const reload = useCallback(() => {
    const ticket = ++latest.current
    call('records.list', {
      ...(kind ? { kind } : {}),
      ...(outcome ? { outcome } : {}),
      ...(shotId ? { shotId } : {}),
    })
      .then((next) => {
        if (ticket !== latest.current) return
        setSnapshot(next)
        setError(undefined)
      })
      .catch((e: unknown) => {
        if (ticket === latest.current) setError(errorText(e))
      })
  }, [kind, outcome, shotId])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    const offQueue = window.svs.on('queue.changed', (job) => {
      // 只有任務結束才會多一筆紀錄；排隊、進行中的更新不必重讀
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
        reload()
      }
    })
    const offShots = window.svs.on('shots.changed', () => {
      reload()
    })
    return () => {
      offQueue()
      offShots()
    }
  }, [reload])

  return { snapshot, error, reload }
}
