import { readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

/** 能在 App 裡播放的成品副檔名 → MIME。 */
const PLAYABLE: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
}

export const isPlayableExport = (name: string): boolean => extname(name).toLowerCase() in PLAYABLE

/**
 * 在專案的 exports/ 資料夾裡找這個檔名：檔名一定要是資料夾列表裡的一個檔案（不是用檔名組路徑去猜），
 * 而且是能播放的影片。找不到、是資料夾、不能播的都回 undefined。
 */
export function findExportFile(
  exportsDir: string,
  name: string,
): { path: string; mime: string } | undefined {
  let entries
  try {
    entries = readdirSync(exportsDir, { withFileTypes: true })
  } catch {
    return undefined
  }
  const hit = entries.find((d) => d.isFile() && !d.name.startsWith('.') && d.name === name)
  const mime = hit ? PLAYABLE[extname(hit.name).toLowerCase()] : undefined
  return hit && mime ? { path: join(exportsDir, hit.name), mime } : undefined
}
