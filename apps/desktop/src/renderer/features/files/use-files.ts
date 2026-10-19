import type { FilesFilter, FilesSnapshot } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { call, errorText } from '../../lib/svs'

export interface FilesState {
  snapshot: FilesSnapshot | undefined
  error: string | undefined
  reload: () => void
}

/** 檔案紀錄：依篩選讀取；鏡頭有新結果、任務結束就重新讀。 */
export function useFiles(filter: FilesFilter): FilesState {
  const [snapshot, setSnapshot] = useState<FilesSnapshot>()
  const [error, setError] = useState<string>()
  const latest = useRef(0)
  const { kind, unusedOnly } = filter

  const reload = useCallback(() => {
    const ticket = ++latest.current
    call('files.list', {
      ...(kind ? { kind } : {}),
      ...(unusedOnly ? { unusedOnly } : {}),
    })
      .then((next) => {
        if (ticket !== latest.current) return
        setSnapshot(next)
        setError(undefined)
      })
      .catch((e: unknown) => {
        if (ticket === latest.current) setError(errorText(e))
      })
  }, [kind, unusedOnly])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    const offQueue = window.svs.on('queue.changed', (job) => {
      if (job.status === 'succeeded') reload()
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
