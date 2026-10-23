import { McpToolError } from '../bridge'
import type { ToolContext } from './define'

/**
 * 文字模型是推理模型時，實際費用常是預估的好幾倍（輸出 token 含推理）。預留時乘上這個係數，
 * 寧可多預留一點；做完之後會改成實際花的，多預留的部分退回（見 settleAllowance）。
 */
export const TEXT_RESERVE_FACTOR = 2

/** 不到一分錢的金額多顯示一位，才不會把 US$0.002 寫成 US$0.00。 */
const usd = (value: number): string =>
  `US$${value > 0 && value < 0.01 ? value.toFixed(3) : value.toFixed(2)}`

/**
 * 花錢的工具在真的呼叫 AI 模型之前，先向「AI 工具額度」預留預估金額。
 * 示範模式不花真錢，直接放行。額度不夠就丟白話錯誤：說清楚預估多少、還剩多少、誰能調高（只有人）。
 * 呼叫端要先問過 App 自己的檢查（預估金額、單次與專案的花費上限）再來這裡。
 */
export function reserveSpending(
  ctx: ToolContext,
  what: string,
  estimatedUsd: number,
  factor: number = TEXT_RESERVE_FACTOR,
): { reservedUsd: number; remainingUsd: number } {
  const reservedUsd = estimatedUsd * factor
  const result = ctx.allowance.reserve(reservedUsd)
  if (!result.ok) {
    throw new McpToolError(
      `「${what}」預估要花 ${usd(estimatedUsd)}（預留 ${usd(reservedUsd)}），但 AI 工具的總額度只剩 ${usd(result.remainingUsd)}（總額度 ${usd(result.allowanceUsd)}）。` +
        '要繼續，請使用者到 App 的「設定 → AI 工具連線」，把「AI 工具的總額度」調高；這個額度只有人能改，你不能改，也不要想辦法繞過。',
      'allowance_exceeded',
    )
  }
  // 示範模式不預留任何金額，回報也是 0
  return {
    reservedUsd: ctx.settings.get().demoMode ? 0 : reservedUsd,
    remainingUsd: result.remainingUsd,
  }
}
