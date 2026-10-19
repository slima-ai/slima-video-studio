import type { z } from 'zod'

import type { UsageEstimate } from './models'
import { type PortType } from './workflow'

export interface InputSpec {
  type: PortType
  /** 可以不連線；沒連線時 run 收到的這個輸入是 undefined。 */
  optional?: boolean
}

/** 節點執行時可以取用的服務（供應商、素材庫…），由 apps/desktop 組裝後注入。 */
export type NodeServices = Record<string, unknown>

export interface RunContext<P = unknown> {
  /** 已經通過 Zod 驗證、套用預設值的參數。 */
  params: P
  /** 上游傳來的輸入，以輸入埠名稱為 key。 */
  inputs: Readonly<Record<string, unknown>>
  /** 這次執行的外部輸入（`$input` 節點讀取；一般節點用不到）。 */
  runInputs: Readonly<Record<string, unknown>>
  /** 這個節點選的模型（WorkflowNode.modelId）。 */
  modelId: string | undefined
  /** 取消訊號：長時間的工作要記得監聽。 */
  signal: AbortSignal
  /** 這次節點執行的編號（生成任務、花費帳本靠它對回是哪個節點做的）。 */
  nodeRunId: string
  services: NodeServices
  /**
   * 回報這個節點實際花掉的錢（寫入花費帳本）。優先填供應商回傳的金額；
   * 只有估算值時 estimated 設 true。節點沒回報、但有 estimateCost 時，引擎會自動以估算值入帳。
   */
  reportCost: (cost: ReportedCost) => void
  /** 以子 Run 的方式執行另一個工作流（「對每個鏡頭執行」用）。 */
  runSub: (
    body: unknown,
    runInputs: Record<string, unknown>,
    label: string,
  ) => Promise<SubRunResult>
}

export interface ReportedCost {
  provider: string
  modelId: string
  amountUsd: number
  estimated?: boolean
  jobId?: string
}

export interface SubRunResult {
  status: 'succeeded' | 'failed' | 'cancelled'
  /** `$output` 節點收到的值。 */
  result?: unknown
}

export interface NodeDefinition<P extends z.ZodType = z.ZodType> {
  /** 節點類型，例如 `llm.breakdown`。 */
  type: string
  /** 節點邏輯有變更時要升版，舊的快取就不會被誤用。 */
  version: number
  inputs: Readonly<Record<string, InputSpec>>
  outputs: Readonly<Record<string, PortType>>
  params: P
  /** 預估這個節點會花多少美金（沒有就當作 0）。 */
  estimateCost?: (ctx: {
    params: z.output<P>
    inputs: Readonly<Record<string, unknown>>
    /** 這個節點選的模型（WorkflowNode.modelId）。 */
    modelId: string | undefined
    /** 依 ModelCard 價格估算某個模型的花費；查不到模型就丟錯（該節點會被標為無法預估）。 */
    estimate: (modelId: string, usage: UsageEstimate) => number
  }) => number
  /** false 代表結果不能被快取（例如每次都要重新抽籤的節點）。預設 true。 */
  cacheable?: boolean
  /** 回傳各輸出埠的值（必須是 JSON 值）。 */
  run: (ctx: RunContext<z.output<P>>) => Promise<Record<string, unknown>> | Record<string, unknown>
}

/** 定義節點；只是為了型別推導，原樣回傳。 */
export function defineNode<P extends z.ZodType>(definition: NodeDefinition<P>): NodeDefinition<P> {
  return definition
}
