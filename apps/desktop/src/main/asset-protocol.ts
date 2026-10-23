import { protocol } from 'electron'
import { join } from 'node:path'

import { ASSET_SCHEME, EXPORT_HOST, parseAssetUrl, parseExportUrl } from './asset-url'
import { findExportFile } from './export-file'
import { serveFile } from './serve-file'
import type { ProjectManager } from './project-manager'

/** 必須在 app ready 之前呼叫。 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

const hostnameOf = (raw: string): string => {
  try {
    return new URL(raw).hostname
  } catch {
    return ''
  }
}

const plain = (status: number, body: string): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

/**
 * `svs-asset://asset/<hash>`：只提供目前專案素材庫裡的檔案；`svs-asset://export/<檔名>`：目前專案 exports/ 裡的成品影片。
 * 檔案由雜湊在素材庫查出來，使用者輸入永遠不會變成檔案路徑。
 */
export function installAssetProtocol(projects: ProjectManager): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    // 匯出的成品：`svs-asset://export/<檔名>`，只提供目前專案 exports/ 裡能播放的影片
    if (hostnameOf(request.url) === EXPORT_HOST) {
      const exported = parseExportUrl(request.url)
      if (!exported.ok) return plain(exported.status, 'Bad Request')
      const handle = projects.current()
      const file = handle && findExportFile(join(handle.dir, 'exports'), exported.name)
      if (!file) return plain(404, 'Not Found')
      // 同一個檔名可以被新的成品覆蓋：每次都問一次，不快取
      return serveFile(file.path, {
        mime: file.mime,
        cacheControl: 'no-cache',
        range: request.headers.get('range'),
      })
    }
    const parsed = parseAssetUrl(request.url)
    if (!parsed.ok) return plain(parsed.status, 'Bad Request')

    const asset = projects.current()?.assets.find(parsed.hash)
    if (!asset) return plain(404, 'Not Found')

    // 內容雜湊定址：同一個網址的內容永遠不會變。自己處理 Range（影片才能拖進度）
    return serveFile(asset.path, {
      mime: asset.mime,
      cacheControl: 'private, max-age=31536000, immutable',
      range: request.headers.get('range'),
    })
  })
}
