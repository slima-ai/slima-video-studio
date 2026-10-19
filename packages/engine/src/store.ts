import type { NodeRun, Run } from '@svs/schema'

/** 引擎寫入 Run / NodeRun、並查詢快取的地方。正式版由 apps/desktop 接上 SQLite；測試用 MemoryRunStore。 */
export interface RunStore {
  /** 找同一個快取鍵、成功（或沿用快取）過的 NodeRun，沒有就回傳 undefined。 */
  findSucceeded: (cacheKey: string) => NodeRun | undefined
  saveRun: (run: Run) => void
  saveNodeRun: (nodeRun: NodeRun) => void
}

export class MemoryRunStore implements RunStore {
  readonly runs = new Map<string, Run>()
  readonly nodeRuns = new Map<string, NodeRun>()
  private readonly cache = new Map<string, NodeRun>()

  findSucceeded(cacheKey: string): NodeRun | undefined {
    return this.cache.get(cacheKey)
  }

  saveRun(run: Run): void {
    this.runs.set(run.id, structuredClone(run))
  }

  saveNodeRun(nodeRun: NodeRun): void {
    this.nodeRuns.set(nodeRun.id, structuredClone(nodeRun))
    // 只有真正執行成功的結果可以當快取來源（沿用快取的不重複登錄）
    if (nodeRun.status === 'succeeded' && !this.cache.has(nodeRun.cacheKey)) {
      this.cache.set(nodeRun.cacheKey, structuredClone(nodeRun))
    }
  }
}
