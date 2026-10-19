import type { ProjectHandle } from '@svs/db'
import { type JobQueue, type JobDriver } from '@svs/engine'
import { resolveTools, type MediaTools } from '@svs/media'
import {
  type MockProviderConfig,
  type ModelRegistry,
  createFalDriver,
  createMockDriver,
  createOpenRouterDriver,
} from '@svs/providers'
import type {
  GenerationRequest,
  IpcEventName,
  IpcEventPayload,
  Job,
  JobSummary,
  LlmRequest,
} from '@svs/schema'

import type { KeyVault } from '../keys/key-vault'
import type { Logger } from '../logger'
import { createProjectJobQueue } from '../job-queue'
import { createMockVideoRenderer } from '../mock-video'
import type { ProjectManager } from '../project-manager'
import { createProviderServices } from '../provider-services'
import { shotLabelOfNode, stepLabelOfRun } from '../project-engine'
import { toJobSummary } from './job-summary'

export type Broadcast = <E extends IpcEventName>(event: E, payload: IpcEventPayload<E>) => void

export interface ProjectRuntimeDeps {
  projects: ProjectManager
  keys: KeyVault
  models: ModelRegistry
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  /** 找 FFmpeg（示範影片用）；預設到系統找。找不到時示範影片會回報失敗，其他功能照常。 */
  tools?: () => MediaTools | undefined
  /** 測試用：讓輪詢更快。 */
  pollIntervalMs?: number
  /** 測試用：示範模式的 LLM 回應（例如讓假拆鏡帶出指定的角色）。 */
  mockLlm?: (request: LlmRequest) => string | object | undefined
  /** 測試用：示範模式每次生成回報的花費（美元）。 */
  mockCostUsd?: (request: GenerationRequest) => number
  /** 測試用：示範模式每次送出與輪詢都等這麼久（毫秒），讓「生成到一半」的情境穩定重現。 */
  mockLatencyMs?: number
  /** 測試用：示範供應商遇到含這段文字的請求就拒絕（示範「失敗 → 修改 → 重試」）。 */
  mockRejectText?: string
  /** 示範圖的畫法（用系統字型畫中文）；沒給就用點陣字型。 */
  mockFrame?: MockProviderConfig['renderFrame']
  /** 測試用：OpenRouter 的位址（換成本機的假伺服器）；沒給就連 OpenRouter。 */
  openrouterBaseUrl?: string
}

/** 只提供給 IPC handler 的部分。 */
export interface QueueAccess {
  queue: () => JobQueue | undefined
  /** 任務 → 給畫面看的摘要（會帶上「第幾鏡」）。 */
  summarize: (job: Job) => JobSummary
}

export interface ProjectRuntime extends QueueAccess {
  dispose: () => void
}

export function findTools(): MediaTools | undefined {
  try {
    return resolveTools()
  } catch {
    return undefined
  }
}

/**
 * 每個開啟的專案各有一條任務佇列（任務存在專案資料庫裡）：
 * 開專案時建立並啟動（接回上次沒做完的任務），關專案或換專案時停止。
 * 供應商的 Key 在每次呼叫時才向金庫取，所以填了 Key 之後不用重開專案。
 */
export function createProjectRuntime(deps: ProjectRuntimeDeps): ProjectRuntime {
  const { projects, keys, models, broadcast, log } = deps
  let current: { queue: JobQueue; unsubscribe: () => void; handle: ProjectHandle } | undefined

  const endpointFor = (modelId: string, capability: string): string | undefined => {
    const endpoints: Record<string, string | undefined> | undefined = models.get(modelId)?.endpoints
    return endpoints?.[capability]
  }

  const buildDrivers = (handle: ProjectHandle): Record<string, JobDriver> => {
    const services = createProviderServices(handle)
    const tools = (deps.tools ?? findTools)()
    return {
      mock: createMockDriver(services, {
        ...(tools ? { renderVideo: createMockVideoRenderer(tools, deps.mockFrame) } : {}),
        ...(deps.mockFrame ? { renderFrame: deps.mockFrame } : {}),
        ...(deps.mockLlm ? { llm: deps.mockLlm } : {}),
        ...(deps.mockCostUsd ? { costUsd: deps.mockCostUsd } : {}),
        ...(deps.mockLatencyMs === undefined ? {} : { latencyMs: deps.mockLatencyMs }),
        ...(deps.mockRejectText === undefined ? {} : { rejectText: deps.mockRejectText }),
      }),
      fal: createFalDriver({
        getKey: () => keys.get('fal'),
        endpointFor: (modelId, capability) => endpointFor(modelId, capability),
        services,
      }),
      openrouter: createOpenRouterDriver({
        getKey: () => keys.get('openrouter'),
        endpointFor: (modelId, capability) => endpointFor(modelId, capability),
        imageApiFor: (modelId) => models.get(modelId)?.imageApi,
        defaultVoiceFor: (modelId) => models.get(modelId)?.voices[0]?.id,
        services,
        ...(deps.openrouterBaseUrl === undefined ? {} : { baseUrl: deps.openrouterBaseUrl }),
      }),
    }
  }

  /** 任務屬於哪一鏡：節點還在跑時看記憶體裡的索引，跑完之後從節點執行紀錄的節點編號認出來。 */
  const summarize = (job: Job): JobSummary => {
    const handle = current?.handle
    let label: string | undefined
    if (job.nodeRunId && handle) {
      const nodeId = handle.repos.runs.getNodeRun(job.nodeRunId)?.nodeId
      label =
        stepLabelOfRun(handle, job.nodeRunId) ??
        (nodeId === undefined ? undefined : shotLabelOfNode(nodeId))
    }
    return toJobSummary(job, label)
  }

  const stop = (): void => {
    if (!current) return
    current.unsubscribe()
    current.queue.stop()
    current = undefined
  }

  const unsubscribeProjects = projects.onChange((handle) => {
    stop()
    if (handle) {
      const queue = createProjectJobQueue(handle, {
        drivers: buildDrivers(handle),
        limits: {
          fal: { concurrency: 3, minIntervalMs: 300, pollIntervalMs: 4000 },
          openrouter: { concurrency: 4, pollIntervalMs: 5000 },
          mock: { pollIntervalMs: deps.pollIntervalMs ?? 500 },
        },
        onUnexpectedError: (job, error) => {
          log.error(
            `任務 ${job.id}（${job.provider}）發生未預期錯誤：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
          )
        },
      })
      const unsubscribe = queue.subscribe((job) => {
        broadcast('queue.changed', summarize(job))
      })
      queue.start()
      current = { queue, unsubscribe, handle }
      log.info('任務佇列已啟動')
    }
    broadcast('queue.reset', {})
  })

  return {
    queue: () => current?.queue,
    summarize,
    dispose: () => {
      unsubscribeProjects()
      stop()
    },
  }
}
