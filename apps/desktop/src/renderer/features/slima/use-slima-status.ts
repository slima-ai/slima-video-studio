import type { SlimaStatus } from '@svs/schema'
import { useEffect, useState } from 'react'

import { call } from '../../lib/svs'

/** Slima 的連線狀態：先問主行程目前的狀態，之後靠推送的事件更新（還沒拿到時是 undefined）。 */
export function useSlimaStatus(): SlimaStatus | undefined {
  const [status, setStatus] = useState<SlimaStatus | undefined>()

  useEffect(() => {
    let alive = true
    const off = window.svs.on('slima.status', (next) => {
      setStatus(next)
    })
    call('slima.status', {})
      .then((current) => {
        // 比推送事件晚到的舊狀態不能蓋掉新的
        if (alive) setStatus((existing) => existing ?? current)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      off()
    }
  }, [])

  return status
}
