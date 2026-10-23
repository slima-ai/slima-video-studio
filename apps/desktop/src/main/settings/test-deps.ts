import { ModelRegistry, loadBuiltinModelCards } from '@svs/providers'

import type { HandlerDeps } from '../ipc/handlers'
import type { KeyTester } from '../keys/key-tester'
import type { KeyVault } from '../keys/key-vault'
import { toJobSummary } from '../runtime/job-summary'
import { createSettingsService } from './model-service'
import { createMemorySettingsStore } from './settings-store'

/** 測試用：設定 / 模型 / 測試連線這三項相依，用記憶體版本湊齊。 */
export function testSettingsDeps(
  keys: KeyVault,
  keyTester?: KeyTester,
): Pick<
  HandlerDeps,
  | 'keyTester'
  | 'settings'
  | 'settingsService'
  | 'runtime'
  | 'quickstart'
  | 'upgrade'
  | 'slima'
  | 'slimaImport'
  | 'graph'
  | 'canvas'
  | 'records'
  | 'files'
  | 'library'
  | 'shots'
  | 'characters'
  | 'concepts'
  | 'turnarounds'
  | 'locations'
  | 'outline'
  | 'storyboard'
  | 'history'
> {
  const settings = createMemorySettingsStore()
  return {
    runtime: { queue: () => undefined, summarize: (job) => toJobSummary(job) },
    quickstart: {
      check: () => ({
        ok: false,
        issues: [],
        estimatedUsd: 0,
        estimateIsLowerBound: true,
        limitUsd: 5,
        models: {},
        demoMode: false,
      }),
      run: () => Promise.reject(new Error('測試用的快速開始不能執行')),
      cancel: () => undefined,
      state: () => null,
      export: () => {
        throw new Error('測試用的快速開始不能匯出')
      },
    },
    upgrade: {
      check: () => ({
        ok: false,
        issue: '測試用',
        shotCount: 0,
        newCharacters: [],
        actTitle: '',
      }),
      upgrade: () => {
        throw new Error('測試用的升級服務不能升級')
      },
    },
    slima: {
      status: () => ({ state: 'no_token' }),
      start: () => undefined,
      stop: () => Promise.resolve(),
      connect: () => Promise.resolve({ state: 'no_token' }),
      disconnect: () => Promise.resolve({ state: 'no_token' }),
      books: () => Promise.resolve({ books: [] }),
      reader: {
        listBooks: () => Promise.resolve([]),
        getBook: () => Promise.reject(new Error('測試用的 Slima 不能讀書')),
        listFiles: () => Promise.resolve([]),
        readFile: () => Promise.reject(new Error('測試用的 Slima 不能讀檔')),
      },
    },
    files: {
      list: () => ({ files: [], exports: [], totalBytes: 0 }),
      reveal: () => undefined,
    },
    records: {
      list: () => ({ records: [], total: 0, totalCostUsd: 0 }),
      redo: () => Promise.reject(new Error('測試用的紀錄服務不能重新生成')),
    },
    graph: {
      shot: () => {
        throw new Error('測試用的節點圖服務沒有資料')
      },
    },
    canvas: {
      get: () => ({ nodes: [], edges: [] }),
      move: () => undefined,
      tidy: () => ({ reset: 0 }),
      add: () => {
        throw new Error('測試用的畫布服務不能新增')
      },
      link: () => {
        throw new Error('測試用的畫布服務不能拉線')
      },
      relink: () => {
        throw new Error('測試用的畫布服務不能改接')
      },
      unlink: () => {
        throw new Error('測試用的畫布服務不能剪線')
      },
      remove: () => {
        throw new Error('測試用的畫布服務不能刪除')
      },
      paste: () => {
        throw new Error('測試用的畫布服務不能貼上')
      },
      updateOneliner: () => undefined,
      updateFree: () => undefined,
      importFiles: () => Promise.resolve({ added: [], skipped: [] }),
      importBytes: () => Promise.resolve({ added: [], skipped: [] }),
      runPlan: () => {
        throw new Error('測試用的畫布服務不能執行')
      },
      runChoices: () => {
        throw new Error('測試用的畫布服務不能執行')
      },
      run: () => Promise.reject(new Error('測試用的畫布服務不能執行')),
      viewport: () => undefined,
    },
    slimaImport: {
      tree: () => Promise.reject(new Error('測試用的 Slima 匯入不能讀書')),
      check: () => Promise.reject(new Error('測試用的 Slima 匯入不能檢查')),
      import: () => Promise.reject(new Error('測試用的 Slima 匯入不能匯入')),
    },
    shots: {
      list: () => ({ shots: [] }),
      live: () => new Map(),
      staleness: () => new Map(),
      references: (shotId) => ({ shotId, limit: 0, auto: true, picked: [], candidates: [] }),
      setEndFrame: () => {
        throw new Error('not used')
      },
      endFrameCheck: () => {
        throw new Error('not used')
      },
      generateEndFrame: () => {
        throw new Error('not used')
      },
      setReferences: () => {
        throw new Error('測試用的鏡頭服務不能指定參考圖')
      },
      create: () => {
        throw new Error('測試用的鏡頭服務不能新增')
      },
      remove: () => ({ shots: [] }),
      reorder: () => ({ shots: [] }),
      assignScene: () => ({ shots: [] }),
      moveToScene: () => ({ shots: [] }),
      sceneShotCounts: () => ({ existing: 0, generated: 0 }),
      flowOf: () => {
        throw new Error('測試用的鏡頭服務沒有流程')
      },
      replaceSceneShots: () => ({ shots: [] }),
      update: () => {
        throw new Error('測試用的鏡頭服務不能修改')
      },
      regenerate: () => Promise.reject(new Error('測試用的鏡頭服務不能重新生成')),
      cancel: () => undefined,
      batchCheck: () => {
        throw new Error('測試用的鏡頭服務不能檢查批次生成')
      },
      generateBatch: () => Promise.reject(new Error('測試用的鏡頭服務不能批次生成')),
      planRun: () => {
        throw new Error('測試用的鏡頭服務不能檢查執行')
      },
      run: () => Promise.reject(new Error('測試用的鏡頭服務不能執行')),
      whenIdle: () => Promise.resolve(),
      setUploadedFrame: () => undefined,
      duplicate: () => {
        throw new Error('測試用的鏡頭服務不能複製')
      },
      clearAdopted: () => undefined,
      adopt: () => {
        throw new Error('測試用的鏡頭服務不能切換版本')
      },
      rejoin: () => Promise.reject(new Error('測試用的鏡頭服務不能接片')),
      beginQuickStart: () => () => undefined,
      record: () => undefined,
      finalVideoHash: () => undefined,
      finalCut: () => undefined,
      onRejoined: () => () => undefined,
    },
    characters: {
      list: () => [],
      create: () => {
        throw new Error('測試用的角色服務不能新增')
      },
      update: () => {
        throw new Error('測試用的角色服務不能修改')
      },
      remove: () => undefined,
      suggestAnchor: () => Promise.reject(new Error('測試用的角色服務不能整理')),
      setAnchor: () => {
        throw new Error('測試用的角色服務不能存描述')
      },
      lock: () => {
        throw new Error('測試用的角色服務不能鎖定')
      },
      versions: () => [],
      restoreVersion: () => {
        throw new Error('測試用的角色服務不能還原版本')
      },
      pickHero: () => {
        throw new Error('測試用的角色服務不能挑主圖')
      },
      adoptTurnaround: () => {
        throw new Error('測試用的角色服務不能採用三視圖')
      },
    },
    concepts: {
      state: (characterId) => ({ characterId, concepts: [] }),
      check: () => ({ ok: false, issue: '測試用', estimatedUsd: 0, count: 4, demoMode: false }),
      generate: () => {
        throw new Error('測試用的概念圖服務不能生成')
      },
      cancel: () => undefined,
      references: (characterId) => ({ characterId, references: [] }),
      addReference: () => {
        throw new Error('測試用的概念圖服務不能加參考圖')
      },
      removeReference: () => {
        throw new Error('測試用的概念圖服務不能拿掉參考圖')
      },
    },
    turnarounds: {
      state: (characterId) => ({ characterId, turnarounds: [] }),
      check: () => ({ ok: false, issue: '測試用', estimatedUsd: 0, count: 4, demoMode: false }),
      generate: () => {
        throw new Error('測試用的三視圖服務不能生成')
      },
      cancel: () => undefined,
      reslice: () => Promise.reject(new Error('測試用的三視圖服務不能切圖')),
    },
    locations: {
      list: () => [],
      setAnchor: () => {
        throw new Error('測試用的場景卡服務不能修改')
      },
      images: (locationId) => ({ locationId, concepts: [] }),
      check: () => ({ ok: false, issue: '測試用', estimatedUsd: 0, count: 4, demoMode: false }),
      generate: () => {
        throw new Error('測試用的場景卡服務不能生成')
      },
      cancel: () => undefined,
      pickMain: () => {
        throw new Error('測試用的場景卡服務不能挑主圖')
      },
      lock: () => {
        throw new Error('測試用的場景卡服務不能鎖定')
      },
      unlock: () => {
        throw new Error('測試用的場景卡服務不能解除鎖定')
      },
      references: (locationId) => ({ locationId, references: [] }),
      addReference: () => {
        throw new Error('測試用的場景卡服務不能加參考圖')
      },
      removeReference: () => {
        throw new Error('測試用的場景卡服務不能移除參考圖')
      },
    },
    library: {
      list: () => ({ folder: '/tmp', projects: [] }),
      createNew: () => {
        throw new Error('測試用的專案清單不能開新專案')
      },
      pickFolder: () => Promise.resolve(undefined),
      saveAs: () => Promise.reject(new Error('測試用的專案清單不能另存')),
      recent: () => [],
      openRecent: () => {
        throw new Error('測試用的專案清單不能開專案')
      },
      forgetRecent: () => undefined,
      pickAndOpen: () => Promise.resolve(null),
      reveal: () => undefined,
    },
    history: {
      record: (_label, run) => run(),
      begin: () => () => undefined,
      beginAiTurn: () => () => undefined,
      clear: () => undefined,
      takeUserOps: () => [],
      state: () => ({ canUndo: false, canRedo: false }),
      undo: () => ({ applied: false, state: { canUndo: false, canRedo: false } }),
      redo: () => ({ applied: false, state: { canUndo: false, canRedo: false } }),
    },
    storyboard: {
      splitCheck: () => ({
        ok: false,
        issue: '測試用',
        estimatedUsd: 0,
        demoMode: false,
        existingShots: 0,
        generatedShots: 0,
      }),
      splitScene: () => Promise.reject(new Error('測試用的分鏡服務不能拆鏡頭')),
    },
    outline: {
      get: () => ({ acts: [], locations: [] }),
      edit: () => {
        throw new Error('測試用的大綱服務不能修改')
      },
      splitCheck: () => ({
        ok: false,
        issue: '測試用',
        estimatedUsd: 0,
        demoMode: false,
        replacesExisting: false,
      }),
      split: () => Promise.reject(new Error('測試用的大綱服務不能拆成分場')),
    },
    settings,
    settingsService: createSettingsService({
      store: settings,
      registry: new ModelRegistry(loadBuiltinModelCards()),
      keys,
    }),
    keyTester:
      keyTester ??
      ((provider) => {
        return Promise.resolve({ provider, valid: true })
      }),
  }
}
