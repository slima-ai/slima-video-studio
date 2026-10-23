import { budgetExceededError, type EngineEvent } from '@svs/engine'
import {
  AssetRefSchema,
  type NodeRun,
  type QuickStartProgress,
  type ShotProgress,
  t,
} from '@svs/schema'
import { z } from 'zod'

/** 快速開始裡「第幾個鏡頭的哪一步」的節點編號，例如 each[3]/image。 */
export const SHOT_NODE = /^each\[(\d+)\]\/(prompt|image|video)$/
const BreakdownOutputSchema = z.object({
  shots: z.array(z.object({ description: z.string().optional() })),
  title: z.string().optional(),
})
const ImageOutputSchema = z.object({ image: AssetRefSchema })
const VideoOutputSchema = z.object({ video: AssetRefSchema })

const isDone = (run: NodeRun): boolean => run.status === 'succeeded' || run.status === 'cached'

/**
 * 把引擎事件整理成畫面要的進度。引擎的節點編號是 `breakdown`、`each[3]/image`、`join` 這種形式，
 * 這裡依編號對應到「第幾個鏡頭做到哪一步」。每個鏡頭的步驟是 組 Prompt → 首幀圖 → 影片。
 */
export class ProgressTracker {
  private state: QuickStartProgress | undefined

  /** 目前的進度快照（還沒開始就是 undefined）。 */
  snapshot(): QuickStartProgress | undefined {
    return this.state
  }

  /** 帶入匯出位置等引擎不知道的資訊。 */
  patch(patch: Partial<Pick<QuickStartProgress, 'exportedPath'>>): QuickStartProgress | undefined {
    if (this.state) this.state = { ...this.state, ...patch }
    return this.state
  }

  /** 影片接好了，開始加旁白與配樂（狀態仍是進行中，畫布一直顯示生成中）。 */
  startSound(text?: string): QuickStartProgress | undefined {
    return this.update({ phase: 'sound', ...(text === undefined ? {} : { soundStart: text }) })
  }

  /** 加聲音做完：成品換成混好的那一版；沒加成功就記下來（完成訊息會說）。 */
  finishSound(result: {
    finalVideoHash?: string
    failed: boolean
    /** 加完聲音那一句（沒加成功時不會有）。 */
    done?: string
  }): QuickStartProgress | undefined {
    if (!this.state) return undefined
    const next = {
      ...this.state,
      ...(result.finalVideoHash === undefined ? {} : { finalVideoHash: result.finalVideoHash }),
      ...(result.failed ? { soundFailed: true } : {}),
      ...(result.done === undefined ? {} : { soundDone: result.done }),
    }
    this.state = next
    return this.state
  }

  /** 重新接片之後換成新的成品；之前匯出的檔案是舊的影片，所以清掉匯出位置。 */
  setFinalVideo(hash: string): QuickStartProgress | undefined {
    if (!this.state) return undefined
    const next = { ...this.state, finalVideoHash: hash }
    delete next.exportedPath
    this.state = next
    return this.state
  }

  /** 執行開始前就失敗（預估花費超過上限、工作流無效…）。 */
  fail(runId: string, error: { userMessage: string; retryable: boolean }): QuickStartProgress {
    this.state = {
      runId,
      status: 'failed',
      phase: 'breakdown',
      shots: [],
      costUsd: 0,
      error,
    }
    return this.state
  }

  /** 回傳新的快照；事件跟進度無關時回傳 undefined。 */
  handle(event: EngineEvent): QuickStartProgress | undefined {
    switch (event.type) {
      case 'run-started':
        this.state = {
          runId: event.runId,
          status: 'running',
          phase: 'breakdown',
          shots: [],
          costUsd: 0,
        }
        return this.state
      case 'node-started':
        return this.onNodeStarted(event.nodeId)
      case 'node-finished':
        return this.onNodeFinished(event.nodeId, event.nodeRun)
      case 'cost-recorded':
        return this.update({ costUsd: (this.state?.costUsd ?? 0) + event.entry.amountUsd })
      case 'budget-exceeded':
        return this.update({
          error: { userMessage: budgetExceededError(event).userMessage, retryable: false },
        })
      case 'run-finished': {
        const status = event.status === 'succeeded' ? 'succeeded' : 'failed'
        const final = this.state
        return this.update({
          status: event.status === 'cancelled' ? 'cancelled' : status,
          phase: status === 'succeeded' ? 'done' : (final?.phase ?? 'done'),
        })
      }
    }
  }

  private update(patch: Partial<QuickStartProgress>): QuickStartProgress | undefined {
    if (!this.state) return undefined
    this.state = { ...this.state, ...patch }
    return this.state
  }

  private setShot(index: number, patch: Partial<ShotProgress>): QuickStartProgress | undefined {
    if (!this.state) return undefined
    const shots = [...this.state.shots]
    for (let i = shots.length; i <= index; i++) shots.push({ index: i, step: 'waiting' })
    const current = shots[index] ?? { index, step: 'waiting' as const }
    shots[index] = { ...current, ...patch }
    return this.update({ shots, phase: 'shots' })
  }

  private onNodeStarted(nodeId: string): QuickStartProgress | undefined {
    const match = SHOT_NODE.exec(nodeId)
    if (match) {
      const step = match[2] as 'prompt' | 'image' | 'video'
      return this.setShot(Number(match[1]), { step })
    }
    if (nodeId === 'join') return this.update({ phase: 'join' })
    return undefined
  }

  private onNodeFinished(nodeId: string, run: NodeRun): QuickStartProgress | undefined {
    const fail = (): { userMessage: string; retryable: boolean } => ({
      userMessage: run.error?.userMessage ?? t('services.thisStepDidnTSucceed'),
      retryable: run.error?.retryable ?? false,
    })

    if (nodeId === 'breakdown') {
      if (!isDone(run)) return this.update({ error: fail() })
      const parsed = BreakdownOutputSchema.safeParse(run.output)
      if (!parsed.success) return undefined
      return this.update({
        phase: 'shots',
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
        shots: parsed.data.shots.map((shot, index) => ({
          index,
          step: 'waiting' as const,
          ...(shot.description ? { description: shot.description } : {}),
        })),
      })
    }

    const match = SHOT_NODE.exec(nodeId)
    if (match) {
      const index = Number(match[1])
      const kind = match[2]
      if (!isDone(run)) {
        // 只有真的失敗才標紅；取消、因上游失敗而沒做的鏡頭維持原狀
        return run.status === 'failed'
          ? this.setShot(index, { step: 'failed', error: fail().userMessage })
          : undefined
      }
      if (kind === 'image') {
        const out = ImageOutputSchema.safeParse(run.output)
        return out.success ? this.setShot(index, { imageHash: out.data.image.hash }) : undefined
      }
      if (kind === 'video') {
        const out = VideoOutputSchema.safeParse(run.output)
        return out.success
          ? this.setShot(index, { step: 'done', videoHash: out.data.video.hash })
          : undefined
      }
      return undefined
    }

    if (nodeId === 'join') {
      if (!isDone(run)) return run.status === 'failed' ? this.update({ error: fail() }) : undefined
      const out = VideoOutputSchema.safeParse(run.output)
      return out.success ? this.update({ finalVideoHash: out.data.video.hash }) : undefined
    }
    return undefined
  }
}
