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
    // 另外加的參考圖：俯視圖、有縱深感的環境圖（各取最早加的一張）；另外加的主景、反方向、拉遠全景，
    // 只在場景卡本來那一張缺的時候頂替
    const added = handle.repos.locationCards
      .listReferences(card.id)
      .filter((reference) => reference.source === 'added')
    const firstOf = (purpose: string) =>
      assetRefOf(handle, added.find((reference) => reference.purpose === purpose)?.assetHash)
    const mainRef = main ?? firstOf('main')
    const reverseRef = reverse ?? firstOf('reverse')
    const wideRef = wide ?? firstOf('wide')
    const topDown = firstOf('top_down')
    const depth = firstOf('depth')
    const images = {
      ...(mainRef ? { main: mainRef } : {}),
      ...(reverseRef ? { reverse: reverseRef } : {}),
      ...(wideRef ? { wide: wideRef } : {}),
      ...(topDown ? { topDown } : {}),
      ...(depth ? { depth } : {}),
    }
    return {
      id: card.id,
      name: card.name,
      text: card.anchorText,
      ...(Object.keys(images).length > 0 ? { images } : {}),
    }
  })
}
