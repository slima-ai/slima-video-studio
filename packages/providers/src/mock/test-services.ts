import type { AssetKind, AssetRef, ProviderServices } from '@svs/schema'
import { createHash } from 'node:crypto'

/** 測試用的記憶體素材庫（內容雜湊與正式版一致）。 */
export function memoryServices(): ProviderServices & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    assets: {
      read: (hash) => {
        const bytes = files.get(hash)
        return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`Asset ${hash} not found`))
      },
      put: (bytes, mime, meta = {}) => {
        const hash = createHash('sha256').update(bytes).digest('hex')
        files.set(hash, bytes)
        const kind: AssetKind = mime.startsWith('image/')
          ? 'image'
          : mime.startsWith('video/')
            ? 'video'
            : mime.startsWith('audio/')
              ? 'audio'
              : 'other'
        const ref: AssetRef = { hash, kind, mime, bytes: bytes.length, ...meta }
        return Promise.resolve(ref)
      },
    },
  }
}
