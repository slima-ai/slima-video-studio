import {
  AppError,
  isAppError,
  type AppErrorShape,
  type Budget,
  type CostEntry,
  type NodeRun,
  type Run,
  type Workflow,
  type WorkflowEdge,
  type WorkflowNode,
  t,
} from '@svs/schema'
import { randomUUID } from 'node:crypto'

import {
  DEFAULT_BUDGET,
  MemoryCostLedger,
  budgetExceededError,
  checkBudget,
  estimateWorkflowCost,
  type BudgetExceeded,
  type CostLedger,
  NO_PRICE_LOOKUP,
  type EstimateOptions,
  type PriceLookup,
} from './budget'
import { FOR_EACH_NODE, OUTPUT_NODE, createRegistry } from './builtin'
import { WorkflowValidationError, topologicalOrder, validateWorkflow } from './graph'
import { hashValue } from './hash'
import {
  type NodeDefinition,
  type NodeRegistry,
  type NodeServices,
  type ReportedCost,
  type SubRunResult,
} from './node'
import { MemoryRunStore, type RunStore } from './store'

export type EngineEvent =
  | { type: 'run-started'; runId: string }
  | { type: 'node-started'; runId: string; nodeId: string; nodeRunId: string }
  | { type: 'node-finished'; runId: string; nodeId: string; nodeRun: NodeRun }
  | { type: 'run-finished'; runId: string; status: Run['status'] }
  /** 預估或執行中發現會超過預算。runId 為 null 代表執行前的預估就超過，整個執行沒有開始。 */
  | ({ type: 'budget-exceeded'; runId: string | null } & BudgetExceeded)
  | { type: 'cost-recorded'; runId: string; entry: CostEntry }

export interface EngineDeps {
  registry?: NodeRegistry
  store?: RunStore
  /** 花費帳本。沒給就用記憶體版（花費不會保存）。 */
  ledger?: CostLedger
  /** 依 ModelCard 價格估算花費（節點的 estimateCost 用）。沒給時需要價格的節點會被標為無法預估。 */
  priceLookup?: PriceLookup
  services?: NodeServices
  /** 同時執行的節點上限（預設不限，實際上受相依關係限制）。 */
  maxConcurrency?: number
  now?: () => Date
  newId?: () => string
  onEvent?: (event: EngineEvent) => void
}

export interface RunOptions {
  projectId?: string
  signal?: AbortSignal
  /** 外部輸入，`$input` 節點讀取。 */
  inputs?: Record<string, unknown>
  /** 預算上限；沒給就是單次執行 US$5、專案不限。 */
  budget?: Budget
  /** 預估花費時「對每個項目執行」節點的項目數（節點 ID → 數量）。 */
  itemCounts?: EstimateOptions['itemCounts']
}

export interface RunResult {
  run: Run
  nodeRuns: NodeRun[]
  /** 每個節點的輸出（只有成功或沿用快取的節點）。 */
  outputs: ReadonlyMap<string, Readonly<Record<string, unknown>>>
  /** 執行中因為預算上限而停下來時填入；調高上限後重新執行會從停下的地方繼續（已完成的節點走快取）。 */
  budgetExceeded?: BudgetExceeded
}

/** 一次執行的花費狀態（頂層與所有子 Run 共用）。 */
interface RunBudget {
  budget: Budget
  projectId: string
  /** 開始執行前，專案已經花的錢。 */
  projectBaseUsd: number
  /** 已入帳的花費。 */
  actualUsd: number
  /** 進行中節點的預估花費。 */
  reservedUsd: number
  exceeded?: BudgetExceeded
}

class Semaphore {
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active++
    try {
      return await task()
    } finally {
      this.active--
      this.waiting.shift()?.()
    }
  }
}

const toShape = (error: unknown): AppErrorShape => {
  if (isAppError(error)) return error.toShape()
  return new AppError({
    code: 'node_failed',
    userMessage: t('errors.thisStepFailed'),
    cause: error,
  }).toShape()
}

/** 工作流執行引擎。同一個 Engine 可以重複執行多個工作流，快取由 store 共用。 */
export class Engine {
  readonly registry: NodeRegistry
  readonly store: RunStore
  readonly ledger: CostLedger
  private readonly budgets = new Map<string, RunBudget>()
  private readonly priceLookup: PriceLookup
  private readonly services: NodeServices
  private readonly now: () => Date
  private readonly newId: () => string
  private readonly onEvent: (event: EngineEvent) => void
  private readonly semaphore: Semaphore

  constructor(deps: EngineDeps = {}) {
    this.registry = deps.registry ?? createRegistry()
    this.store = deps.store ?? new MemoryRunStore()
    this.ledger = deps.ledger ?? new MemoryCostLedger()
    this.priceLookup = deps.priceLookup ?? NO_PRICE_LOOKUP
    this.services = deps.services ?? {}
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? randomUUID
    this.onEvent = deps.onEvent ?? (() => undefined)
    this.semaphore = new Semaphore(deps.maxConcurrency ?? Number.POSITIVE_INFINITY)
  }

  /** 執行前先驗證（有環、型別不符的連線等會丟 WorkflowValidationError），再依相依順序平行執行。 */
  async run(workflow: Workflow, options: RunOptions = {}): Promise<RunResult> {
    const issues = validateWorkflow(workflow, this.registry)
    if (issues.length > 0) throw new WorkflowValidationError(issues)

    // 執行前先用 ModelCard 價格估算：超過上限就一個任務都不送
    const projectId = options.projectId ?? 'local'
    const budget = options.budget ?? DEFAULT_BUDGET
    const estimate = estimateWorkflowCost(workflow, this.registry, {
      priceLookup: this.priceLookup,
      ...(options.itemCounts ? { itemCounts: options.itemCounts } : {}),
    })
    const projectBaseUsd = this.ledger.totalUsd(projectId)
    const tooExpensive = checkBudget({
      budget,
      runProjectedUsd: estimate.totalUsd,
      projectBaseUsd,
    })
    if (tooExpensive) {
      this.onEvent({ type: 'budget-exceeded', runId: null, ...tooExpensive })
      throw budgetExceededError(tooExpensive)
    }

    const startedAt = this.now().toISOString()
    const run: Run = {
      id: this.newId(),
      projectId,
      workflowId: workflow.id,
      status: 'running',
      estimatedCostUsd: estimate.totalUsd,
      actualCostUsd: 0,
      startedAt,
      createdAt: startedAt,
    }
    this.store.saveRun(run)
    const runBudget: RunBudget = { budget, projectId, projectBaseUsd, actualUsd: 0, reservedUsd: 0 }
    this.budgets.set(run.id, runBudget)
    this.onEvent({ type: 'run-started', runId: run.id })

    const signal = options.signal ?? new AbortController().signal
    const nodeRuns: NodeRun[] = []
    const { outputs, status } = await this.execute(
      workflow,
      run.id,
      signal,
      options.inputs ?? {},
      nodeRuns,
      undefined,
      '',
    )

    const finished: Run = {
      ...run,
      status:
        status === 'succeeded' ? 'succeeded' : status === 'cancelled' ? 'cancelled' : 'failed',
      actualCostUsd: runBudget.actualUsd,
      finishedAt: this.now().toISOString(),
    }
    this.budgets.delete(run.id)
    this.store.saveRun(finished)
    this.onEvent({ type: 'run-finished', runId: run.id, status: finished.status })
    return {
      run: finished,
      nodeRuns,
      outputs,
      ...(runBudget.exceeded ? { budgetExceeded: runBudget.exceeded } : {}),
    }
  }

  /** 執行一張圖（頂層或子工作流），回傳整體狀態與各節點輸出。 */
  private async execute(
    workflow: Workflow,
    runId: string,
    signal: AbortSignal,
    runInputs: Record<string, unknown>,
    nodeRuns: NodeRun[],
    parentNodeRunId: string | undefined,
    idPrefix: string,
  ): Promise<{ status: SubRunResult['status']; outputs: Map<string, Record<string, unknown>> }> {
    const nodes = new Map(workflow.nodes.map((n) => [n.id, n]))
    const incoming = new Map<string, WorkflowEdge[]>()
    for (const edge of workflow.edges) {
      incoming.set(edge.to.nodeId, [...(incoming.get(edge.to.nodeId) ?? []), edge])
    }
    const outputs = new Map<string, Record<string, unknown>>()
    const finished = new Map<string, NodeRun>()

    // 每個節點一個 Promise：等所有上游完成後才開始，所以沒有相依關係的節點自然平行
    const tasks = new Map<string, Promise<NodeRun>>()
    const start = (id: string): Promise<NodeRun> => {
      let task = tasks.get(id)
      if (!task) {
        const node = nodes.get(id)
        if (!node) throw new Error(`找不到節點 ${id}`)
        const ups = (incoming.get(id) ?? []).map((e) => e.from.nodeId)
        task = Promise.all([...new Set(ups)].map(start)).then(async (upstream) => {
          const blocked = upstream.some((u) => u.status === 'failed' || u.status === 'blocked')
          const cancelled = upstream.some((u) => u.status === 'cancelled')
          return this.runNode({
            node,
            runId,
            signal,
            runInputs,
            parentNodeRunId,
            idPrefix,
            incoming: incoming.get(id) ?? [],
            outputs,
            nodeRuns,
            skip: blocked ? 'blocked' : cancelled || signal.aborted ? 'cancelled' : undefined,
          })
        })
        tasks.set(id, task)
      }
      return task
    }

    // 依拓樸順序啟動，確保 nodeRuns 的順序穩定
    for (const id of topologicalOrder(workflow.nodes, workflow.edges).order) {
      void start(id)
    }
    for (const [id, task] of tasks) finished.set(id, await task)

    const all = [...finished.values()]
    const status: SubRunResult['status'] = all.some(
      (n) => n.status === 'failed' || n.status === 'blocked',
    )
      ? 'failed'
      : all.some((n) => n.status === 'cancelled')
        ? 'cancelled'
        : 'succeeded'
    return { status, outputs }
  }

  private async runNode(args: {
    node: WorkflowNode
    runId: string
    signal: AbortSignal
    runInputs: Record<string, unknown>
    parentNodeRunId: string | undefined
    idPrefix: string
    incoming: readonly WorkflowEdge[]
    outputs: Map<string, Record<string, unknown>>
    nodeRuns: NodeRun[]
    skip: 'blocked' | 'cancelled' | undefined
  }): Promise<NodeRun> {
    const {
      node,
      runId,
      signal,
      runInputs,
      parentNodeRunId,
      idPrefix,
      incoming,
      outputs,
      nodeRuns,
      skip,
    } = args
    const def = this.registry.get(node.type)
    if (!def) throw new Error(`找不到節點類型 ${node.type}`)
    const nodeRunId = this.newId()
    const base = {
      id: nodeRunId,
      runId,
      nodeId: `${idPrefix}${node.id}`,
      ...(parentNodeRunId ? { parentNodeRunId } : {}),
    }

    // 收集上游的輸入值與它們的雜湊（沒有成功輸出的上游代表要跳過）
    const inputs: Record<string, unknown> = {}
    const inputHashes: Record<string, string> = {}
    for (const edge of incoming) {
      const value = outputs.get(edge.from.nodeId)?.[edge.from.port]
      inputs[edge.to.port] = value
      inputHashes[edge.to.port] = hashValue(value ?? null)
    }

    const finish = (
      record: Omit<NodeRun, 'id' | 'runId' | 'nodeId' | 'cacheKey'> & { cacheKey?: string },
    ): NodeRun => {
      const nodeRun: NodeRun = {
        ...base,
        cacheKey: record.cacheKey ?? hashValue([node.type, node.id, record.status]),
        ...record,
      }
      nodeRuns.push(nodeRun)
      this.store.saveNodeRun(nodeRun)
      this.onEvent({ type: 'node-finished', runId, nodeId: nodeRun.nodeId, nodeRun })
      return nodeRun
    }

    if (skip) return finish({ status: skip })

    // 參數已在 validateWorkflow 驗證過，這裡取得套用預設值後的結果
    const params = def.params.parse(node.params)
    const cacheKey = hashValue([def.type, def.version, params, node.modelId ?? null, inputHashes])

    if (def.cacheable !== false) {
      const hit = this.store.findSucceeded(cacheKey)
      if (hit?.output !== undefined) {
        outputs.set(node.id, hit.output as Record<string, unknown>)
        const at = this.now().toISOString()
        return finish({
          status: 'cached',
          cacheKey,
          ...(hit.outputHash ? { outputHash: hit.outputHash } : {}),
          output: hit.output,
          startedAt: at,
          finishedAt: at,
        })
      }
    }

    // 花費檢查：已經超過上限就不再啟動任何新節點；否則預留這個節點的預估花費
    const runBudget = this.budgets.get(runId)
    const estimate = runBudget ? this.nodeEstimate(def, params, inputs, node.modelId) : 0
    if (runBudget) {
      const exceeded =
        runBudget.exceeded ??
        checkBudget({
          budget: runBudget.budget,
          runProjectedUsd: runBudget.actualUsd + runBudget.reservedUsd + estimate,
          projectBaseUsd: runBudget.projectBaseUsd,
        })
      if (exceeded) {
        if (!runBudget.exceeded) {
          runBudget.exceeded = exceeded
          this.onEvent({ type: 'budget-exceeded', runId, ...exceeded })
        }
        return finish({
          status: 'blocked',
          cacheKey,
          error: budgetExceededError(exceeded).toShape(),
        })
      }
      runBudget.reservedUsd += estimate
    }

    const costState = { reported: false }
    const reportCost = (cost: ReportedCost): void => {
      costState.reported = true
      this.recordCost(runId, cost, nodeRunId)
    }
    const startedAt = this.now().toISOString()
    this.onEvent({ type: 'node-started', runId, nodeId: base.nodeId, nodeRunId })
    try {
      // 展開子 Run 的控制節點本身不佔並行名額，否則子節點會因為名額被父節點佔走而卡死
      const slot =
        def.type === FOR_EACH_NODE ? <T>(t: () => Promise<T>) => t() : this.semaphoreRun.bind(this)
      const output = await slot(() =>
        Promise.resolve(
          def.run({
            params,
            inputs,
            runInputs,
            modelId: node.modelId,
            signal,
            nodeRunId,
            services: this.services,
            reportCost,
            runSub: (body, subInputs, label) =>
              this.runSub(
                body as Workflow,
                subInputs,
                label,
                runId,
                signal,
                nodeRuns,
                nodeRunId,
                `${base.nodeId}[`,
              ),
          }),
        ),
      )
      if (signal.aborted)
        return finish({
          status: 'cancelled',
          cacheKey,
          startedAt,
          finishedAt: this.now().toISOString(),
        })
      this.checkOutputs(def.type, def.outputs, output)
      outputs.set(node.id, output)
      if (!costState.reported && estimate > 0) {
        // 節點沒回報實際金額：以估算值入帳並標記為估算
        this.recordCost(
          runId,
          {
            provider: node.modelId?.split('/')[0] ?? 'unknown',
            modelId: node.modelId ?? def.type,
            amountUsd: estimate,
            estimated: true,
          },
          nodeRunId,
        )
      }
      return finish({
        status: 'succeeded',
        cacheKey,
        outputHash: hashValue(output),
        output,
        startedAt,
        finishedAt: this.now().toISOString(),
      })
    } catch (error) {
      if (signal.aborted)
        return finish({
          status: 'cancelled',
          cacheKey,
          startedAt,
          finishedAt: this.now().toISOString(),
        })
      return finish({
        status: 'failed',
        cacheKey,
        // 子工作流因為預算停下來時，forEach 只會看到「N 個項目失敗」，這裡換成真正的原因
        error:
          def.type === FOR_EACH_NODE && runBudget?.exceeded
            ? budgetExceededError(runBudget.exceeded).toShape()
            : toShape(error),
        startedAt,
        finishedAt: this.now().toISOString(),
      })
    } finally {
      if (runBudget) runBudget.reservedUsd -= estimate
    }
  }

  private nodeEstimate(
    def: NodeDefinition,
    params: unknown,
    inputs: Readonly<Record<string, unknown>>,
    modelId: string | undefined,
  ): number {
    if (!def.estimateCost) return 0
    try {
      return def.estimateCost({ params, inputs, modelId, estimate: this.priceLookup })
    } catch {
      return 0 // 估不出來就不擋；實際花費會在入帳時累計
    }
  }

  private recordCost(runId: string, cost: ReportedCost, nodeRunId: string): void {
    const runBudget = this.budgets.get(runId)
    if (!runBudget) return
    const entry = this.ledger.record({
      projectId: runBudget.projectId,
      runId,
      nodeRunId,
      provider: cost.provider,
      modelId: cost.modelId,
      amountUsd: cost.amountUsd,
      estimated: cost.estimated ?? false,
      ...(cost.jobId === undefined ? {} : { jobId: cost.jobId }),
    })
    runBudget.actualUsd += cost.amountUsd
    this.onEvent({ type: 'cost-recorded', runId, entry })
  }

  private semaphoreRun<T>(task: () => Promise<T>): Promise<T> {
    return this.semaphore.run(task)
  }

  /** 以子 Run 執行子工作流：節點 ID 加上前綴避免和父節點衝突，NodeRun 指回父節點。 */
  private async runSub(
    body: Workflow,
    runInputs: Record<string, unknown>,
    label: string,
    runId: string,
    signal: AbortSignal,
    nodeRuns: NodeRun[],
    parentNodeRunId: string,
    prefix: string,
  ): Promise<SubRunResult> {
    const { status, outputs } = await this.execute(
      body,
      runId,
      signal,
      runInputs,
      nodeRuns,
      parentNodeRunId,
      `${prefix}${label}]/`,
    )
    const outNode = body.nodes.find((n) => n.type === OUTPUT_NODE)
    const result = outNode ? outputs.get(outNode.id)?.value : undefined
    return { status, ...(result === undefined ? {} : { result }) }
  }

  private checkOutputs(
    type: string,
    declared: Readonly<Record<string, unknown>>,
    output: Record<string, unknown>,
  ): void {
    const missing = Object.keys(declared).filter((port) => !(port in output))
    const extra = Object.keys(output).filter((port) => !(port in declared))
    if (missing.length > 0 || extra.length > 0) {
      throw new AppError({
        code: 'invalid_response',
        userMessage: t('errors.theResultOfTheStep', {
          type,
          value: missing.length > 0 ? `（缺少 ${missing.join('、')}）` : '',
          value2: extra.length > 0 ? `（多出 ${extra.join('、')}）` : '',
        }),
      })
    }
    hashValue(output) // 輸出必須是 JSON 值，否則這裡會丟錯
  }
}
