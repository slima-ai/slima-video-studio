import { useEffect, useRef, useState } from 'react'

import { call, errorText } from '../../lib/svs'

/**
 * 聲音設定改完之後自動重混（不花錢）：等約半秒、連續改只混一次。
 * 沒有成品（`enabled` 為 false）時不混。
 */
export function useAutoMix(options: { enabled: boolean; onDone: () => void }): {
  mixing: boolean
  error: string | undefined
  schedule: () => void
} {
  const [mixing, setMixing] = useState(false)
  const [error, setError] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(options)
  latest.current = options

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const schedule = (): void => {
    if (!latest.current.enabled) {
      latest.current.onDone()
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setMixing(true)
      setError(undefined)
      call('sound.mix', {})
        .catch((e: unknown) => {
          setError(errorText(e))
        })
        .finally(() => {
          setMixing(false)
          latest.current.onDone()
        })
    }, 500)
  }

  return { mixing, error, schedule }
}
