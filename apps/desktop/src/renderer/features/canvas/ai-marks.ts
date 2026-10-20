import type { CanvasAiChanged } from '@svs/schema'

/**
 * AI 剛改了這些節點（canvas.aiChanged）：哪些要標「AI 剛改」。
 * 剪輯（跟著鏡頭變）與展開的步驟格不標；新增一個鏡頭時，它的圖和影片節點也跟著出現，
 * 只標鏡頭本身（三個一起標太吵）。
 */
export function markableKeys(event: Pick<CanvasAiChanged, 'added' | 'changed'>): string[] {
  const added = new Set(event.added)
  const keys = [...event.added, ...event.changed].filter((key) => {
    if (key === 'cut' || key.includes(':step:')) return false
    const owner = /^(shot:[^:]+):(image|video)$/.exec(key)?.[1]
    return owner === undefined || !added.has(owner)
  })
  return [...new Set(keys)]
}

/** 刪掉了也要讓人知道的種類：圖與影片跟著鏡頭一起不見，不用另外說。 */
const REPORTED_KINDS: ReadonlySet<string> = new Set([
  'oneliner',
  'scene',
  'shot',
  'character',
  'location',
  'free_image',
  'free_video',
  'upload',
  'note',
  'group',
])

/** 提示用的名字：鏡頭、場本來就叫「第 N 鏡」「第 N 場…」；其他加上種類。 */
function nameOf(node: CanvasAiChanged['removed'][number]): string {
  if (node.kind === 'shot' || node.kind === 'scene') return node.title
  const label =
    node.kind === 'character'
      ? '角色'
      : node.kind === 'location'
        ? '地點'
        : node.kind === 'note'
          ? '便條'
          : node.kind === 'group'
            ? '群組'
            : node.kind === 'oneliner'
              ? '一句話'
              : '圖片或影片'
  return node.title === '' ? label : `${label}「${node.title}」`
}

/** AI 刪了東西的提示；沒有值得說的（只有跟著不見的圖與影片）就是 undefined。 */
export function removedMessage(
  removed: CanvasAiChanged['removed'],
  /** 這是右下角 Claude 對話正在做的一輪：復原會把這一輪的改動一起退回。 */
  wholeTurn = false,
): string | undefined {
  const reported = removed.filter((node) => REPORTED_KINDS.has(node.kind))
  if (reported.length === 0) return undefined
  const names = reported.slice(0, 3).map(nameOf).join('、')
  const more = reported.length > 3 ? `等 ${String(reported.length)} 個` : ''
  return wholeTurn
    ? `AI 刪了${names}${more}，可以復原（會連 Claude 這一輪的其他改動一起退回）`
    : `AI 刪了${names}${more}，可以復原`
}
