import type { ProjectHandle } from '@svs/db'
import type { SceneAnchor } from '@svs/workflows'

import { assetRefOf } from '../characters/anchors'

/**
 * 目前專案裡「已鎖定」場景卡的固定描述（草稿不算，要鎖定後才會帶進 Prompt），
 * 連同主場景圖與兩個角度（有的話，生首幀時會依鏡頭挑出來當參考圖）。
 */
export function lockedScenes(handle: ProjectHandle): SceneAnchor[] {
  return handle.repos.locationCards.listLocked().map((card): SceneAnchor => {
    const main = assetRefOf(handle, card.mainAssetHash)
    const reverse = assetRefOf(handle, card.angles.reverse)
    const wide = assetRefOf(handle, card.angles.wide)
    const images = {
      ...(main ? { main } : {}),
      ...(reverse ? { reverse } : {}),
      ...(wide ? { wide } : {}),
    }
    return {
      id: card.id,
      name: card.name,
      text: card.anchorText,
      ...(Object.keys(images).length > 0 ? { images } : {}),
    }
  })
}
