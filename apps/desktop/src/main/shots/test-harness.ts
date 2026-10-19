import { ModelRegistry, loadBuiltinModelCards } from '@svs/providers'
import type { IpcEventName, QuickStartProgress, QuickStartRequest } from '@svs/schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, vi } from 'vitest'

import { MemoryVault } from '../keys/key-vault'
import { ProjectManager } from '../project-manager'
import { createMemorySettingsStore } from '../settings/settings-store'
import { createStudioApp, type StudioAppOptions } from '../studio-app'

export interface HarnessOptions {
  demoMode?: boolean
  perRunLimitUsd?: number
  /** 讓示範模式的假拆鏡帶出指定的內容。 */
  mockLlm?: StudioAppOptions['mockLlm']
  /** 讓示範模式每次生成回報花費。 */
  mockCostUsd?: StudioAppOptions['mockCostUsd']
  /** 畫布「上傳」的選檔視窗要回傳的檔案。 */
  pickFiles?: StudioAppOptions['pickFiles']
  /** 把 OpenRouter 換成本機的假伺服器（真實模式的測試用）。 */
  openrouterBaseUrl?: string
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

/**
 * 測試用的整套主行程服務（示範模式、不連網、不用 Key）：專案管理、任務佇列、快速開始、鏡頭服務。
 * 呼叫 cleanup() 會關掉專案並刪掉暫存資料夾。
 */
export function createStudioHarness(options: HarnessOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'svs-studio-'))
  const projects = new ProjectManager('test')
  const models = new ModelRegistry(loadBuiltinModelCards())
  const keys = new MemoryVault()
  const settings = createMemorySettingsStore({
    demoMode: options.demoMode ?? true,
    ...(options.perRunLimitUsd === undefined
      ? {}
      : { budget: { perRunLimitUsd: options.perRunLimitUsd } }),
  })
  const events: { name: IpcEventName; payload: unknown }[] = []
  /** 「在資料夾中顯示」被要求打開的路徑。 */
  const revealed: string[] = []
  const broadcast = (name: IpcEventName, payload: unknown): void => {
    events.push({ name, payload })
  }
  const {
    settingsService,
    runtime,
    shots,
    characters,
    concepts,
    sound,
    turnarounds,
    locations,
    outline,
    storyboard,
    canvas,
    quickstart,
    upgrade,
    graph,
    records,
    files,
    demo,
    history,
    library,
  } = createStudioApp({
    projects,
    keys,
    settings,
    models,
    broadcast,
    log,
    projectsDir: join(root, 'projects'),
    pollIntervalMs: 5,
    reveal: (path) => {
      revealed.push(path)
    },
    ...(options.mockLlm ? { mockLlm: options.mockLlm } : {}),
    ...(options.openrouterBaseUrl ? { openrouterBaseUrl: options.openrouterBaseUrl } : {}),
    ...(options.mockCostUsd ? { mockCostUsd: options.mockCostUsd } : {}),
    ...(options.pickFiles ? { pickFiles: options.pickFiles } : {}),
  })

  const progress = (): QuickStartProgress[] =>
    events
      .filter((e) => e.name === 'quickstart.progress')
      .map((e) => e.payload as QuickStartProgress)

  /** 等到快速開始結束（成功、失敗或取消）。 */
  const finished = async (): Promise<QuickStartProgress> => {
    await vi.waitFor(
      () => {
        const last = progress().at(-1)
        expect(last && last.status !== 'running').toBe(true)
      },
      { timeout: 30_000, interval: 20 },
    )
    const last = progress().at(-1)
    if (!last) throw new Error('沒有進度')
    return last
  }

  /** 跑完一次快速開始（3 鏡、每鏡 3 秒）。 */
  const runQuickStart = async (extra: Partial<QuickStartRequest> = {}) => {
    await quickstart.run({
      story: '一隻貓在雨天裡找到溫暖的家',
      style: 'anime',
      shotCount: 3,
      durationSec: 3,
      aspectRatio: '16:9',
      variation: 0,
      ...extra,
    })
    return finished()
  }

  /** 等某個鏡頭不再進行任何事。 */
  const idle = async (shotId: string): Promise<void> => {
    await vi.waitFor(
      () => {
        const shot = shots.list().shots.find((s) => s.id === shotId)
        expect(shot?.activity).toBeUndefined()
      },
      { timeout: 30_000, interval: 20 },
    )
  }

  const cleanup = (): void => {
    runtime.dispose()
    projects.close()
    rmSync(root, { recursive: true, force: true })
  }

  return {
    root,
    demo,
    projects,
    settings,
    settingsService,
    keys,
    runtime,
    shots,
    characters,
    concepts,
    sound,
    turnarounds,
    locations,
    outline,
    storyboard,
    canvas,
    quickstart,
    upgrade,
    graph,
    records,
    files,
    history,
    library,
    events,
    revealed,
    progress,
    finished,
    runQuickStart,
    idle,
    cleanup,
  }
}
