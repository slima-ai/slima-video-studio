import type { Allowance } from '../allowance'
import type { McpCaller } from '../bridge'

/** 這些狀態的任務還沒做完。 */
export const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'submitted',
  'polling',
])

/**
 * 佇列空了就把還沒結算的預留改成實際花的（帳本）、多的退回。每個工具呼叫前都會呼叫：
 * 背景生成沒有「做完」的通知，所以下一次有人（AI）碰到工具時才結算；失敗不影響工具本身。
 */
export async function settleAllowance(ctx: {
  allowance: Allowance
  caller: McpCaller
}): Promise<void> {
  try {
    if (!ctx.allowance.hasOpen()) return
    const { jobs } = await ctx.caller.call('queue.list', {})
    if (jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) return
    ctx.allowance.settle()
  } catch {
    // 結算不了就維持預留（保守）；下一次再試
  }
}
