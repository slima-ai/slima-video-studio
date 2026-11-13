import { z } from 'zod'

import { McpToolError } from '../bridge'
import { defineTool, type ToolContext } from './define'
import { ACTIVE_JOB_STATUSES } from './settle'

/** 查詢間隔從 POLL_MIN_MS 起、每次加倍，最長 POLL_MS：很快就好的生成馬上回報，長的生成不會一直查。 */
const POLL_MIN_MS = 100
const POLL_MS = 1500
/** 一次最多等這麼久：MCP 客戶端的單次工具呼叫有逾時，所以分段等、沒好就再叫一次。 */
export const MAX_WAIT_SEC = 45

/** 同一鏡停在同一步超過這麼久還沒完成：提醒 AI 去查原因，不要一直等（一支影片通常幾分鐘內就好）。 */
const STUCK_AFTER_MS = 10 * 60 * 1000

interface WorkingShot {
  number: number
  step: string
}

/**
 * 某一鏡停在某一步，最早是什麼時候被看到的（跨好幾次 wait_for_generation 呼叫）。
 * AI 工具一個請求一個請求來、每個請求各有一份 ToolContext，所以以整個 App 共用的 caller 當鑰匙。
 */
const firstSeen = new WeakMap<ToolContext['caller'], Map<string, number>>()

/**
 * 還在做的鏡頭（第幾鏡、哪一步）：一鏡的生成是一串步驟，每一步才各自進佇列，步驟之間佇列是空的，
 * 但那一鏡還沒做完（剛按下去、機器忙時最明顯）。只看佇列會提早說「做完了」。
 * 這個標示只存在 App 的記憶體裡，每一串生成結束（成功、失敗、被取消）都會清掉，換專案或重開 App 一開始就是空的，
 * 不會留下孤兒。沒開專案、查不到鏡頭時當作沒有（只看佇列）。
 */
async function shotsInProgress(ctx: ToolContext): Promise<WorkingShot[]> {
  try {
    const { shots } = await ctx.caller.call('shots.list', {})
    return shots.flatMap((s) => (s.activity ? [{ number: s.number, step: s.activity.step }] : []))
  } catch (error) {
    if (error instanceof McpToolError) return []
    throw error
  }
}

/** 有鏡頭停在同一步太久：一句 AI 看得懂、知道下一步怎麼做的話。 */
function stuckNote(ctx: ToolContext, working: readonly WorkingShot[]): string | undefined {
  const seen = firstSeen.get(ctx.caller) ?? new Map<string, number>()
  firstSeen.set(ctx.caller, seen)
  const now = Date.now()
  const keys = new Set(working.map((w) => `${String(w.number)}:${w.step}`))
  for (const key of seen.keys()) if (!keys.has(key)) seen.delete(key)
  const stuck: string[] = []
  for (const w of working) {
    const key = `${String(w.number)}:${w.step}`
    const since = seen.get(key) ?? now
    seen.set(key, since)
    if (now - since >= STUCK_AFTER_MS) {
      stuck.push(
        `shot ${String(w.number)} (step ${w.step}, ${String(Math.round((now - since) / 60_000))} minutes)`,
      )
    }
  }
  if (stuck.length === 0) return undefined
  return `Waiting a long time on ${stuck.join(', ')}. That is longer than a generation normally takes: check get_shot (it shows a problem if something failed), and if nothing is wrong, cancel_generation and redo the shot with regenerate_shot instead of waiting more.`
}

/** 目前專案最近的生成任務摘要。 */
async function status(ctx: ToolContext) {
  const { jobs } = await ctx.caller.call('queue.list', {})
  const active = jobs.filter((j) => ACTIVE_JOB_STATUSES.has(j.status))
  const working = await shotsInProgress(ctx)
  const note = stuckNote(ctx, working)
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
    busy: active.length > 0 || working.length > 0,
    running: active.length,
    ...(working.length > 0 ? { shotsInProgress: working.map((w) => w.number) } : {}),
    ...(note === undefined ? {} : { note }),
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
