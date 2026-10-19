import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'

import { ASSET_SCHEME, parseAssetUrl } from './asset-url'
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

const plain = (status: number, body: string): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

/**
 * `svs-asset://<hash>`：只提供目前專案素材庫裡的檔案。
 * 檔案由雜湊在素材庫查出來，使用者輸入永遠不會變成檔案路徑。
 */
export function installAssetProtocol(projects: ProjectManager): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const parsed = parseAssetUrl(request.url)
    if (!parsed.ok) return plain(parsed.status, 'Bad Request')

    const asset = projects.current()?.assets.find(parsed.hash)
    if (!asset) return plain(404, 'Not Found')

    // 轉給檔案讀取（保留 Range 標頭，影片才能拖拉進度）
    const upstream = await net.fetch(pathToFileURL(asset.path).toString(), {
      headers: request.headers,
    })
    const headers = new Headers(upstream.headers)
    headers.set('content-type', asset.mime)
    headers.set('x-content-type-options', 'nosniff')
    // 內容雜湊定址：同一個網址的內容永遠不會變
    headers.set('cache-control', 'private, max-age=31536000, immutable')
    return new Response(upstream.body, { status: upstream.status, headers })
  })
}
