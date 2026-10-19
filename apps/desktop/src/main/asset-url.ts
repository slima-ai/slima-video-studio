import { ContentHashSchema } from '@svs/schema'

export const ASSET_SCHEME = 'svs-asset'
/** 固定的主機名稱。雜湊放在路徑，避免全數字的雜湊被瀏覽器當成 IPv4 位址改寫。 */
export const ASSET_HOST = 'asset'

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
