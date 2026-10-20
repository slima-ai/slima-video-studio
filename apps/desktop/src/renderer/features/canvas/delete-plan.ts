import type { CanvasNode } from './canvas-model'

/** 刪除後「復原」的提示停留多久：留 10 秒，讓人看得完後果、來得及按。 */
export const DELETE_TOAST_MS = 10_000

/** 刪除鈕滑過時的說明（能刪的）：說清楚刪的是什麼、有哪些會留著，以及可以復原。 */
const DELETE_TIPS: Readonly<Partial<Record<CanvasNode['data']['kind'], string>>> = {
  shot: '刪除這個鏡頭（連同它的圖和影片）。可以復原',
  scene: '刪除這一場（裡面的鏡頭留著）。可以復原',
  character: '刪除這個角色（出場的鏡頭會拿掉它）。可以復原',
  location: '刪除這個地點（用到它的場和鏡頭會清空地點）。可以復原',
  oneliner: '刪除這個一句話（它生出來的內容留著）。可以復原',
  group: '刪除這個群組（框裡的格子留著）。可以復原',
  image: '清掉採用中的版本（版本還在生成紀錄裡）。可以復原',
  video: '清掉採用中的版本（版本還在生成紀錄裡）。可以復原',
}
export const deleteTip = (kind: CanvasNode['data']['kind']): string =>
  DELETE_TIPS[kind] ?? '刪除這一格。可以復原'

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
    return '剪輯是由「場」自動長出來的，不能單獨刪；把所有場刪掉，它就會消失'
  }
  if (kind === 'step') {
    return '這是鏡頭的步驟，不是獨立的格子；按鏡頭上的「收合步驟」把它收起來'
  }
  if ((kind === 'image' || kind === 'video') && !hasResult(node)) {
    return kind === 'image'
      ? '這一鏡的第一張畫面還沒生成，沒有東西可以刪；整個鏡頭不要了，請刪鏡頭'
      : '這一鏡的影片還沒生成，沒有東西可以刪；整個鏡頭不要了，請刪鏡頭'
  }
  return DELETABLE.has(kind) || kind === 'image' || kind === 'video' ? undefined : '這一格不能刪'
}

const nameOf = (node: CanvasNode): string => {
  const title = node.data.title
  return title.includes('・') ? title.split('・').slice(1).join('・') || title : title
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
        ? `已刪除${shots[0]?.data.title ?? '這個鏡頭'}，連同它的圖和影片版本`
        : `已刪除 ${String(shots.length)} 個鏡頭，連同它們的圖和影片版本`,
    )
  }
  for (const scene of scenes) {
    parts.push(`已刪除「${nameOf(scene)}」這一場；裡面的鏡頭留著，只是不屬於任何場`)
  }
  for (const location of locations) {
    parts.push(`已刪除地點「${location.data.title}」；指到它的場和鏡頭已清空地點`)
  }
  for (const character of characters) {
    parts.push(
      `已刪除角色「${character.data.title}」；出場的鏡頭已拿掉這個角色，角色卡、概念圖、三視圖一起刪了`,
    )
  }
  if (oneliners.length > 0) {
    parts.push(
      oneliners.length === 1
        ? '已刪除一句話；它生出來的場、鏡頭、圖和影片都留著'
        : `已刪除 ${String(oneliners.length)} 個一句話；它們生出來的內容都留著`,
    )
  }
  for (const group of groups) {
    parts.push(`已刪除群組「${group.data.title}」；框裡的格子留著`)
  }
  if (notes.length > 0) {
    parts.push(notes.length === 1 ? '已刪除便條' : `已刪除 ${String(notes.length)} 張便條`)
  }
  for (const media of medias) {
    parts.push(`已刪除${media.data.kind === 'freeVideo' ? '影片' : '圖片'}「${media.data.title}」`)
  }
  for (const clear of clears) {
    const shot = nodes.find((n) => n.data.kind === 'shot' && n.data.shotId === clear.data.shotId)
    parts.push(
      `已清掉${shot?.data.title ?? ''}${clear.data.kind === 'video' ? '的影片' : '的第一張畫面'}（採用中的版本，版本還在生成紀錄裡）`,
    )
  }
  return { plan: { keys, message: parts.join('；') } }
}

/** 固定的線（不能剪）的說明：選到它按 Delete、或按它的 × 時說的話。 */
export const FIXED_EDGE_REASON =
  '這條線是固定的（一句話→場、鏡頭→圖→影片、場→剪輯），不能剪；不要它，就刪它連著的格子'
