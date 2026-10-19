import type { ProjectHandle } from '@svs/db'
import {
  AppError,
  type ExportEntry,
  type FileEntry,
  type FileRevealRequest,
  type FilesFilter,
  type FilesSnapshot,
} from '@svs/schema'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectManager } from '../project-manager'
import type { ShotService } from '../shots/shot-service'

export interface FilesServiceDeps {
  projects: ProjectManager
  shots: Pick<ShotService, 'finalVideoHash'>
  /** 在檔案總管（Finder）裡顯示這個檔案。 */
  reveal: (path: string) => void
}

export interface FilesService {
  list: (filter: FilesFilter) => FilesSnapshot
  reveal: (request: FileRevealRequest) => void
}

const EMPTY: FilesSnapshot = { files: [], exports: [], totalBytes: 0 }

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

const TAKE_LABEL = { first_frame: '第一張畫面', video: '影片' } as const

/** 每個檔案被用在哪裡（白話）：鏡頭的版本、角色的概念圖與三視圖、場景卡的概念圖、成品影片。 */
function usageOf(handle: ProjectHandle, finalVideoHash: string | undefined): Map<string, string[]> {
  const usage = new Map<string, string[]>()
  const add = (hash: string, label: string): void => {
    const list = usage.get(hash) ?? []
    if (!list.includes(label)) list.push(label)
    usage.set(hash, list)
  }
  const { shots, characters, locationCards } = handle.repos
  for (const shot of shots.list()) {
    for (const take of shots.listTakes(shot.id)) {
      const kind = take.kind === 'video' ? TAKE_LABEL.video : TAKE_LABEL.first_frame
      add(
        take.assetHash,
        `第 ${String(shot.number)} 鏡・${kind} v${String(take.version)}${take.adopted ? '（採用中）' : ''}`,
      )
    }
  }
  for (const character of characters.list()) {
    for (const concept of characters.listConcepts(character.id)) {
      add(concept.assetHash, `角色 ${character.name}・概念圖`)
    }
    for (const t of characters.listTurnarounds(character.id)) {
      add(t.sheetHash, `角色 ${character.name}・三視圖設定稿`)
      add(t.frontHash, `角色 ${character.name}・正面`)
      add(t.sideHash, `角色 ${character.name}・側面`)
      add(t.backHash, `角色 ${character.name}・背面`)
    }
  }
  for (const card of locationCards.list()) {
    for (const concept of locationCards.listConcepts(card.id)) {
      add(concept.assetHash, `場景卡 ${card.name}・概念圖`)
    }
  }
  if (finalVideoHash) add(finalVideoHash, '接好的成品影片')
  return usage
}

function exportsOf(handle: ProjectHandle): ExportEntry[] {
  const dir = join(handle.dir, 'exports')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith('.'))
    .map((d) => {
      const path = join(dir, d.name)
      const stat = statSync(path)
      return { name: d.name, path, bytes: stat.size, modifiedAt: stat.mtime.toISOString() }
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export function createFilesService(deps: FilesServiceDeps): FilesService {
  const current = (): ProjectHandle | undefined => {
    const handle = deps.projects.current()
    return handle && !handle.closed ? handle : undefined
  }

  return {
    list(filter) {
      const handle = current()
      if (!handle) return EMPTY
      const usage = usageOf(handle, deps.shots.finalVideoHash())
      const files: FileEntry[] = []
      for (const asset of handle.assets.list()) {
        if (asset.kind !== 'image' && asset.kind !== 'video') continue
        if (filter.kind && asset.kind !== filter.kind) continue
        const usedBy = usage.get(asset.hash) ?? []
        if (filter.unusedOnly && usedBy.length > 0) continue
        const path = handle.assets.locate(asset.hash)
        if (!path) continue
        files.push({ ...asset, path, usedBy })
      }
      return {
        files,
        exports: exportsOf(handle),
        totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
        projectDir: handle.dir,
      }
    },

    reveal(request) {
      const handle = current()
      if (!handle) throw invalid('請先開啟或建立一個專案。')
      if ('hash' in request) {
        const path = handle.assets.locate(request.hash)
        if (!path) throw invalid('找不到這個檔案，可能已被刪除。')
        deps.reveal(path)
        return
      }
      // 只接受 exports 資料夾裡的檔名，不接受路徑
      const found = exportsOf(handle).find((e) => e.name === request.exportName)
      if (!found) throw invalid('找不到這個匯出的檔案，可能已被刪除或搬走。')
      deps.reveal(found.path)
    },
  }
}
