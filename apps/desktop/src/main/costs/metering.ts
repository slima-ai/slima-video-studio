import type { ProjectHandle } from '@svs/db'
import { tapGenerateCost, type CostTap, type StudioServices } from '@svs/workflows'

import type { AppSpendLedger } from './app-ledger'

/** 一次呼叫「回來了、有金額」的紀錄（錢已經花了，不管後面成不成功）。 */
export type SpentCall = CostTap

/** 包一層：每次 `generate` 回來、金額大於 0，就先記在 `spent` 裡，之後用 `bookSpent` 入帳。 */
export function meteredStudio(studio: StudioServices, spent: SpentCall[]): StudioServices {
  return tapGenerateCost(studio, (call) => {
    if (call.amountUsd > 0) spent.push(call)
  })
}

/**
 * 把記下來的呼叫記進花費帳本：專案還開著就記在專案的帳本上；專案已經關掉（或被刪掉）就記在 App 層的帳，
 * 錢不會跟著專案消失。記完清空，所以可以在 finally 裡放心呼叫、不會重複記。
 */
export function bookSpent(
  handle: ProjectHandle,
  appLedger: AppSpendLedger | undefined,
  spent: SpentCall[],
  reason: string,
  gone = false,
): void {
  const calls = spent.splice(0)
  for (const call of calls) {
    if (!gone && !handle.closed) {
      handle.repos.costs.record({
        projectId: handle.projectId,
        provider: call.provider,
        modelId: call.modelId,
        amountUsd: call.amountUsd,
        estimated: false,
        jobId: call.jobId,
      })
    } else {
      appLedger?.record({
        provider: call.provider,
        modelId: call.modelId,
        amountUsd: call.amountUsd,
        jobId: call.jobId,
        reason,
      })
    }
  }
}
