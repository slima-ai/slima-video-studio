import { useEffect, useRef } from 'react'

import { LONG_TOAST_MS, useToast } from '../../components/toast'
import { useHistory } from '../../lib/history'
import { call, errorText } from '../../lib/svs'
import { t } from '@svs/schema'

export interface RemoveTarget {
  kind: 'narration' | 'music'
  /** 旁白只刪這一鏡的；不給就是全部鏡頭的旁白。 */
  shotId?: string
}

/**
 * 刪掉旁白或配樂：不跳確認框，直接刪，提示寫清楚後果並附「復原」（跟畫布上刪東西一樣）。
 * 刪完成品的聲音變成過期，所以自動重混（不花錢）；復原之後也是：頁面看到歷史的 revision 變了，
 * 就重新讀一次，過期就重混，成品才會跟著回到有聲音的樣子。
 */
export function useRemoveSound(options: {
  reload: () => void
  scheduleMix: () => void
  onError: (message: string) => void
}): (target: RemoveTarget, message: string) => void {
  const toast = useToast()
  const history = useHistory()
  const latest = useRef(options)
  latest.current = options

  const remove = (target: RemoveTarget, message: string): void => {
    call('sound.remove', {
      kind: target.kind,
      ...(target.shotId === undefined ? {} : { shotId: target.shotId }),
    })
      .then(() => {
        latest.current.reload()
        latest.current.scheduleMix()
        toast.show({
          key: 'sound-delete',
          message,
          action: { label: t('sound.undo'), onAction: history.undo },
          ms: LONG_TOAST_MS,
        })
      })
      .catch((e: unknown) => {
        latest.current.onError(errorText(e))
      })
  }

  // 復原或重做之後（revision 變了）：聲音可能跟成品對不上，對不上就重混
  const revision = useRef(history.revision)
  useEffect(() => {
    if (revision.current === history.revision) return
    revision.current = history.revision
    call('sound.get', {})
      .then((next) => {
        latest.current.reload()
        if (next.final?.soundStale) latest.current.scheduleMix()
      })
      .catch(() => undefined)
  }, [history.revision])

  return remove
}
