import type {
  AppErrorShape,
  AppSettings,
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcResult,
  KeyStatus,
  ModelOption,
  SvsApi,
} from '@svs/schema'
import { vi } from 'vitest'

type Handler = (payload: never) => unknown

export const SETTINGS: AppSettings = {
  onboardingDone: true,
  demoMode: false,
  advancedMode: false,
  storyboardGuide: '',
  characterPrompts: {},
  productionGuide: '',
  videoNegativePrompt: '',
  mcp: { enabled: false, port: 47821, allowanceUsd: 0 },
  theme: 'system',
  models: {},
  budget: { perRunLimitUsd: 5 },
  modelNotices: [],
  audio: { voices: {} },
  experiments: {},
}

export const KEYS: KeyStatus[] = [
  { provider: 'fal', configured: false },
  { provider: 'openrouter', configured: false },
]

export const MODELS: ModelOption[] = [
  {
    id: 'fal/nano-banana-2',
    displayName: 'Nano Banana 2',
    provider: 'fal',
    providerName: 'fal.ai',
    capabilities: ['t2i', 'edit'],
    tier: 'balanced',
    recommended: true,
    priceLabel: '約 US$0.08／張',
    priceShort: '每張約 US$0.08',
    priceVerified: false,
    badges: [],
    voices: [],
    otherChannels: [],
  },
  {
    id: 'fal/seedream-5.0',
    displayName: 'Seedream 5.0',
    provider: 'fal',
    providerName: 'fal.ai',
    capabilities: ['t2i', 'edit'],
    tier: 'budget',
    recommended: false,
    priceLabel: '約 US$0.04／張',
    priceShort: '每張約 US$0.04',
    priceVerified: true,
    badges: [],
    voices: [],
    otherChannels: [],
  },
]

/** 模擬主行程回報的錯誤：在 handler 裡 `throw appError('…')`。 */
export class FakeAppError extends Error {
  readonly shape: AppErrorShape

  constructor(userMessage: string) {
    super(userMessage)
    this.shape = { code: 'internal_error', retryable: false, userMessage }
  }
}

export const appError = (userMessage: string): FakeAppError => new FakeAppError(userMessage)

/**
 * 測試用的 `window.svs`。預設回應是一個「剛裝好、還沒填 Key」的 App，
 * 個別 channel 可以用 `handlers` 覆寫（回傳資料，或丟 `appError(...)` 當作主行程回報的錯誤）。
 */
export function installFakeSvs(handlers: Partial<Record<IpcChannel, Handler>> = {}) {
  const defaults: Record<string, Handler> = {
    'keys.list': () => ({
      keys: KEYS,
      storage: { available: true, kind: 'os' },
    }),
    'settings.get': () => SETTINGS,
    'models.notices': () => ({ notices: [] }),
    'models.list': () => ({ models: [], selected: {}, voices: {}, locked: [], project: null }),
    'queue.list': () => ({ jobs: [] }),
    'slima.status': () => ({ state: 'no_token' }),
    'slima.books': () => ({ books: [] }),
    'quickstart.state': () => null,
    'quickstart.upgradeCheck': () => ({
      ok: false,
      issue: '還沒有可以升級的鏡頭。',
      shotCount: 0,
      newCharacters: [],
      actTitle: '',
    }),
    'files.list': () => ({ files: [], exports: [], totalBytes: 0 }),
    'records.list': () => ({ records: [], total: 0, totalCostUsd: 0 }),
    'shots.list': () => ({ shots: [] }),
    'sound.get': () => ({
      settings: {
        nativeAudio: true,
        nativeGainDb: 0,
        muteNativeShotIds: [],
        duck: true,
        narrationGainDb: 0,
        musicGainDb: -18,
      },
      shots: [],
      totalSec: 0,
      warnings: [],
      models: {},
    }),
    'characters.list': () => ({ characters: [] }),
    'locations.list': () => ({ locations: [] }),
    'locations.references': (payload: { locationId: string }) => ({
      locationId: payload.locationId,
      references: [],
    }),
    'locations.images': (payload: { locationId: string }) => ({
      locationId: payload.locationId,
      concepts: [],
    }),
    'locations.check': () => ({
      ok: true,
      estimatedUsd: 0.32,
      count: 4,
      demoMode: false,
      modelName: 'Nano Banana 2',
    }),
    'canvas.get': () => ({ nodes: [], edges: [] }),
    'canvas.viewport': () => ({}),
    'app.startView': () => ({ view: 'canvas' }),
    'project.current': () => ({
      id: 'p1',
      name: '測試專案',
      dir: '/tmp/test.svsproj',
      aspectRatio: '16:9',
    }),
    'history.state': () => ({ canUndo: false, canRedo: false }),
    'history.undo': () => ({ applied: false, state: { canUndo: false, canRedo: false } }),
    'history.redo': () => ({ applied: false, state: { canUndo: false, canRedo: false } }),
    'outline.get': () => ({ acts: [], locations: [] }),
    'outline.splitCheck': () => ({
      ok: true,
      estimatedUsd: 0.02,
      demoMode: false,
      replacesExisting: false,
      modelName: 'Test LLM',
    }),
    'characters.versions': () => ({ versions: [] }),
    'characters.concepts': (payload: { characterId: string }) => ({
      characterId: payload.characterId,
      concepts: [],
    }),
    'characters.turnarounds': (payload: { characterId: string }) => ({
      characterId: payload.characterId,
      turnarounds: [],
    }),
    'characters.turnaroundCheck': () => ({
      ok: true,
      estimatedUsd: 0.32,
      count: 4,
      demoMode: false,
      modelName: 'Nano Banana 2',
    }),
    'characters.conceptCheck': () => ({
      ok: true,
      estimatedUsd: 0.32,
      count: 4,
      demoMode: false,
      modelName: 'Nano Banana 2',
    }),
    'settings.update': () => SETTINGS,
    'mcp.status': () => ({
      enabled: false,
      running: false,
      port: 47821,
      allowanceUsd: 0,
      committedUsd: 0,
    }),
    'keys.set': (payload: { provider: string }) => ({
      provider: payload.provider,
      configured: true,
    }),
    'keys.delete': (payload: { provider: string }) => ({
      provider: payload.provider,
      configured: false,
    }),
  }
  const calls: { channel: string; payload: unknown }[] = []
  const invoke = vi.fn(async (channel: string, payload: unknown) => {
    calls.push({ channel, payload })
    const handler = (handlers as Record<string, Handler | undefined>)[channel] ?? defaults[channel]
    if (!handler) return { ok: false, error: appError(`沒有實作 ${channel}`).shape }
    try {
      return { ok: true, data: await handler(payload as never) }
    } catch (error) {
      if (error instanceof FakeAppError) return { ok: false, error: error.shape }
      throw error
    }
  })
  const listeners = new Map<string, Set<(payload: never) => void>>()
  const api = {
    invoke: invoke as unknown as SvsApi['invoke'],
    on: ((event: string, listener: (payload: never) => void) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => {
        set.delete(listener)
      }
    }) as SvsApi['on'],
  } satisfies SvsApi
  Object.defineProperty(window, 'svs', { value: api, configurable: true, writable: true })
  return {
    invoke,
    calls,
    /** 模擬主行程推送事件。 */
    emit: (event: string, payload: unknown): void => {
      for (const listener of listeners.get(event) ?? []) listener(payload as never)
    },
    /** 指定 channel 被呼叫的 payload 清單。 */
    payloadsOf: <C extends IpcChannel>(channel: C): IpcRequest<C>[] =>
      calls.filter((c) => c.channel === channel).map((c) => c.payload as IpcRequest<C>),
  }
}

export type { IpcResponse, IpcResult }

/** jsdom 沒有的瀏覽器功能，節點圖畫布（React Flow）需要。 */
export function installFlowEnv(): void {
  class FakeResizeObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  class FakeDomMatrix {
    m22 = 1
  }
  Object.assign(globalThis, {
    ResizeObserver: FakeResizeObserver,
    DOMMatrixReadOnly: FakeDomMatrix,
  })
  for (const [name, value] of [
    ['offsetWidth', 1000],
    ['offsetHeight', 600],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value })
  }
}
