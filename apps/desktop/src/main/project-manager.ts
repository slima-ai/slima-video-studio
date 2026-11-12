import {
  copyProject,
  createProject,
  openProject,
  projectModifiedAt,
  readProjectFile,
  writeProjectFile,
  type ProjectHandle,
} from '@svs/db'
import { AppError, CARRIED_OVER_RUN_ID, type ProjectInfo, type ProjectStatus, t } from '@svs/schema'

import type { AppSpendLedger } from './costs/app-ledger'

/** 目前開啟的專案。一次只開一個；開新的會先關掉舊的。 */
export class ProjectManager {
  private handle: ProjectHandle | undefined
  private readonly listeners = new Set<(handle: ProjectHandle | undefined) => void>()

  /**
   * `appLedger`：App 層的花費帳本（專案不在了、錢還是花了的那些）。「下一個建出來的專案」
   * （不管從哪個入口建）把還沒移走的錢移進自己的帳本，算一次「已花」與花費上限；開舊專案、另存為不領。
   */
  constructor(
    private readonly appVersion: string,
    private readonly appLedger?: AppSpendLedger,
  ) {}

  create(dir: string, name: string): ProjectInfo {
    this.close()
    const handle = createProject({ dir, name }, { appVersion: this.appVersion })
    this.carryOver(handle)
    return this.adopt(handle)
  }

  /**
   * App 層帳本裡還沒移走的錢，記進這個新專案的帳本（標上 `CARRIED_OVER_RUN_ID`），再把帳本那幾筆標成已移。
   * 先記進專案、再標已移：中間斷掉最多是重複算一次，不會讓錢消失。
   */
  private carryOver(handle: ProjectHandle): void {
    const { appLedger } = this
    if (!appLedger) return
    const pending = appLedger.pending()
    if (pending.length === 0) return
    for (const entry of pending) {
      handle.repos.costs.record({
        projectId: handle.projectId,
        runId: CARRIED_OVER_RUN_ID,
        provider: entry.provider,
        modelId: entry.modelId,
        amountUsd: entry.amountUsd,
        estimated: false,
        ...(entry.jobId === undefined ? {} : { jobId: entry.jobId }),
      })
    }
    appLedger.markMoved(
      pending.map((e) => e.id),
      handle.projectId,
    )
  }

  open(dir: string): ProjectInfo {
    // 重新開啟「目前這個」專案時要先放掉自己的鎖
    this.close()
    return this.adopt(openProject(dir, { appVersion: this.appVersion }))
  }

  /**
   * 另存為：把開著的專案（含素材）複製到 `destDir`，改名，然後切過去開那一份。
   * 原本的專案原封不動留在原處；複製失敗就什麼都沒變（目前專案照開）。
   */
  async saveAs(destDir: string, name: string): Promise<ProjectInfo> {
    const { handle } = this
    if (!handle) {
      throw new AppError({
        code: 'project_not_found',
        userMessage: t('projects.openOrCreateAProject'),
      })
    }
    await copyProject(handle, destDir, { name, env: { appVersion: this.appVersion } })
    return this.open(destDir)
  }

  current(): ProjectHandle | undefined {
    return this.handle
  }

  info(): ProjectInfo | null {
    return this.handle ? toInfo(this.handle) : null
  }

  /** 改目前專案的名字：資料庫和 project.json 各存了一份，兩份一起改（資料夾的名字不變）。 */
  rename(name: string): ProjectInfo {
    const { handle } = this
    if (!handle) {
      throw new AppError({
        code: 'project_not_found',
        userMessage: t('projects.openOrCreateAProject'),
      })
    }
    handle.repos.projects.update({ name })
    writeProjectFile(handle.dir, { ...readProjectFile(handle.dir), name })
    return toInfo(handle)
  }

  /** 上方專案列用：名字、最後一次寫入的時間、花費（示範模式的假結果不算）。沒開專案是 null。 */
  status(): ProjectStatus | null {
    const { handle } = this
    if (!handle) return null
    // 示範模式的假結果不算；其中「之前沒做成、移進來的」那一份另外標出來（標題列說明用）
    const carried = handle.repos.costs.totalUsd(handle.projectId, {
      runId: CARRIED_OVER_RUN_ID,
      excludeProviders: ['mock'],
    })
    return {
      name: handle.repos.projects.get().name,
      dir: handle.dir,
      savedAt: projectModifiedAt(handle.dir).toISOString(),
      spentUsd: handle.repos.costs.totalUsd(handle.projectId, { excludeProviders: ['mock'] }),
      ...(carried > 0 ? { discardedSpentUsd: carried } : {}),
    }
  }

  /** 專案開啟、關閉或換掉時通知（開啟時帶 handle，關閉時是 undefined）。回傳取消訂閱函式。 */
  onChange(listener: (handle: ProjectHandle | undefined) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  close(): void {
    const { handle } = this
    if (!handle) return
    // 先通知（讓任務佇列停下來），再關資料庫
    this.handle = undefined
    this.notify(undefined)
    handle.close()
  }

  private adopt(handle: ProjectHandle): ProjectInfo {
    this.handle = handle
    this.notify(handle)
    return toInfo(handle)
  }

  private notify(handle: ProjectHandle | undefined): void {
    for (const listener of this.listeners) listener(handle)
  }
}

function toInfo(handle: ProjectHandle): ProjectInfo {
  const project = handle.repos.projects.get()
  return {
    id: project.id,
    name: project.name,
    dir: handle.dir,
    aspectRatio: project.aspectRatio,
  }
}
