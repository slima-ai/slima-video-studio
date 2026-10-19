import { useEffect } from 'react'

import { useToast } from '../../components/toast'
import { call } from '../../lib/svs'

/**
 * 模型通知（例如選的模型下架、自動換成別的）：App 一打開、或主行程說有新的通知時，
 * 取走並用提示說一次，附「到設定」。不畫任何東西。
 */
export function ModelNotices({ onOpenSettings }: { onOpenSettings: () => void }) {
  const toast = useToast()
  useEffect(() => {
    let alive = true
    const take = (): void => {
      call('models.notices', {})
        .then(({ notices }) => {
          if (!alive) return
          notices.forEach((message, index) => {
            toast.show({
              key: `model-notice-${String(index)}`,
              message,
              action: { label: '到設定', onAction: onOpenSettings },
            })
          })
        })
        .catch(() => undefined)
    }
    take()
    const off = window.svs.on('models.noticed', take)
    return () => {
      alive = false
      off()
    }
  }, [onOpenSettings, toast])
  return null
}
