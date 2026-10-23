import type { CanvasAiChanged } from '@svs/schema'
import { t, msg, type MessageRef } from '@svs/schema'

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
const KIND_NAME: Readonly<Record<string, MessageRef>> = {
  oneliner: msg('canvas.oneLiner'),
  scene: msg('canvas.location2'),
  shot: msg('canvas.shot2'),
  character: msg('canvas.character'),
  location: msg('canvas.location'),
  note: msg('canvas.note'),
  group: msg('canvas.group'),
}

/** 鏡頭描述最多帶幾個字進提示（讓人認得是哪一格）。 */
const HINT_CHARS = 8

/** 提示用的名字：鏡頭「第 3 鏡」後面帶描述的開頭；場本來就叫「第 N 場・名字」；其他加上種類。 */
function nameOf(node: Removed, renumbered: boolean): string {
  if (node.kind === 'scene') {
    // 連著刪好幾次時，後面幾次的「第 N 場」是前面刪掉之後重新編的號，跟畫面上原本看到的不一樣：只留名字
    if (!renumbered) return node.title
    const name = node.title.replace(/^(?:第 \d+ 場|Scene \d+)(?:\s*[・·]\s*)?/u, '')
    return name === '' ? t('canvas.location2') : t('canvas.location3', { name })
  }
  if (node.kind === 'shot') {
    const text = (node.summary ?? '').trim()
    const label = renumbered ? t('canvas.shot2') : node.title
    if (text === '') return label
    const chars = Array.from(text)
    const hint = chars.length > HINT_CHARS ? `${chars.slice(0, HINT_CHARS).join('')}…` : text
    return `${label}「${hint}」`
  }
  const label = t(KIND_NAME[node.kind] ?? msg('canvas.pictureOrVideo'))
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
  /**
   * 這是連著好幾次刪除合成的一則：每次刪完都會重新編號，後面幾次記下的「第 N 鏡」不是原本的號碼
   * （刪掉第 1 鏡後，原本的第 2 鏡就叫第 1 鏡），所以鏡頭不寫號碼，只靠描述開頭分辨。
   */
  renumbered = false,
): string | undefined {
  const reported = removed.filter((node) => REPORTED_KINDS.has(node.kind))
  if (reported.length === 0) return undefined
  const named = reported.filter((node) => node.empty !== true)
  const blanks = reported.filter((node) => node.empty === true)
  const parts: string[] = []
  if (named.length > 0) {
    const names = named
      .slice(0, MAX_NAMES)
      .map((node) => nameOf(node, renumbered))
      .join(t('list.comma'))
    parts.push(
      named.length > MAX_NAMES
        ? t('canvas.andInAll', { names, value: String(named.length) })
        : names,
    )
  }
  const counts = new Map<string, number>()
  for (const node of blanks) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1)
  for (const [kind, count] of counts) {
    parts.push(
      t('canvas.empty', { value: String(count), value2: t(KIND_NAME[kind] ?? msg('canvas.cell')) }),
    )
  }
  const head = parts.join(t('list.comma'))
  const tail = wholeTurn ? t('canvas.pressUndoToGetIt') : t('canvas.pressUndoToGetIt2')
  return /^\d/.test(head)
    ? t('canvas.aiDeleted', { head, tail })
    : t('canvas.aiDeleted2', { head, tail })
}
