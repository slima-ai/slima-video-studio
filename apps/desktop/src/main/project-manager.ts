import { createProject, openProject, type ProjectHandle } from '@svs/db'
import type { ProjectInfo } from '@svs/schema'

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

  current(): ProjectHandle | undefined {
    return this.handle
  }

  info(): ProjectInfo | null {
    return this.handle ? toInfo(this.handle) : null
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
