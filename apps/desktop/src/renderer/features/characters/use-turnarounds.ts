import type { ConceptCheck, TurnaroundsState } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { call, errorText } from '../../lib/svs'

export interface TurnaroundsData {
  state: TurnaroundsState | undefined
  check: ConceptCheck | undefined
  error: string | undefined
  generate: () => Promise<void>
  cancel: () => Promise<void>
}

/**
 * 某個角色的三視圖：先向主行程要一次，之後靠推送的事件保持最新。
 * `checkKey` 改變時（例如換了主圖）重新檢查能不能生成。
 */
export function useTurnarounds(characterId: string, checkKey?: string): TurnaroundsData {
  const [state, setState] = useState<TurnaroundsState>()
  const [check, setCheck] = useState<ConceptCheck>()
  const [error, setError] = useState<string>()
  const pushed = useRef(false)

  const refreshCheck = useCallback((): void => {
    call('characters.turnaroundCheck', { characterId })
      .then(setCheck)
      .catch(() => undefined)
  }, [characterId])

  useEffect(() => {
    let alive = true
    pushed.current = false
    const off = window.svs.on('characters.turnaroundsChanged', (next) => {
      if (next.characterId !== characterId) return
      pushed.current = true
      setState(next)
      // 這一輪結束了：費用可能因為設定改變而不同，重新問一次
      if (next.generating === undefined) refreshCheck()
    })
    call('characters.turnarounds', { characterId })
      .then((initial) => {
        // 比推送的事件晚到的舊快照不能蓋掉新的
        if (alive && !pushed.current) setState(initial)
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e))
      })
    return () => {
      alive = false
      off()
    }
  }, [characterId, refreshCheck])

  useEffect(() => {
    refreshCheck()
  }, [refreshCheck, checkKey])

  return {
    state,
    check,
    error,
    generate: async () => {
      setError(undefined)
      try {
        await call('characters.generateTurnarounds', { characterId })
      } catch (e) {
        setError(errorText(e))
      }
    },
    cancel: async () => {
      await call('characters.cancelTurnarounds', { characterId }).catch(() => undefined)
    },
  }
}
