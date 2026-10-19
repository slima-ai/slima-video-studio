import { AppError, type CanvasLink, type CanvasRemove, type CanvasRemoveResult } from '@svs/schema'

import type { CharacterService } from '../characters/character-service'
import type { OutlineService } from '../outline/outline-service'
import type { ShotService } from '../shots/shot-service'

export interface CanvasLinkerDeps {
  shots: Pick<ShotService, 'list' | 'update' | 'remove' | 'clearAdopted'>
  outline: Pick<OutlineService, 'get' | 'edit'>
  characters: Pick<CharacterService, 'list' | 'remove'>
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/** 節點鍵 `prefix:<id>` 的 id；不是這種鍵（或是 `shot:<id>:image` 這種虛擬節點）就是 undefined。 */
const idOf = (key: string, prefix: string): string | undefined => {
  if (!key.startsWith(`${prefix}:`)) return undefined
  const id = key.slice(prefix.length + 1)
  return id === '' || id.includes(':') ? undefined : id
}

type Relation =
  | { kind: 'character'; characterId: string; shotId: string }
  | { kind: 'shotLocation'; locationId: string; shotId: string }
  | { kind: 'sceneLocation'; locationId: string; sceneId: string }

/** 這條線代表哪一種資料關係；不是能接或能剪的線就丟白話錯誤。 */
function relationOf({ source, target }: CanvasLink): Relation {
  if (source.port === 'char-out' && target.port === 'shot-ref-char') {
    const characterId = idOf(source.key, 'character')
    const shotId = idOf(target.key, 'shot')
    if (characterId !== undefined && shotId !== undefined) {
      return { kind: 'character', characterId, shotId }
    }
  }
  if (source.port === 'loc-out' && target.port === 'shot-ref-loc') {
    const locationId = idOf(source.key, 'location')
    const shotId = idOf(target.key, 'shot')
    if (locationId !== undefined && shotId !== undefined) {
      return { kind: 'shotLocation', locationId, shotId }
    }
  }
  if (source.port === 'loc-out' && target.port === 'scene-loc') {
    const locationId = idOf(source.key, 'location')
    const sceneId = idOf(target.key, 'scene')
    if (locationId !== undefined && sceneId !== undefined) {
      return { kind: 'sceneLocation', locationId, sceneId }
    }
  }
  throw invalid('這裡接不起來：角色可以接到鏡頭，地點可以接到場或鏡頭。')
}

/**
 * 在畫布上拉線、剪線與刪除節點：全部寫回原本的表（沿用各服務的規則）。
 * 要記進復原歷史，所以由呼叫的地方包在 history.record 裡。
 */
export function createCanvasLinker(deps: CanvasLinkerDeps): {
  link: (request: CanvasLink) => void
  unlink: (request: CanvasLink) => void
  remove: (request: CanvasRemove) => CanvasRemoveResult
} {
  const { shots, outline, characters } = deps

  const shotOf = (shotId: string) => {
    const shot = shots.list().shots.find((s) => s.id === shotId)
    if (!shot) throw invalid('找不到這個鏡頭。')
    return shot
  }
  const sceneOf = (sceneId: string) => {
    const scene = outline
      .get()
      .acts.flatMap((a) => a.scenes)
      .find((s) => s.id === sceneId)
    if (!scene) throw invalid('找不到這個場。')
    return scene
  }
  const characterOf = (characterId: string) => {
    const character = characters.list().find((c) => c.id === characterId)
    if (!character) throw invalid('找不到這個角色。')
    return character
  }
  const requireLocation = (locationId: string): void => {
    if (!outline.get().locations.some((l) => l.id === locationId)) {
      throw invalid('找不到這個地點。')
    }
  }

  return {
    link(request) {
      const relation = relationOf(request)
      if (relation.kind === 'character') {
        const character = characterOf(relation.characterId)
        const shot = shotOf(relation.shotId)
        if (shot.characters.includes(character.name)) {
          throw invalid(`${character.name}已經在這一鏡。`)
        }
        shots.update(shot.id, { characters: [...shot.characters, character.name] })
      } else if (relation.kind === 'shotLocation') {
        requireLocation(relation.locationId)
        const shot = shotOf(relation.shotId)
        if (shot.locationId === relation.locationId) throw invalid('這兩個已經接在一起了。')
        if (shot.locationId !== undefined) throw invalid('這一鏡已經有地點了，先剪掉原本的線。')
        shots.update(shot.id, { locationId: relation.locationId })
      } else {
        requireLocation(relation.locationId)
        const scene = sceneOf(relation.sceneId)
        if (scene.locationId === relation.locationId) throw invalid('這兩個已經接在一起了。')
        if (scene.locationId !== undefined) throw invalid('這一場已經有地點了，先剪掉原本的線。')
        outline.edit({
          op: 'updateScene',
          sceneId: scene.id,
          patch: { locationId: relation.locationId },
        })
      }
    },

    unlink(request) {
      const relation = relationOf(request)
      if (relation.kind === 'character') {
        const character = characterOf(relation.characterId)
        const shot = shotOf(relation.shotId)
        shots.update(shot.id, { characters: shot.characters.filter((n) => n !== character.name) })
      } else if (relation.kind === 'shotLocation') {
        const shot = shotOf(relation.shotId)
        if (shot.locationId === relation.locationId) shots.update(shot.id, { locationId: null })
      } else {
        const scene = sceneOf(relation.sceneId)
        if (scene.locationId === relation.locationId) {
          outline.edit({
            op: 'updateScene',
            sceneId: scene.id,
            patch: { locationId: null },
          })
        }
      }
    },

    remove({ keys }) {
      const shotIds = new Set<string>()
      const sceneIds: string[] = []
      const locationIds: string[] = []
      const characterIds: string[] = []
      const clears: { shotId: string; kind: 'image' | 'video' }[] = []
      for (const key of new Set(keys)) {
        const shotId = idOf(key, 'shot')
        const sceneId = idOf(key, 'scene')
        const locationId = idOf(key, 'location')
        const characterId = idOf(key, 'character')
        if (shotId !== undefined) shotIds.add(shotId)
        else if (sceneId !== undefined) sceneIds.push(sceneId)
        else if (locationId !== undefined) locationIds.push(locationId)
        else if (characterId !== undefined) characterIds.push(characterId)
        else {
          const derived = /^shot:([^:]+):(image|video)$/.exec(key)
          if (!derived?.[1] || !derived[2]) throw invalid('這一格不能刪除。')
          clears.push({ shotId: derived[1], kind: derived[2] === 'image' ? 'image' : 'video' })
        }
      }
      // 圖或影片：清掉這一鏡採用中的版本（版本還在生成紀錄裡）；整個鏡頭也要刪的就不用
      const cleared = clears.filter((c) => !shotIds.has(c.shotId))
      for (const c of cleared) shotOf(c.shotId)
      // 先確認都還在，免得刪到一半才發現有一個找不到
      for (const id of shotIds) shotOf(id)
      for (const id of sceneIds) sceneOf(id)
      for (const id of locationIds) requireLocation(id)
      for (const id of characterIds) characterOf(id)
      for (const c of cleared) shots.clearAdopted(c.shotId, c.kind)
      if (shotIds.size > 0) shots.remove([...shotIds])
      for (const sceneId of sceneIds) outline.edit({ op: 'deleteScene', sceneId })
      for (const locationId of locationIds) outline.edit({ op: 'deleteLocation', locationId })
      // 刪角色：出場的鏡頭一起拿掉這個角色（整個動作在同一筆歷史裡，復原時一起回來）
      for (const id of characterIds) {
        const name = characterOf(id).name
        for (const shot of shots.list().shots) {
          if (shot.characters.includes(name)) {
            shots.update(shot.id, { characters: shot.characters.filter((n) => n !== name) })
          }
        }
        characters.remove(id)
      }
      return {
        removed:
          shotIds.size +
          sceneIds.length +
          locationIds.length +
          characterIds.length +
          cleared.length,
      }
    },
  }
}
