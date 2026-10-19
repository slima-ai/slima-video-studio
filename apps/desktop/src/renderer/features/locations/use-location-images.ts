import type { ConceptCheck, LocationGenerateKind, LocationImagesState } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { call, errorText } from '../../lib/svs'

export interface LocationImagesData {
  state: LocationImagesState | undefined
  checks: Partial<Record<LocationGenerateKind, ConceptCheck>>
  error: string | undefined
  generate: (kind: LocationGenerateKind) => Promise<void>
  cancel: () => Promise<void>
  /** 主圖、鎖定等改動之後，重新問一次能不能生成與預估花費。 */
  recheck: () => void
}

/** 某張場景卡的概念圖與生成進度：先向主行程要一次，之後靠推送的事件保持最新。 */
export function useLocationImages(
  locationId: string,
  /** 一輪生成結束時通知（角度會寫進場景卡，要重新讀場景卡）。 */
  onFinished: () => void,
): LocationImagesData {
  const [state, setState] = useState<LocationImagesState>()
  const [checks, setChecks] = useState<LocationImagesData['checks']>({})
  const [error, setError] = useState<string>()
  const pushed = useRef(false)
  /** 上一次收到的快照是不是還在生成（用來偵測「剛結束」）。 */
  const wasGenerating = useRef(false)
  const finished = useRef(onFinished)
  finished.current = onFinished

  const recheck = useCallback((): void => {
    for (const kind of ['concepts', 'angles'] as const) {
      call('locations.check', { locationId, kind })
        .then((next) => {
          setChecks((current) => ({ ...current, [kind]: next }))
        })
        .catch(() => undefined)
    }
  }, [locationId])

  useEffect(() => {
    let alive = true
    pushed.current = false
    wasGenerating.current = false
    const off = window.svs.on('locations.imagesChanged', (next) => {
      if (next.locationId !== locationId) return
      pushed.current = true
      // 這一輪剛結束：場景卡上的角度可能更新了
      if (wasGenerating.current && !next.generating) finished.current()
      wasGenerating.current = next.generating !== undefined
      setState(next)
      if (next.generating === undefined) recheck()
    })
    call('locations.images', { locationId })
      .then((initial) => {
        // 比推送的事件晚到的舊快照不能蓋掉新的
        if (alive && !pushed.current) {
          wasGenerating.current = initial.generating !== undefined
          setState(initial)
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e))
      })
    recheck()
    return () => {
      alive = false
      off()
    }
  }, [locationId, recheck])

  return {
    state,
    checks,
    error,
    recheck,
    generate: async (kind) => {
      setError(undefined)
      try {
        await call('locations.generate', { locationId, kind })
      } catch (e) {
        setError(errorText(e))
      }
    },
    cancel: async () => {
      await call('locations.cancel', { locationId }).catch(() => undefined)
    },
  }
}
