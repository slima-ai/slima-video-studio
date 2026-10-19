import type { SoundState } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { call, errorText } from '../../lib/svs'

export interface UseSound {
  state: SoundState | undefined
  error: string | undefined
  reload: () => void
}

/** 目前專案的聲音：開啟時讀一次；聲音有變動（sound.changed）或鏡頭有變動（shots.changed）就更新。 */
export function useSound(): UseSound {
  const [state, setState] = useState<SoundState>()
  const [error, setError] = useState<string>()
  const latest = useRef(0)

  const reload = useCallback(() => {
    const ticket = ++latest.current
    call('sound.get', {})
      .then((next) => {
        if (ticket !== latest.current) return
        setState(next)
        setError(undefined)
      })
      .catch((e: unknown) => {
        if (ticket === latest.current) setError(errorText(e))
      })
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    const offSound = window.svs.on('sound.changed', (next) => {
      latest.current++
      setState(next)
      setError(undefined)
    })
    const offShots = window.svs.on('shots.changed', () => {
      reload()
    })
    return () => {
      offSound()
      offShots()
    }
  }, [reload])

  return { state, error, reload }
}
