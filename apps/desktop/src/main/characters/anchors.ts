import type { ProjectHandle } from '@svs/db'
import type { ModelRegistry } from '@svs/providers'
import type { AssetRef } from '@svs/schema'
import type { CharacterAnchor, CharacterAvoid, SceneAnchor } from '@svs/workflows'

import type { SettingsService } from '../settings/model-service'

/** 素材的描述資料（雜湊、種類、大小）；找不到素材檔就是 undefined。 */
export function assetRefOf(
  handle: ProjectHandle,
  hash: string | undefined,
  kind: AssetRef['kind'] = 'image',
): AssetRef | undefined {
  const meta = hash ? handle.assets.getMeta(hash) : undefined
  return meta
    ? {
        hash: meta.hash,
        kind,
        mime: meta.mime,
        bytes: meta.bytes,
        ...(meta.width ? { width: meta.width } : {}),
        ...(meta.height ? { height: meta.height } : {}),
      }
    : undefined
}

/**
 * 目前專案裡各角色的「不要出現的特徵」（只列有寫的；不管角色有沒有鎖定）：
 * 生影片時，出場角色的清單會併進負面提示。
 */
export function avoidsOf(handle: ProjectHandle): CharacterAvoid[] {
  return handle.repos.characters
    .list()
    .filter((character) => character.avoid.trim() !== '')
    .map((character) => ({ name: character.name, avoid: character.avoid.trim() }))
}

/**
 * 目前專案裡「已鎖定」角色的固定外觀描述（草稿不算，要鎖定後才會帶進 Prompt），
 * 連同鎖定那一版的版本號、主圖、三視圖與另外加的參考圖（有的話，生首幀時會依鏡頭挑出來當參考圖）。
 */
export function lockedAnchors(handle: ProjectHandle): CharacterAnchor[] {
  const { characters } = handle.repos
  return characters.list().flatMap((character): CharacterAnchor[] => {
    const pack = characters.pack(character.id)
    if (pack?.status !== 'locked' || pack.anchorText.trim() === '') return []
    const hero = assetRefOf(handle, pack.heroAssetHash)
    const front = assetRefOf(handle, pack.turnaround?.front)
    const side = assetRefOf(handle, pack.turnaround?.side)
    const back = assetRefOf(handle, pack.turnaround?.back)
    // 另外加的參考圖（依加的順序）；檔案不在的略過
    const references = characters.listReferences(character.id).flatMap((reference) => {
      const ref = assetRefOf(handle, reference.assetHash)
      return ref ? [{ purpose: reference.purpose, ref }] : []
    })
    const images = {
      ...(hero ? { hero } : {}),
      ...(front ? { front } : {}),
      ...(side ? { side } : {}),
      ...(back ? { back } : {}),
      ...(references.length > 0 ? { references } : {}),
    }
    return [
      {
        name: character.name,
        text: pack.anchorText,
        version: pack.version,
        ...(Object.keys(images).length > 0 ? { images } : {}),
      },
    ]
  })
}

/** 一張鏡頭最多帶幾張角色參考圖（正面、側面、背面再加主圖，夠用就好）。 */
const MAX_REFERENCES = 4

/**
 * 選「帶參考圖編輯」用的圖片模型：優先用設定裡選的圖片模型（做得到編輯的話），否則換一個做得到的。
 * 沒有做得到編輯的模型（或它不收參考圖）就回傳 undefined。
 */
export function pickEditModel(
  settingsService: Pick<SettingsService, 'resolveModel' | 'listModels'>,
  models: Pick<ModelRegistry, 'get'>,
): { id: string; referenceLimit: number } | undefined {
  const preferred = settingsService.resolveModel('t2i')
  const id =
    preferred && models.get(preferred)?.capabilities.includes('edit')
      ? preferred
      : settingsService.listModels().models.find((option) => option.capabilities.includes('edit'))
          ?.id
  if (!id) return undefined
  const referenceLimit = Math.min(models.get(id)?.referenceLimits?.images ?? 3, MAX_REFERENCES)
  return referenceLimit > 0 ? { id, referenceLimit } : undefined
}

/** 有任何已鎖定的角色或場景帶著參考圖，才需要換成編輯模型。 */
export function referenceEditModel(
  anchors: readonly CharacterAnchor[],
  settingsService: Pick<SettingsService, 'resolveModel' | 'listModels'>,
  models: Pick<ModelRegistry, 'get'>,
  scenes: readonly SceneAnchor[] = [],
): { id: string; referenceLimit: number } | undefined {
  return anchors.some((anchor) => anchor.images) || scenes.some((scene) => scene.images)
    ? pickEditModel(settingsService, models)
    : undefined
}
