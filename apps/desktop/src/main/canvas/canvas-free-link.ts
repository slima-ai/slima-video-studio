import { AppError, type CanvasLink, t } from '@svs/schema'

import type { ProjectManager } from '../project-manager'
import { UPLOAD_MODEL, type ShotService } from '../shots/shot-service'

export interface FreeLinkerDeps {
  projects: ProjectManager
  shots: Pick<ShotService, 'setUploadedFrame'>
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/** 鏡頭的圖節點鍵 `shot:<id>:image` 裡的鏡頭 id。 */
const shotOfImage = (key: string): string | undefined => /^shot:([^:]+):image$/.exec(key)?.[1]
const idOf = (key: string, prefix: string): string | undefined =>
  key.startsWith(`${prefix}:`) && !key.slice(prefix.length + 1).includes(':')
    ? key.slice(prefix.length + 1)
    : undefined

/**
 * 從獨立圖片拉出來的線（自由節點接到投影節點）：
 * - 接到鏡頭圖的「第一張畫面」：這一鏡改用這張圖當第一張畫面，不再自己生圖；剪掉線就回到原本的。
 * - 接到角色或地點的「參考圖」：加成一張概念圖（之後可以挑成主圖）；剪掉線就拿掉它（已挑成主圖的留著）。
 * 線本身存在 `canvas_edges`，資料改在原本的表；整個動作由呼叫端記成一筆歷史，可以復原。
 * 回傳 false 表示這不是從獨立圖片拉出來的線，交給一般的接線處理。
 */
export function createFreeLinker(deps: FreeLinkerDeps) {
  const handleOf = () => {
    const handle = deps.projects.current()
    if (!handle || handle.closed) throw invalid(t('canvas.openOrCreateAProject'))
    return handle
  }
  /** 線的起點是哪一張獨立圖片（不是就回 undefined）。 */
  const sourceImage = (link: CanvasLink) => {
    if (!link.source.key.startsWith('node:')) return undefined
    const handle = handleOf()
    const node = handle.repos.canvas.listNodes().find((n) => `node:${n.id}` === link.source.key)
    if (!node) throw invalid(t('canvas.couldnTFindThisPicture'))
    const hash = node.params.assetHash
    if (node.type !== 'free_image' || typeof hash !== 'string') {
      throw invalid(t('canvas.onlyPicturesCanBeConnected'))
    }
    return { handle, hash }
  }
  const edgeOf = (link: CanvasLink) => ({
    sourceKey: link.source.key,
    sourcePort: link.source.port,
    targetKey: link.target.key,
    targetPort: link.target.port,
  })

  return {
    link(link: CanvasLink): boolean {
      const source = sourceImage(link)
      if (!source) return false
      const { handle, hash } = source
      const { canvas } = handle.repos
      const target = link.target
      const exists = canvas
        .listEdges()
        .some(
          (e) =>
            e.sourceKey === link.source.key &&
            e.targetKey === target.key &&
            e.targetPort === target.port,
        )
      if (exists) throw invalid(t('canvas.thisPictureIsAlreadyConnected'))

      const shotId = shotOfImage(target.key)
      if (target.port === 'img-first' && shotId !== undefined) {
        // 一鏡只有一張第一張畫面：換接時先拿掉原本接上來的線
        canvas.removeEdgesInto(target.key, target.port)
        deps.shots.setUploadedFrame(shotId, hash)
        canvas.addEdge({ ...edgeOf(link), kind: 'data' })
        return true
      }
      const characterId = idOf(target.key, 'character')
      if (target.port === 'char-ref' && characterId !== undefined) {
        const { characters } = handle.repos
        characters.addConcept({
          characterId,
          round: characters.nextConceptRound(characterId),
          slot: 0,
          assetHash: hash,
          modelId: UPLOAD_MODEL,
        })
        canvas.addEdge({ ...edgeOf(link), kind: 'reference' })
        return true
      }
      const locationId = idOf(target.key, 'location')
      if (target.port === 'loc-ref' && locationId !== undefined) {
        const { locationCards } = handle.repos
        locationCards.addConcept({
          locationId,
          round: locationCards.nextConceptRound(locationId),
          slot: 0,
          assetHash: hash,
          modelId: UPLOAD_MODEL,
        })
        canvas.addEdge({ ...edgeOf(link), kind: 'reference' })
        return true
      }
      throw invalid(t('canvas.aPictureCanConnectTo'))
    },

    unlink(link: CanvasLink): boolean {
      const source = sourceImage(link)
      if (!source) return false
      const { handle, hash } = source
      handle.repos.canvas.removeEdge(edgeOf(link))
      const shotId = shotOfImage(link.target.key)
      if (link.target.port === 'img-first' && shotId !== undefined) {
        deps.shots.setUploadedFrame(shotId, undefined)
        return true
      }
      const characterId = idOf(link.target.key, 'character')
      if (link.target.port === 'char-ref' && characterId !== undefined) {
        // 已經挑成主圖的留著（拿掉會讓角色卡少了主圖）
        const { characters } = handle.repos
        if (characters.pack(characterId)?.heroAssetHash !== hash) {
          characters.removeConcepts(characterId, hash, UPLOAD_MODEL)
        }
        return true
      }
      const locationId = idOf(link.target.key, 'location')
      if (link.target.port === 'loc-ref' && locationId !== undefined) {
        const { locationCards } = handle.repos
        if (locationCards.get(locationId)?.mainAssetHash !== hash) {
          locationCards.removeConcepts(locationId, hash, UPLOAD_MODEL)
        }
        return true
      }
      return true
    },
  }
}
