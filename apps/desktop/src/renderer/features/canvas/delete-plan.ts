import type { CanvasNode } from './canvas-model'
import { t, msg, type MessageRef } from '@svs/schema'

/** 刪除後「復原」的提示停留多久：留 10 秒，讓人看得完後果、來得及按。 */
export const DELETE_TOAST_MS = 10_000

/** 刪除鈕滑過時的說明（能刪的）：說清楚刪的是什麼、有哪些會留著，以及可以復原。 */
const DELETE_TIPS: Readonly<Partial<Record<CanvasNode['data']['kind'], MessageRef>>> = {
  shot: msg('canvas.deleteThisShotWithIts'),
  scene: msg('canvas.deleteThisSceneItsShots'),
  character: msg('canvas.deleteThisCharacterShotsThat'),
  location: msg('canvas.deleteThisLocationScenesAnd'),
  oneliner: msg('canvas.deleteThisOneLinerWhat'),
  group: msg('canvas.deleteThisGroupTheCells'),
  image: msg('canvas.clearTheVersionInUse2'),
  video: msg('canvas.clearTheVersionInUse2'),
}
export const deleteTip = (kind: CanvasNode['data']['kind']): string =>
  t(DELETE_TIPS[kind] ?? msg('canvas.deleteThisCellCanBe'))

/** 這次要刪的東西，和刪完要告訴使用者的後果（一行白話；提示旁有「復原」）。 */
export interface DeletePlan {
  keys: string[]
  message: string
}

/** 直接可以刪的格子種類（圖與影片是「清掉採用中的版本」，另外算）。 */
const DELETABLE = new Set([
  'oneliner',
  'shot',
  'scene',
  'character',
  'location',
  'note',
  'group',
  'freeImage',
  'freeVideo',
])

const hasResult = (node: Pick<CanvasNode, 'data'>): boolean =>
  node.data.thumb !== undefined || node.data.videoSrc !== undefined

/**
 * 這一格刪不掉的原因（刪除鈕停用時，滑過寫的話）；刪得掉就是 undefined。
 * 圖與影片有結果時，刪除是清掉採用中的版本，所以算刪得掉。
 */
export function blockedReason(node: Pick<CanvasNode, 'data'>): string | undefined {
  const { kind } = node.data
  if (kind === 'cut') {
    return t('canvas.theCutGrowsFromThe')
  }
  if (kind === 'step') {
    return t('canvas.thisIsAShotS')
  }
  if ((kind === 'image' || kind === 'video') && !hasResult(node)) {
    return kind === 'image' ? t('canvas.thisShotSFirstFrame') : t('canvas.thisShotSVideoHasn')
  }
  return DELETABLE.has(kind) || kind === 'image' || kind === 'video'
    ? undefined
    : t('canvas.thisCellCanTBe4')
}

const nameOf = (node: CanvasNode): string => {
  const title = node.data.title
  // 標題是「第 2 場・名字」（英文是「Scene 2 · Name」）：去掉前面的編號，留名字
  const parts = title.split(/\s*[・·]\s*/u)
  return parts.length > 1 ? parts.slice(1).join(t('list.dot')) || title : title
}

/**
 * 依選取的格子排出要刪的東西和後果。鏡頭的圖與影片跟著鏡頭走；單獨選到圖或影片是清掉採用中的版本
 * （版本還在生成紀錄裡）。刪完都能用「復原」整個找回來（資料表的列、版本、聲音都會回來，檔案本來就不會被刪）。
 * 全部都刪不掉就回原因；什麼都沒選就回 `{}`。
 */
export function planDelete(
  nodes: readonly CanvasNode[],
  selected: ReadonlySet<string>,
): { plan?: DeletePlan; reason?: string } {
  const picked = nodes.filter((n) => selected.has(n.id))
  const byKind = (...kinds: string[]): CanvasNode[] =>
    picked.filter((n) => kinds.includes(n.data.kind))
  const shots = byKind('shot')
  const shotIds = new Set(shots.map((n) => n.id))
  const scenes = byKind('scene')
  const locations = byKind('location')
  const characters = byKind('character')
  const oneliners = byKind('oneliner')
  const notes = byKind('note')
  const groups = byKind('group')
  const medias = byKind('freeImage', 'freeVideo')
  // 單獨選到的圖或影片（它的鏡頭沒一起選）：清掉採用中的版本，還沒有版本的不用清
  const clears = picked.filter(
    (n) =>
      (n.data.kind === 'image' || n.data.kind === 'video') &&
      !(n.data.shotId !== undefined && shotIds.has(n.data.shotId)) &&
      hasResult(n),
  )
  const keys = [
    ...oneliners,
    ...shots,
    ...scenes,
    ...locations,
    ...characters,
    ...notes,
    ...groups,
    ...medias,
    ...clears,
  ].map((n) => n.id)
  if (keys.length === 0) {
    const blocked = picked.map(blockedReason).find((reason) => reason !== undefined)
    return blocked === undefined ? {} : { reason: blocked }
  }

  const parts: string[] = []
  if (shots.length > 0) {
    parts.push(
      shots.length === 1
        ? t('canvas.deletedWithItsPictureAnd', {
            value: shots[0]?.data.title ?? t('canvas.thisShotFallback'),
          })
        : t('canvas.deletedShotsWithTheirPicture', { value: String(shots.length) }),
    )
  }
  for (const scene of scenes) {
    parts.push(t('canvas.deletedTheSceneItsShots', { value: nameOf(scene) }))
  }
  for (const location of locations) {
    parts.push(t('canvas.deletedTheLocationScenesAnd', { title: location.data.title }))
  }
  for (const character of characters) {
    parts.push(t('canvas.deletedTheCharacterShotsDropped', { title: character.data.title }))
  }
  if (oneliners.length > 0) {
    parts.push(
      oneliners.length === 1
        ? t('canvas.deletedTheOneLinerThe')
        : t('canvas.deletedOneLinersWhatThey', { value: String(oneliners.length) }),
    )
  }
  for (const group of groups) {
    parts.push(t('canvas.deletedTheGroupTheCells', { title: group.data.title }))
  }
  if (notes.length > 0) {
    parts.push(
      notes.length === 1
        ? t('canvas.deletedTheNote')
        : t('canvas.deletedNotes', { value: String(notes.length) }),
    )
  }
  for (const media of medias) {
    parts.push(
      t('canvas.deleted', {
        value: media.data.kind === 'freeVideo' ? t('canvas.video3') : t('canvas.picture2'),
        title: media.data.title,
      }),
    )
  }
  for (const clear of clears) {
    const shot = nodes.find((n) => n.data.kind === 'shot' && n.data.shotId === clear.data.shotId)
    parts.push(
      t(clear.data.kind === 'video' ? 'canvas.clearedVideo' : 'canvas.clearedFirstFrame', {
        value: shot?.data.title ?? '',
      }),
    )
  }
  return { plan: { keys, message: parts.join(t('list.semicolon')) } }
}

/** 固定的線（不能剪）的說明：選到它按 Delete、或按它的 × 時說的話。 */
export const FIXED_EDGE_REASON = msg('canvas.thisLineIsFixedOne')
