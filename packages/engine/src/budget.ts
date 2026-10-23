import {
  AppError,
  type Budget,
  type CostEntry,
  type UsageEstimate,
  type Workflow,
  t,
} from '@svs/schema'

import { FOR_EACH_NODE } from './builtin'
import type { NodeRegistry } from './node'

/** 花費帳本：引擎把每筆花費寫進來，並查專案累計。正式版接 SQLite（cost_ledger）；測試用 MemoryCostLedger。 */
export interface CostLedger {
  record: (entry: Omit<CostEntry, 'id' | 'createdAt'>) => CostEntry
  /** 這個專案到目前為止的累計花費（美金）。 */
  totalUsd: (projectId: string) => number
}

export class MemoryCostLedger implements CostLedger {
  readonly entries: CostEntry[] = []

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  record(entry: Omit<CostEntry, 'id' | 'createdAt'>): CostEntry {
    const full: CostEntry = { ...entry, id: this.newId(), createdAt: this.now().toISOString() }
    this.entries.push(full)
    return full
  }

  totalUsd(projectId: string): number {
    return this.entries
      .filter((e) => e.projectId === projectId)
      .reduce((s, e) => s + e.amountUsd, 0)
  }
}

/** 預設的預算：單次執行 US$5，專案不設上限。 */
export const DEFAULT_BUDGET: Budget = { perRunLimitUsd: 5 }

export interface BudgetExceeded {
  /** run：超過單次執行上限；project：超過專案總上限。 */
  scope: 'run' | 'project'
  limitUsd: number
  /** 執行下去預計會達到的金額。 */
  projectedUsd: number
}

/** 浮點數誤差容忍：剛好等於上限不算超過。 */
const EPSILON = 1e-9

/** 檢查預計花費有沒有超過上限。沒超過回傳 undefined。 */
export function checkBudget(args: {
  budget: Budget
  /** 這次執行預計花費（已花 + 進行中 + 即將開始）。 */
  runProjectedUsd: number
  /** 開始這次執行之前，專案已經花了多少。 */
  projectBaseUsd: number
}): BudgetExceeded | undefined {
  const { budget, runProjectedUsd, projectBaseUsd } = args
  if (runProjectedUsd > budget.perRunLimitUsd + EPSILON) {
    return { scope: 'run', limitUsd: budget.perRunLimitUsd, projectedUsd: runProjectedUsd }
  }
  const projectProjected = projectBaseUsd + runProjectedUsd
  if (budget.projectLimitUsd !== undefined && projectProjected > budget.projectLimitUsd + EPSILON) {
    return { scope: 'project', limitUsd: budget.projectLimitUsd, projectedUsd: projectProjected }
  }
  return undefined
}

const usd = (n: number): string => `US$${n.toFixed(2)}`

export function budgetExceededError(exceeded: BudgetExceeded): AppError {
  // 單次的上限在設定頁叫「單次花費上限」（設定 → 一般），訊息用同一個名字，使用者才找得到要調的那一張卡
  const over =
    exceeded.scope === 'run' ? t('errors.thePerRunSpendingLimit') : t('errors.theProjectLimit')
  const where =
    exceeded.scope === 'run'
      ? t('errors.raiseThePerRunSpending')
      : t('errors.raiseTheLimitInSettings')
  return new AppError({
    code: 'budget_exceeded',
    userMessage: t('errors.estimatedCostIsOverThen', {
      value: usd(exceeded.projectedUsd),
      over,
      value2: usd(exceeded.limitUsd),
      where,
    }),
  })
}

export interface CostEstimate {
  totalUsd: number
  /** 每個節點的預估（沒有 estimateCost 的節點是 0）。 */
  byNode: Record<string, number>
  /** 無法預估的節點（estimateCost 需要執行時才有的輸入，或「對每個項目執行」沒給項目數）。總額只是下限。 */
  uncertainNodeIds: string[]
}

/** 依模型 ID 與用量估算花費（正式版接 ModelRegistry.estimate）。 */
export type PriceLookup = (modelId: string, usage: UsageEstimate) => number

export const NO_PRICE_LOOKUP: PriceLookup = (modelId) => {
  throw new AppError({
    code: 'invalid_request',
    userMessage: t('errors.thereSNoPriceData', { modelId }),
  })
}

export interface EstimateOptions {
  priceLookup?: PriceLookup
  /** 「對每個項目執行」節點的項目數（節點 ID → 數量），用來乘上子工作流的花費。 */
  itemCounts?: Record<string, number>
}

/**
 * 執行前依各節點的 `estimateCost`（讀 ModelCard 價格）估算整張圖的花費。
 * 不考慮快取命中，所以是**上限**；實際執行時引擎會逐節點再檢查一次。
 */
export function estimateWorkflowCost(
  workflow: Workflow,
  registry: NodeRegistry,
  options: EstimateOptions = {},
): CostEstimate {
  const byNode: Record<string, number> = {}
  const uncertain: string[] = []
  let total = 0
  for (const node of workflow.nodes) {
    const def = registry.get(node.type)
    if (!def) continue
    let cost = 0
    try {
      const params = def.params.parse(node.params)
      if (def.type === FOR_EACH_NODE) {
        const body = (params as { body?: Workflow }).body
        const count = options.itemCounts?.[node.id]
        if (body && count !== undefined) {
          cost = estimateWorkflowCost(body, registry, options).totalUsd * count
        } else if (body) {
          uncertain.push(node.id)
        }
      } else if (def.estimateCost) {
        cost = def.estimateCost({
          params,
          inputs: {},
          modelId: node.modelId,
          estimate: options.priceLookup ?? NO_PRICE_LOOKUP,
        })
      }
    } catch {
      // 估算失敗（缺輸入、查不到價格）不擋執行，但要讓 UI 知道這個數字不完整
      uncertain.push(node.id)
    }
    byNode[node.id] = cost
    total += cost
  }
  return { totalUsd: total, byNode, uncertainNodeIds: uncertain }
}
