import type { IpcEventName } from '@svs/schema'
import { useEffect, useState } from 'react'

import { useHistory } from './history'

/**
 * 資料版本：這幾個變更事件來了、或復原／重做之後就變一個新的數字。
 * 放進讀資料的 effect 相依裡，別的頁面（例如畫布的浮動面板）改了資料，這一頁也跟著重新讀。
 */
export function useDataVersion(events: readonly IpcEventName[]): number {
  const [version, setVersion] = useState(0)
  const { revision } = useHistory()
  const key = events.join('|')
  useEffect(() => {
    const offs = key.split('|').map((event) =>
      window.svs.on(event as IpcEventName, () => {
        setVersion((v) => v + 1)
      }),
    )
    return () => {
      for (const off of offs) off()
    }
  }, [key])
  // 兩個都只會往上加，加起來也只會往上加：任何一個變了，總和就跟之前不一樣
  return version + revision
}
