import type { SoundPlan } from '@svs/schema'

import { t } from '@svs/schema'

/** 預估金額：有最壞情況（旁白可能改短重念）時寫成範圍「US$a～b」，不加說明。 */
export function planUsd(plan: SoundPlan, format: (usd: number) => string): string {
  if (plan.maxUsd === undefined) return format(plan.totalUsd)
  return t('sound.range', {
    from: format(plan.totalUsd),
    to: format(plan.maxUsd).replace('US$', ''),
  })
}
