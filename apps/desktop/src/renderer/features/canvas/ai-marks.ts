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

type Removed = CanvasAiChanged['removed'][number]

/** 種類的名字（「3 個空的場景」「角色「阿鐵」」用）。 */
const KIND_NAME: Readonly<Record<string, string>> = {
  oneliner: '一句話',
  scene: '場景',
  shot: '鏡頭',
  character: '角色',
  location: '地點',
  note: '便條',
  group: '群組',
}

/** 鏡頭描述最多帶幾個字進提示（讓人認得是哪一格）。 */
const HINT_CHARS = 8

/** 提示用的名字：鏡頭「第 3 鏡」後面帶描述的開頭；場本來就叫「第 N 場・名字」；其他加上種類。 */
function nameOf(node: Removed): string {
  if (node.kind === 'scene') return node.title
  if (node.kind === 'shot') {
    const text = (node.summary ?? '').trim()
    if (text === '') return node.title
    const chars = Array.from(text)
    const hint = chars.length > HINT_CHARS ? `${chars.slice(0, HINT_CHARS).join('')}…` : text
    return `${node.title}「${hint}」`
  }
  const label = KIND_NAME[node.kind] ?? '圖片或影片'
  return node.title === '' ? label : `${label}「${node.title}」`
}

/** 最多列幾個名字，多的寫「等 N 個」。 */
const MAX_NAMES = 3

/**
 * AI 刪了東西的提示；沒有值得說的（只有跟著不見的圖與影片）就是 undefined。
 * - 刪掉的是空的格子：不列名字，說「3 個空的場景」；
 * - 有內容的列名字，最多 3 個，再多寫「等 N 個」；
 * - 一律用「AI」，後半說清楚怎麼找回來。
 */
export function removedMessage(
  removed: CanvasAiChanged['removed'],
  /** 這是右下角 Claude 對話正在做的一輪：復原會把這一輪的改動一起退回。 */
  wholeTurn = false,
): string | undefined {
  const reported = removed.filter((node) => REPORTED_KINDS.has(node.kind))
  if (reported.length === 0) return undefined
  const named = reported.filter((node) => node.empty !== true)
  const blanks = reported.filter((node) => node.empty === true)
  const parts: string[] = []
  if (named.length > 0) {
    const names = named.slice(0, MAX_NAMES).map(nameOf).join('、')
    parts.push(named.length > MAX_NAMES ? `${names}等 ${String(named.length)} 個` : names)
  }
  const counts = new Map<string, number>()
  for (const node of blanks) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1)
  for (const [kind, count] of counts) {
    parts.push(`${String(count)} 個空的${KIND_NAME[kind] ?? '節點'}`)
  }
  const head = parts.join('、')
  const tail = wholeTurn
    ? '按「復原」可以找回來（這一輪 AI 做的其他改動也會一起退回）'
    : '按「復原」可以找回來'
  return `AI 刪了${/^\d/.test(head) ? ' ' : ''}${head}，${tail}`
}
