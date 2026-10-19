import type { ShotGraph } from '@svs/schema'
import { useEffect, useState } from 'react'

import { call, errorText } from '../../lib/svs'

export type ShotGraphState =
  | { status: 'loading' }
  | { status: 'ready'; graph: ShotGraph }
  | { status: 'error'; message: string }

/** 一個鏡頭的節點圖：換鏡頭、或這個鏡頭有新的生成結果時重新讀取。 */
export function useShotGraph(shotId: string | undefined): ShotGraphState {
  const [state, setState] = useState<ShotGraphState>({ status: 'loading' })
  const [version, setVersion] = useState(0)

  useEffect(
    () =>
      window.svs.on('shots.changed', () => {
        setVersion((v) => v + 1)
      }),
    [],
  )

  useEffect(() => {
    if (shotId === undefined) return
    let alive = true
    call('graph.shot', { shotId })
      .then((graph) => {
        if (alive) setState({ status: 'ready', graph })
      })
      .catch((error: unknown) => {
        if (alive) setState({ status: 'error', message: errorText(error) })
      })
    return () => {
      alive = false
    }
  }, [shotId, version])

  return state
}
