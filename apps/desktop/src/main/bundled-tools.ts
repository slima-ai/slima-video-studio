import { resolveTools, type MediaTools } from '@svs/media'
import ffmpegStatic from 'ffmpeg-static'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** 打包後 node_modules 在 app.asar 裡，但執行檔必須放在 app.asar.unpacked 才跑得起來。 */
export function unpackedPath(path: string): string {
  return path.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
}

/**
 * 安裝包自己帶的 FFmpeg 放在 `<resources>/ffmpeg/`（`tools/ffmpeg/build-macos.sh` 編的，GPL、沒有 nonfree，
 * 附授權全文與原始碼說明）。開發環境沒有 resources 路徑，回傳 undefined。
 */
export function bundledFfmpegPath(
  resourcesPath: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (resourcesPath === undefined) return undefined
  return join(resourcesPath, 'ffmpeg', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

/**
 * 找 FFmpeg：環境變數 SVS_FFMPEG 優先；其次是安裝包自己帶的（resources/ffmpeg）；再來是 ffmpeg-static
 * （開發環境與還沒換成自己編的平台）；最後才用系統 PATH 上的 ffmpeg。內建版沒有 ffprobe，影片資訊改由 ffmpeg 讀。
 *
 * 為什麼 resources 的優先於 ffmpeg-static：ffmpeg-static 下載的 macOS 版是用 --enable-nonfree 編的，不能再散布。
 */
export function locateTools(
  bundled: string | null = ffmpegStatic,
  exists: (path: string) => boolean = existsSync,
  env: Readonly<Record<string, string | undefined>> = process.env,
  resourcesPath: string | undefined = (process as { resourcesPath?: string }).resourcesPath,
  platform: NodeJS.Platform = process.platform,
): MediaTools {
  const own = bundledFfmpegPath(resourcesPath, platform)
  if (own !== undefined && exists(own)) {
    return resolveTools({ ffmpegPath: own, ffprobePath: null }, env)
  }
  const path = bundled === null ? undefined : unpackedPath(bundled)
  if (path !== undefined && exists(path)) {
    return resolveTools({ ffmpegPath: path, ffprobePath: null }, env)
  }
  return resolveTools({}, env)
}
