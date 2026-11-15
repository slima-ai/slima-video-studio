import { useEffect, useState } from 'react'

import { call } from '../../lib/svs'

/**
 * 「全部生成」接好片之後，旁白與配樂是不是還在加。加好之前成品是沒有聲音的（匯出會拿到全靜音的檔），
 * 所以成品面板在這段時間不讓匯出。一打開面板就問一次（可能已經在加了），之後聽主程序的通知。
 */
export function useSoundAdding(): boolean {
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    let alive = true
    call('canvas.soundAdding', {})
      .then((state) => {
        if (alive) setAdding(state.adding)
      })
      .catch(() => undefined)
    const off = window.svs.on('canvas.soundAddingChanged', (state) => {
      setAdding(state.adding)
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return adding
}
