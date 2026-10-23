import { ContentHashSchema } from '@svs/schema'

export const ASSET_SCHEME = 'svs-asset'
/** 固定的主機名稱。雜湊放在路徑，避免全數字的雜湊被瀏覽器當成 IPv4 位址改寫。 */
export const ASSET_HOST = 'asset'

/** 匯出的成品（專案資料夾 exports/ 裡的檔案）用另一個固定主機名稱：`svs-asset://export/<檔名>`。 */
export const EXPORT_HOST = 'export'

export function assetUrl(hash: string): string {
  return `${ASSET_SCHEME}://${ASSET_HOST}/${hash}`
}

export type ParsedAssetUrl = { ok: true; hash: string } | { ok: false; status: 400 }

/**
 * 只接受 `svs-asset://asset/<64 碼小寫 sha256>`（可以帶 ? 或 #）。
 * 子目錄、`..`、編碼過的斜線、副檔名、大寫雜湊、帳號密碼、連接埠、其他主機名稱一律拒絕。
 */
export function parseAssetUrl(raw: string): ParsedAssetUrl {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, status: 400 }
  }
  if (
    url.protocol !== `${ASSET_SCHEME}:` ||
    url.hostname !== ASSET_HOST ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    !url.pathname.startsWith('/')
  ) {
    return { ok: false, status: 400 }
  }
  const hash = ContentHashSchema.safeParse(url.pathname.slice(1))
  return hash.success ? { ok: true, hash: hash.data } : { ok: false, status: 400 }
}

export type ParsedExportUrl = { ok: true; name: string } | { ok: false; status: 400 }

/**
 * `svs-asset://export/<檔名>`（檔名要 encodeURIComponent）。只看形狀：檔名不能是空的、`.` 開頭、
 * 含斜線、反斜線、控制字元；帳號密碼、連接埠、其他主機名稱一律拒絕。檔案是不是真的在 exports/ 裡
 * 由 findExportFile 再用資料夾列表核對，檔名永遠不會直接接成路徑。
 */
export function parseExportUrl(raw: string): ParsedExportUrl {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, status: 400 }
  }
  if (
    url.protocol !== `${ASSET_SCHEME}:` ||
    url.hostname !== EXPORT_HOST ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    !url.pathname.startsWith('/')
  ) {
    return { ok: false, status: 400 }
  }
  let name: string
  try {
    name = decodeURIComponent(url.pathname.slice(1))
  } catch {
    return { ok: false, status: 400 }
  }
  // eslint-disable-next-line no-control-regex -- 檔名裡不能有控制字元（含 NUL）
  if (name === '' || name.startsWith('.') || /[\\/\u0000-\u001f]/.test(name)) {
    return { ok: false, status: 400 }
  }
  return { ok: true, name }
}
