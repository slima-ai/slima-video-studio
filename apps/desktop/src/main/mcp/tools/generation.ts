import { z } from 'zod'

import { defineTool, type ToolContext } from './define'

const ACTIVE = new Set(['queued', 'running', 'submitted', 'polling'])
/** 查詢間隔從 POLL_MIN_MS 起、每次加倍，最長 POLL_MS：很快就好的生成馬上回報，長的生成不會一直查。 */
const POLL_MIN_MS = 100
const POLL_MS = 1500
/** 一次最多等這麼久：MCP 客戶端的單次工具呼叫有逾時，所以分段等、沒好就再叫一次。 */
export const MAX_WAIT_SEC = 45

/** 目前專案最近的生成任務摘要。 */
async function status(ctx: ToolContext) {
  const { jobs } = await ctx.caller.call('queue.list', {})
  const active = jobs.filter((j) => ACTIVE.has(j.status))
  const recent = jobs.slice(-12).map((j) => ({
    kind: j.kind,
    model: j.modelId,
    status: j.status,
    ...(j.stepLabel === undefined ? {} : { step: j.stepLabel }),
    ...(j.costUsd === undefined ? {} : { costUsd: j.costUsd }),
    ...(j.error === undefined
      ? {}
      : { problem: j.error.userMessage, retryable: j.error.retryable }),
  }))
  return {
    busy: active.length > 0,
    running: active.length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    recent,
  }
}

export function registerGenerationTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'get_generation_status',
    title: 'Is anything still generating',
    description:
      'The generation queue of the current project: whether anything is still running, how many jobs failed, and the last 12 jobs (kind, model, status, cost, plain-language problem if any).',
    input: {},
    hints: { readOnly: true },
    run: () => status(ctx),
  })

  defineTool(ctx, {
    name: 'wait_for_generation',
    title: 'Wait until generation finishes',
    description:
      'Wait (up to maxSeconds, at most ' +
      String(MAX_WAIT_SEC) +
      ') until nothing is generating any more, then return the same summary as get_generation_status plus finished=true/false. Generation can take minutes: if finished is false, call this again. Costs nothing.',
    input: {
      maxSeconds: z
        .number()
        .int()
        .min(1)
        .max(MAX_WAIT_SEC)
        .default(30)
        .describe('How long to wait at most'),
    },
    hints: { readOnly: true },
    run: async ({ maxSeconds }) => {
      const deadline = Date.now() + maxSeconds * 1000
      let current = await status(ctx)
      for (
        let wait = POLL_MIN_MS;
        current.busy && Date.now() < deadline;
        wait = Math.min(wait * 2, POLL_MS)
      ) {
        await new Promise((resolve) => setTimeout(resolve, wait))
        current = await status(ctx)
      }
      return { finished: !current.busy, ...current }
    },
  })
}
