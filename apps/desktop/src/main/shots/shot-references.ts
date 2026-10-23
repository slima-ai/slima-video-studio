import type { ProjectHandle } from '@svs/db'
import {
  CHARACTER_REFERENCE_PURPOSE_LABELS,
  LOCATION_REFERENCE_PURPOSE_LABELS,
  type AssetRef,
  type Shot,
  type ShotReferenceItem,
  type ShotReferencesState,
  t,
} from '@svs/schema'
import {
  pickReferences,
  type CharacterAnchor,
  type SceneAnchor,
  type ShotItem,
} from '@svs/workflows'

import { assetRefOf } from '../characters/anchors'

/** 圖檔存不存在（參考圖要真的有檔案才帶得進去）。 */
const exists = (handle: ProjectHandle, hash: string | undefined): hash is string =>
  hash !== undefined && handle.assets.getMeta(hash) !== undefined

/** 這一鏡的地點：鏡頭自己指定的，沒有就看它所在的場。 */
function locationIdOf(handle: ProjectHandle, shot: Shot): string | undefined {
  if (shot.locationId) return shot.locationId
  return shot.sceneId
    ? handle.repos.outline.listScenes().find((scene) => scene.id === shot.sceneId)?.locationId
    : undefined
}

/**
 * 這一鏡可以挑的參考圖：出場角色的主圖、三視圖、另外加的參考圖，加上這一鏡地點的主景、角度與另外加的參考圖。
 * 同一張圖只出現一次（先出現的算）。不看角色或場景卡有沒有鎖定：要不要用是使用者的決定。
 */
export function referenceCandidates(handle: ProjectHandle, shot: Shot): ShotReferenceItem[] {
  const { characters, locationCards } = handle.repos
  const items: ShotReferenceItem[] = []
  const seen = new Set<string>()
  const add = (item: ShotReferenceItem): void => {
    if (!exists(handle, item.assetHash) || seen.has(item.assetHash)) return
    seen.add(item.assetHash)
    items.push(item)
  }
  const people = characters.list()
  for (const appearance of shot.characters) {
    // 有 id 先用 id 對，沒有（或對不上）再用名字
    const person =
      people.find((c) => appearance.characterId !== undefined && c.id === appearance.characterId) ??
      people.find((c) => c.name === appearance.name)
    if (!person) continue
    const pack = characters.pack(person.id)
    const own = (hash: string | undefined, purpose: string): void => {
      if (hash) {
        add({ assetHash: hash, ownerKind: 'character', ownerName: person.name, purpose, label: '' })
      }
    }
    own(pack?.heroAssetHash, t('services.mainPicture'))
    own(pack?.turnaround?.front, t('services.front'))
    own(pack?.turnaround?.side, t('services.side'))
    own(pack?.turnaround?.back, t('services.back'))
    for (const reference of characters.listReferences(person.id)) {
      add({
        assetHash: reference.assetHash,
        ownerKind: 'character',
        ownerName: person.name,
        purpose: CHARACTER_REFERENCE_PURPOSE_LABELS[reference.purpose],
        label: reference.label,
      })
    }
  }
  const locationId = locationIdOf(handle, shot)
  const card = locationId === undefined ? undefined : locationCards.get(locationId)
  if (card) {
    for (const reference of locationCards.listReferences(card.id)) {
      add({
        assetHash: reference.assetHash,
        ownerKind: 'location',
        ownerName: card.name,
        purpose: LOCATION_REFERENCE_PURPOSE_LABELS[reference.purpose],
        label: reference.label,
      })
    }
  }
  return items
}

export interface ReferencePlanInput {
  handle: ProjectHandle
  shot: Shot
  /** 鏡頭的內容（自動挑的時候依景別與角度）。 */
  item: ShotItem
  /** 目前的圖片模型最多收幾張；0＝不會帶參考圖。 */
  limit: number
  reason?: string | undefined
  anchors: readonly CharacterAnchor[]
  scenes: readonly SceneAnchor[]
}

/**
 * 這一鏡的參考圖現況。生成時送出的跟這裡的 picked 是同一份：有手動指定（而且指定的圖還在清單裡）
 * 就只帶指定的，否則照景別與角度自動挑。
 */
export function referencePlan(input: ReferencePlanInput): ShotReferencesState {
  const { handle, shot, item, limit, anchors, scenes } = input
  const candidates = referenceCandidates(handle, shot)
  const byHash = new Map(candidates.map((candidate) => [candidate.assetHash, candidate]))
  const pinned = handle.repos.shots
    .listPins(shot.id)
    .flatMap((hash) => byHash.get(hash) ?? [])
    .slice(0, limit)
  const auto = pinned.length === 0
  const picked = auto
    ? pickReferences(item, anchors, limit, scenes).flatMap((ref) => byHash.get(ref.hash) ?? [])
    : pinned
  return {
    shotId: shot.id,
    limit,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    auto,
    picked,
    candidates,
  }
}

/** 手動指定的參考圖要交給工作流：圖檔資料加上給圖片模型看的說明（「阿鐵的臉」）。自動挑就是空的。 */
export function pinnedForFlow(
  handle: ProjectHandle,
  plan: ShotReferencesState,
): { ref: AssetRef; name: string }[] {
  if (plan.auto) return []
  return plan.picked.flatMap((item) => {
    const ref = assetRefOf(handle, item.assetHash)
    return ref
      ? [{ ref, name: t('services.text', { ownerName: item.ownerName, purpose: item.purpose }) }]
      : []
  })
}
