import { kindForMime, type ProjectHandle } from '@svs/db'
import { AppError, type AssetRef, type ProviderServices, t } from '@svs/schema'
import type { MediaTools } from '@svs/media'
import { readFile } from 'node:fs/promises'

import { measureVideoAsset } from './shots/measure-videos'

/** 把專案的素材庫接成供應商 adapter 用的讀寫介面。 */
export function createProviderServices(
  handle: ProjectHandle,
  tools?: MediaTools,
): ProviderServices {
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
        const kind = kindForMime(mime)
        // 影片存進來就量實際長度（供應商回報的是要求的秒數，不是檔案的長度）
        const measured =
          kind === 'video' && tools && stored.created
            ? await measureVideoAsset(handle, tools, stored.hash)
            : undefined
        return {
          hash: stored.hash,
          kind,
          mime,
          bytes: stored.bytes,
          ...meta,
          ...measured,
        }
      },
    },
  }
}
