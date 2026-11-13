import { t } from '@svs/schema'
import { useEffect } from 'react'

import { useToast } from '../../components/toast'
import { call } from '../../lib/svs'

/** 金額小的時候多顯示幾位，不然 0.004 會顯示成 0.00。 */
const usdText = (usd: number): string => usd.toFixed(usd < 0.1 ? 3 : 2)

/**
 * 補記了先前漏記的花費：App 一打開、或主行程說有新的提示時取走，用提示說一次，附「看明細」到生成紀錄。
 * 這句跟錢有關，所以留著；取走就清掉，不會重複出現。不畫任何東西。
 */
export function CostReconcileNotice({ onOpenRecords }: { onOpenRecords: () => void }) {
  const toast = useToast()
  useEffect(() => {
    let alive = true
    const take = (): void => {
      call('costs.reconcileNotice', {})
        .then(({ notice }) => {
          if (!alive || !notice) return
          toast.show({
            key: 'cost-reconciled',
            message: t('records.reconciledNotice', { usd: usdText(notice.usd) }),
            action: { label: t('records.seeDetails'), onAction: onOpenRecords },
          })
        })
        .catch(() => undefined)
    }
    take()
    const off = window.svs.on('costs.reconciled', take)
    return () => {
      alive = false
      off()
    }
  }, [onOpenRecords, toast])
  return null
}
