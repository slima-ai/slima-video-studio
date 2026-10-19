import {
  AppSettingsSchema,
  type AppSettings,
  type AppSettingsPatch,
  type PickableCapability,
} from '@svs/schema'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface SettingsStore {
  get: () => AppSettings
  update: (patch: AppSettingsPatch) => AppSettings
  /** 改 renderer 改不到的欄位（例如模型通知）；主行程內部用。 */
  setNotices: (notices: readonly string[]) => AppSettings
}

export interface SettingsStoreOptions {
  /** 設定檔路徑（通常在使用者資料夾裡）。 */
  file: string
  /** 檔案不存在時的初始值（例如測試模式略過引導）。 */
  initial?: Partial<AppSettings>
  warn?: (message: string) => void
}

/** 把局部更新套到目前設定上：models 逐項合併（null = 改回推薦），其他欄位整塊替換。 */
export function applyPatch(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  const models = { ...current.models }
  for (const [capability, id] of Object.entries(patch.models ?? {}) as [
    PickableCapability,
    string | null,
  ][]) {
    if (id === null) Reflect.deleteProperty(models, capability)
    else models[capability] = id
  }
  return AppSettingsSchema.parse({
    ...current,
    ...(patch.onboardingDone === undefined ? {} : { onboardingDone: patch.onboardingDone }),
    ...(patch.demoMode === undefined ? {} : { demoMode: patch.demoMode }),
    ...(patch.advancedMode === undefined ? {} : { advancedMode: patch.advancedMode }),
    ...(patch.theme === undefined ? {} : { theme: patch.theme }),
    ...(patch.budget === undefined ? {} : { budget: patch.budget }),
    ...(patch.storyboardGuide === undefined
      ? {}
      : { storyboardGuide: patch.storyboardGuide.trim() }),
    models,
  })
}

/**
 * 設定檔（JSON）。啟動時讀一次、之後的修改立刻寫回（先寫暫存檔再改名，不會寫到一半斷電就壞掉）。
 * 檔案損毀時改名備份、用預設值繼續，不讓 App 打不開。
 */
export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  const { file } = options
  const warn = options.warn ?? (() => undefined)

  const load = (): AppSettings => {
    const defaults = AppSettingsSchema.parse(options.initial ?? {})
    if (!existsSync(file)) return defaults
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
      return AppSettingsSchema.parse(raw)
    } catch (error) {
      const backup = `${file}.broken-${String(Date.now())}`
      try {
        renameSync(file, backup)
      } catch {
        // 備份失敗也不影響繼續使用預設值
      }
      warn(`設定檔無法讀取，已備份為 ${backup} 並改用預設值：${String(error)}`)
      return defaults
    }
  }

  let current = load()

  const save = (next: AppSettings): void => {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, file)
  }

  return {
    get: () => current,
    update: (patch) => {
      const next = applyPatch(current, patch)
      save(next)
      current = next
      return current
    },
    setNotices: (notices) => {
      const next = AppSettingsSchema.parse({ ...current, modelNotices: notices })
      save(next)
      current = next
      return current
    },
  }
}

/** 不寫檔的版本（測試與 E2E 以外的情境不該用）。 */
export function createMemorySettingsStore(initial: Partial<AppSettings> = {}): SettingsStore {
  let current = AppSettingsSchema.parse(initial)
  return {
    get: () => current,
    update: (patch) => {
      current = applyPatch(current, patch)
      return current
    },
    setNotices: (notices) => {
      current = AppSettingsSchema.parse({ ...current, modelNotices: notices })
      return current
    },
  }
}
