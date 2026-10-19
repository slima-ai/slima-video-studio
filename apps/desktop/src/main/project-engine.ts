import type { ProjectHandle } from '@svs/db'
import { Engine, type EngineDeps } from '@svs/engine'

import { SHOT_NODE } from './quickstart/progress-tracker'

/** 快速開始節點編號 each[2]/image 裡的鏡頭序號 → 「第 3 鏡」。 */
export function shotLabelOfNode(nodeId: string): string | undefined {
  const match = SHOT_NODE.exec(nodeId)
  return match?.[1] === undefined ? undefined : `第 ${String(Number(match[1]) + 1)} 鏡`
}

/**
 * 節點開始執行時就記下「節點執行紀錄 → 這是第幾鏡」。引擎要等節點跑完才寫進資料庫，
 * 但生成佇列在節點還在跑的時候就要標出這個任務屬於哪一鏡，所以另外在記憶體裡留一份。
 */
const stepLabels = new WeakMap<ProjectHandle, Map<string, string>>()

/** 這個節點執行紀錄對到的步驟名稱（例如「第 3 鏡」）；不是鏡頭的步驟或還沒開始就是 undefined。 */
export function stepLabelOfRun(handle: ProjectHandle, nodeRunId: string): string | undefined {
  return stepLabels.get(handle)?.get(nodeRunId)
}

export interface ProjectEngineOptions {
  /** 這個引擎跑的所有節點都屬於哪一鏡（單鏡頭重新生成用；快速開始靠節點編號就能認出來）。 */
  stepLabel?: string
}

/** 把專案資料庫接成執行引擎的 RunStore 與花費帳本：快取與花費都跟著專案資料夾走。 */
export function createProjectEngine(
  handle: ProjectHandle,
  deps: Omit<EngineDeps, 'store' | 'ledger'> = {},
  options: ProjectEngineOptions = {},
): Engine {
  const { runs, costs } = handle.repos
  const index = stepLabels.get(handle) ?? new Map<string, string>()
  stepLabels.set(handle, index)
  return new Engine({
    ...deps,
    onEvent: (event) => {
      if (event.type === 'node-started') {
        const label = options.stepLabel ?? shotLabelOfNode(event.nodeId)
        if (label !== undefined) index.set(event.nodeRunId, label)
      }
      deps.onEvent?.(event)
    },
    // 專案被關閉之後，還在收尾的工作（已取消的執行）不能再碰資料庫：一律略過寫入
    store: {
      findSucceeded: (key) => (handle.closed ? undefined : runs.findSucceeded(key)),
      saveRun: (run) => {
        if (!handle.closed) runs.saveRun(run)
      },
      saveNodeRun: (nodeRun) => {
        if (!handle.closed) runs.saveNodeRun(nodeRun)
      },
    },
    ledger: {
      record: (entry) =>
        handle.closed
          ? { ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
          : costs.record(entry),
      totalUsd: (projectId) => (handle.closed ? 0 : costs.totalUsd(projectId)),
    },
  })
}
