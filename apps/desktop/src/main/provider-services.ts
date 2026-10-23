import { kindForMime, type ProjectHandle } from '@svs/db'
import { AppError, type AssetRef, type ProviderServices, t } from '@svs/schema'
import { readFile } from 'node:fs/promises'

/** 把專案的素材庫接成供應商 adapter 用的讀寫介面。 */
export function createProviderServices(handle: ProjectHandle): ProviderServices {
  const { assets } = handle
  return {
    assets: {
      read: async (hash) => {
        const found = assets.find(hash)
        if (!found) {
          throw new AppError({
            code: 'invalid_request',
            userMessage: t('services.canTFindTheReference'),
          })
        }
        return new Uint8Array(await readFile(found.path))
      },
      put: async (bytes, mime, meta = {}): Promise<AssetRef> => {
        const stored = await assets.put(bytes, mime, meta)
        return {
          hash: stored.hash,
          kind: kindForMime(mime),
          mime,
          bytes: stored.bytes,
          ...meta,
        }
      },
    },
  }
}
