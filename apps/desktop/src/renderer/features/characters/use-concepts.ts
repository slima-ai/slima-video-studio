import type { ConceptCheck, ConceptsState } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { call, errorText } from '../../lib/svs'

export interface ConceptsData {
  state: ConceptsState | undefined
  check: ConceptCheck | undefined
  error: string | undefined
  generate: () => Promise<void>
  cancel: () => Promise<void>
}

/** 某個角色的概念圖：先向主行程要一次，之後靠推送的事件保持最新。 */
export function useConcepts(characterId: string): ConceptsData {
  const [state, setState] = useState<ConceptsState>()
  const [check, setCheck] = useState<ConceptCheck>()
  const [error, setError] = useState<string>()
  const pushed = useRef(false)

  const refreshCheck = useCallback((): void => {
    call('characters.conceptCheck', { characterId })
      .then(setCheck)
      .catch(() => undefined)
  }, [characterId])

  useEffect(() => {
    let alive = true
    pushed.current = false
    const off = window.svs.on('characters.conceptsChanged', (next) => {
      if (next.characterId !== characterId) return
      pushed.current = true
      setState(next)
      // 這一輪結束了：費用可能因為設定改變而不同，重新問一次
      if (next.generating === undefined) refreshCheck()
    })
    call('characters.concepts', { characterId })
      .then((initial) => {
        // 比推送的事件晚到的舊快照不能蓋掉新的
        if (alive && !pushed.current) setState(initial)
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e))
      })
    refreshCheck()
    return () => {
      alive = false
      off()
    }
  }, [characterId, refreshCheck])

  return {
    state,
    check,
    error,
    generate: async () => {
      setError(undefined)
      try {
        await call('characters.generateConcepts', { characterId })
      } catch (e) {
        setError(errorText(e))
      }
    },
    cancel: async () => {
      await call('characters.cancelConcepts', { characterId }).catch(() => undefined)
    },
  }
}
