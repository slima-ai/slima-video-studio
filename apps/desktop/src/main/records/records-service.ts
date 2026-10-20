import type { ProjectHandle } from '@svs/db'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  GenerationOutputSchema,
  GenerationRequestSchema,
  type GenerationRecord,
  type GenerationRequest,
  type Job,
  type RecordRedoRequest,
  type RecordResult,
  type RecordTarget,
  type RecordsFilter,
  type RecordsSnapshot,
} from '@svs/schema'
import { REFERENCE_PROMPT_SUFFIX, withoutFrameFillSuffix } from '@svs/workflows'

import type { ProjectManager } from '../project-manager'
import type { ShotService } from '../shots/shot-service'

export interface RecordsServiceDeps {
  projects: ProjectManager
  shots: Pick<ShotService, 'list' | 'update' | 'regenerate'>
  models: Pick<ModelRegistry, 'get'>
}

export interface RecordsService {
  list: (filter: RecordsFilter) => RecordsSnapshot
  /** 用這一筆（或改過）的 prompt 重新生成它所屬的鏡頭。 */
  redo: (request: RecordRedoRequest) => Promise<{ shotId: string }>
}

/** 畫面一次最多給這麼多筆；再舊的要靠篩選縮小範圍。 */
const PAGE = 200
/** 從資料庫最多往回讀這麼多筆任務。 */
const SCAN = 5000

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/**
 * 首幀圖送出的 prompt 後面，系統會補「滿版單一連續畫面」的描述，圖片編輯時前面還有一段「參考圖要一致」的提醒；
 * 顯示與重用時都拿掉（不然重生時會疊兩次）。
 */
export function cleanPrompt(prompt: string): string {
  const base = withoutFrameFillSuffix(prompt)
  return base.endsWith(REFERENCE_PROMPT_SUFFIX)
    ? base.slice(0, -REFERENCE_PROMPT_SUFFIX.length)
    : base
}

function promptOf(request: GenerationRequest): string | undefined {
  switch (request.capability) {
    case 'llm':
      return request.messages.filter((m) => m.role === 'user').at(-1)?.content
    case 'tts':
      return request.text
    case 'music':
      return request.prompt
    case 'edit':
    case 't2i':
      return cleanPrompt(request.prompt)
    case 't2v':
    case 'i2v':
    case 'r2v':
      return request.prompt
  }
}

function paramsOf(request: GenerationRequest): string[] {
  const out: string[] = []
  if (request.capability === 'music') {
    if (request.durationSec !== undefined) out.push(`${String(request.durationSec)} 秒`)
    return out
  }
  if (request.capability === 'llm' || request.capability === 'tts') return out
  out.push(request.aspectRatio)
  if ('durationSec' in request) out.push(`${String(request.durationSec)} 秒`)
  if ('audio' in request && request.audio) out.push('有聲')
  if (request.referenceAssets.length > 0)
    out.push(`${String(request.referenceAssets.length)} 張參考圖`)
  if ('startFrameAsset' in request && request.startFrameAsset) out.push('用第一張畫面生成')
  if ('cameraMove' in request && request.cameraMove) out.push(`運鏡：${request.cameraMove}`)
  if (request.seed !== undefined) out.push(`變化 ${String(request.seed)}`)
  return out
}

interface Targets {
  /** 哪個節點執行產生的版本屬於哪個鏡頭（最準確；相同內容被重用時也不會搞混）。 */
  byNodeRun: Map<string, RecordTarget>
  /** 素材放在哪裡：鏡頭的版本、角色的概念圖與三視圖、場景卡的概念圖。 */
  byHash: Map<string, RecordTarget>
}

function targetsOf(handle: ProjectHandle): Targets {
  const byNodeRun = new Map<string, RecordTarget>()
  const byHash = new Map<string, RecordTarget>()
  const { shots, characters, locationCards } = handle.repos
  for (const shot of shots.list()) {
    const target: RecordTarget = {
      type: 'shot',
      id: shot.id,
      label: `第 ${String(shot.number)} 鏡`,
    }
    for (const take of shots.listTakes(shot.id)) {
      if (take.nodeRunId && !byNodeRun.has(take.nodeRunId)) byNodeRun.set(take.nodeRunId, target)
      if (!byHash.has(take.assetHash)) byHash.set(take.assetHash, target)
    }
  }
  for (const character of characters.list()) {
    const target: RecordTarget = { type: 'character', id: character.id, label: character.name }
    for (const concept of characters.listConcepts(character.id))
      byHash.set(concept.assetHash, target)
    for (const t of characters.listTurnarounds(character.id)) byHash.set(t.sheetHash, target)
  }
  for (const card of locationCards.list()) {
    const target: RecordTarget = { type: 'location', id: card.id, label: card.name }
    for (const concept of locationCards.listConcepts(card.id)) byHash.set(concept.assetHash, target)
  }
  return { byNodeRun, byHash }
}

function resultOf(job: Job): RecordResult | undefined {
  const parsed = GenerationOutputSchema.safeParse(job.output)
  if (!parsed.success || parsed.data.kind !== 'assets') return undefined
  const asset = parsed.data.assets[0]
  if (!asset || (asset.kind !== 'image' && asset.kind !== 'video')) return undefined
  return { kind: asset.kind, hash: asset.hash }
}

export function createRecordsService(deps: RecordsServiceDeps): RecordsService {
  const current = (): ProjectHandle => {
    const handle = deps.projects.current()
    if (!handle || handle.closed) throw invalid('請先開啟或建立一個專案。')
    return handle
  }

  /** 還在排隊或進行中的不算「紀錄」（那是生成佇列的事）。 */
  const finished = (job: Job): boolean =>
    job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled'

  const build = (handle: ProjectHandle, filter: RecordsFilter): GenerationRecord[] => {
    const targets = targetsOf(handle)
    const ledger = new Map<string, { usd: number; estimated: boolean }>()
    for (const entry of handle.repos.costs.list(handle.projectId)) {
      if (!entry.jobId) continue
      const before = ledger.get(entry.jobId)
      ledger.set(entry.jobId, {
        usd: (before?.usd ?? 0) + entry.amountUsd,
        estimated: (before?.estimated ?? false) || entry.estimated,
      })
    }

    const records: GenerationRecord[] = []
    const jobs = handle.repos.jobs.list({ limit: SCAN }).filter(finished).reverse()
    for (const job of jobs) {
      if (filter.kind && job.kind !== filter.kind) continue
      if (filter.outcome === 'failed' && job.status === 'succeeded') continue
      if (filter.outcome === 'succeeded' && job.status !== 'succeeded') continue

      const parsed = GenerationRequestSchema.safeParse(job.input)
      const request = parsed.success ? parsed.data : undefined
      const result = resultOf(job)
      const target =
        (job.nodeRunId ? targets.byNodeRun.get(job.nodeRunId) : undefined) ??
        (result ? targets.byHash.get(result.hash) : undefined)
      if (filter.shotId && !(target?.type === 'shot' && target.id === filter.shotId)) continue

      const prompt = request ? promptOf(request) : undefined
      const spent =
        job.costUsd !== undefined ? { usd: job.costUsd, estimated: false } : ledger.get(job.id)
      const started = Date.parse(job.createdAt)
      const ended = Date.parse(job.updatedAt)
      records.push({
        id: job.id,
        createdAt: job.createdAt,
        kind: job.kind,
        status: job.status,
        modelId: job.modelId,
        modelName: deps.models.get(job.modelId)?.displayName ?? job.modelId,
        ...(prompt ? { prompt } : {}),
        params: request ? paramsOf(request) : [],
        ...(Number.isFinite(started) && Number.isFinite(ended)
          ? { durationMs: Math.max(0, ended - started) }
          : {}),
        ...(spent ? { costUsd: spent.usd, costEstimated: spent.estimated } : {}),
        ...(job.error ? { error: job.error.userMessage } : {}),
        ...(result ? { result } : {}),
        ...(target ? { target } : {}),
        canRedo:
          target?.type === 'shot' &&
          result !== undefined &&
          prompt !== undefined &&
          (job.kind === 'image' || job.kind === 'video'),
      })
    }
    return records
  }

  return {
    list(filter) {
      // 還沒有專案就是還沒生成過任何東西，不算錯誤
      const handle = deps.projects.current()
      if (!handle || handle.closed) return { records: [], total: 0, totalCostUsd: 0 }
      const all = build(handle, filter)
      return {
        records: all.slice(0, PAGE),
        total: all.length,
        totalCostUsd: all.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
      }
    },

    async redo({ jobId, prompt }) {
      const handle = current()
      const record = build(handle, {}).find((r) => r.id === jobId)
      if (!record) throw invalid('找不到這筆紀錄。')
      const { target } = record
      if (!record.canRedo || target?.type !== 'shot') {
        throw invalid('這一筆沒辦法直接重新生成，請到對應的頁面操作。')
      }
      const shot = deps.shots.list().shots.find((s) => s.id === target.id)
      if (!shot) throw invalid('這個鏡頭已經不在了。')

      const wanted = (prompt ?? record.prompt ?? '').trim()
      if (wanted === '') throw invalid('prompt 不能是空的。')
      // 跟鏡頭現在實際會送出的 prompt 一樣就不必動它
      if (wanted !== (shot.prompt ?? shot.autoPrompt).trim()) {
        deps.shots.update(shot.id, { prompt: wanted })
      }
      await deps.shots.regenerate(shot.id, record.kind === 'video' ? 'video' : 'all')
      return { shotId: shot.id }
    },
  }
}
