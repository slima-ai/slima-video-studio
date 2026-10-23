import {
  copyProject,
  createProject,
  openProject,
  projectModifiedAt,
  readProjectFile,
  writeProjectFile,
  type ProjectHandle,
} from '@svs/db'
import { AppError, type ProjectInfo, type ProjectStatus, t } from '@svs/schema'

/** 目前開啟的專案。一次只開一個；開新的會先關掉舊的。 */
export class ProjectManager {
  private handle: ProjectHandle | undefined
  private readonly listeners = new Set<(handle: ProjectHandle | undefined) => void>()

  constructor(private readonly appVersion: string) {}

  create(dir: string, name: string): ProjectInfo {
    this.close()
    return this.adopt(createProject({ dir, name }, { appVersion: this.appVersion }))
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
    return {
      name: handle.repos.projects.get().name,
      dir: handle.dir,
      savedAt: projectModifiedAt(handle.dir).toISOString(),
      spentUsd: handle.repos.costs.totalUsd(handle.projectId, { excludeProviders: ['mock'] }),
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
