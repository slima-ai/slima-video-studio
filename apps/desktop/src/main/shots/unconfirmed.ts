import type { ProjectHandle } from '@svs/db'
import type { Shot, UnconfirmedLooks } from '@svs/schema'

import { lockedAnchors } from '../characters/anchors'

/**
 * 預告片專案：這次要生畫面的鏡頭，用到的角色與場景卡裡有幾個還沒鎖定（確認）。
 * 沒鎖定的長相不會帶進提示，每一鏡各畫各的；所以生畫面之前要提醒一次。
 * 只算這次要生畫面的鏡頭用到的（`pictureShots`）；一般專案（沒有預告片設定）、全部都鎖定了、或這次沒有要生畫面的鏡頭，回 undefined。
 */
export function unconfirmedOf(
  handle: ProjectHandle,
  pictureShots: readonly Shot[],
): UnconfirmedLooks | undefined {
  if (pictureShots.length === 0 || handle.repos.trailer.get() === undefined) return undefined
  const lockedNames = new Set(lockedAnchors(handle).map((anchor) => anchor.name))
  const names = new Set(
    pictureShots.flatMap((shot) => shot.characters.flatMap((c) => (c.name ? [c.name] : []))),
  )
  const lockedPlaces = new Set(handle.repos.locationCards.listLocked().map((card) => card.id))
  const places = new Set(
    pictureShots.flatMap((shot) => (shot.locationId === undefined ? [] : [shot.locationId])),
  )
  const characters = [...names].filter((name) => !lockedNames.has(name)).length
  const locations = [...places].filter((id) => !lockedPlaces.has(id)).length
  return characters + locations > 0 ? { characters, locations } : undefined
}
