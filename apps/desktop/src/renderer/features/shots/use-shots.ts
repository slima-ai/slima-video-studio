import type { ShotsSnapshot } from '@svs/schema'
import { useEffect, useRef, useState } from 'react'

import { useHistory } from '../../lib/history'
import { call } from '../../lib/svs'

const EMPTY: ShotsSnapshot = { shots: [] }

/** 目前專案的鏡頭與各版本：先向主行程要一次，之後靠推送的事件保持最新。 */
export function useShots(): ShotsSnapshot {
  const [snapshot, setSnapshot] = useState<ShotsSnapshot>(EMPTY)
  const pushed = useRef(false)
  const { revision } = useHistory()

  useEffect(() => {
    let alive = true
    const off = window.svs.on('shots.changed', (next) => {
      pushed.current = true
      setSnapshot(next)
    })
    call('shots.list', {})
      .then((initial) => {
        // 比推送的事件晚到的舊快照不能蓋掉新的
        if (alive && !pushed.current) setSnapshot(initial)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      off()
    }
  }, [])

  // 復原／重做改了鏡頭（新增、刪除、排序…），重新向主行程要一份最新的
  useEffect(() => {
    if (revision === 0) return undefined
    let alive = true
    call('shots.list', {})
      .then((latest) => {
        if (alive) setSnapshot(latest)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [revision])

  return snapshot
}
