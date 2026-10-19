import type { SlimaBook, SlimaBookKind, SlimaFileUse } from '@svs/schema'

export interface ParsedBookList {
  books: SlimaBook[]
  /** 還有下一頁時，下一頁的頁碼。 */
  nextPage?: number
}

function kindOf(label: string): SlimaBookKind {
  if (label.includes('Script Studio')) return 'script'
  if (label.includes('Knowledge')) return 'knowledge'
  return 'writing'
}

/**
 * 解析 slima-mcp `list_books` 的文字輸出：
 *
 *     - **書名** (bk_xxx) — 📖 Writing Studio
 *       Author: 作者 | Words: 12,345
 *
 * slima-mcp 只回傳給人看的文字，沒有結構化格式；解析不到的書會略過，不讓整個清單失敗。
 */
export function parseBookList(text: string): ParsedBookList {
  const lines = text.split('\n')
  const books: SlimaBook[] = []
  for (const [index, line] of lines.entries()) {
    const head = /^- \*\*(.+)\*\* \(([^()\s]+)\) — (.+)$/.exec(line.trim())
    if (!head) continue
    const [, title, token, label] = head
    if (title === undefined || token === undefined || label === undefined) continue
    const detail = /Author: (.*?) \| Words: ([\d,]+)/.exec(lines[index + 1] ?? '')
    const author = detail?.[1]?.trim()
    const words = Number((detail?.[2] ?? '0').replaceAll(',', ''))
    books.push({
      token,
      title,
      kind: kindOf(label),
      ...(author && author !== 'N/A' ? { author } : {}),
      words: Number.isFinite(words) ? words : 0,
    })
  }
  const next = /Call list_books again with `page: (\d+)`/.exec(text)
  const nextPage = next?.[1] ? Number(next[1]) : undefined
  return { books, ...(nextPage === undefined ? {} : { nextPage }) }
}

export interface TreeFile {
  /** 從書的根目錄算起的路徑，用 / 分隔。 */
  path: string
  name: string
  words: number
}

/**
 * 解析 `get_book_structure` 的檔案樹文字：
 *
 *     📁 characters
 *       📄 阿鐵.md (120 words)
 *     📄 chapter-01.md (900 words) [M]
 *
 * 文字裡只有名稱，路徑靠縮排（每層兩個空白）和資料夾名稱還原。
 */
export function parseFileTree(text: string): TreeFile[] {
  const files: TreeFile[] = []
  const folders: string[] = []
  for (const line of text.split('\n')) {
    const match = /^( *)(📁|📄) (.+)$/u.exec(line)
    if (!match) continue
    const [, indent, icon, rest] = match
    if (indent === undefined || icon === undefined || rest === undefined) continue
    const depth = Math.floor(indent.length / 2)
    folders.length = Math.min(folders.length, depth)
    if (icon === '📁') {
      folders[depth] = rest.trim()
      continue
    }
    const detail = /^(.*?)(?: \((\d[\d,]*) words\))?(?: \[M\])?$/.exec(rest.trim())
    const name = detail?.[1]?.trim() ?? rest.trim()
    const words = Number((detail?.[2] ?? '0').replaceAll(',', ''))
    files.push({
      path: [...folders.slice(0, depth), name].join('/'),
      name,
      words: Number.isFinite(words) ? words : 0,
    })
  }
  return files
}

export interface ParsedFile {
  name: string
  path: string
  words: number
  content: string
}

/** 解析 `read_file` / `get_chapter` 的輸出：標頭（名稱、路徑、字數）加上 `---` 後面的內容。 */
export function parseFileRead(text: string): ParsedFile {
  const split = text.indexOf('\n---\n')
  const header = split >= 0 ? text.slice(0, split) : ''
  const body = split >= 0 ? text.slice(split + 5).replace(/^\n/, '') : text
  const pick = (re: RegExp): string => re.exec(header)?.[1]?.trim() ?? ''
  const words = Number(pick(/\*\*Words:\*\* ([\d,]+)/).replaceAll(',', ''))
  return {
    name: pick(/^# (.+)$/m),
    path: pick(/\*\*Path:\*\* (.+)/),
    words: Number.isFinite(words) ? words : 0,
    content: body === '(empty file)' ? '' : body,
  }
}

/** 解析 `get_book` 的標頭：書名、類型與作者。 */
export function parseBookDetail(
  text: string,
  token: string,
): Omit<SlimaBook, 'words'> & { words: number } {
  const head = /^# (.+?) — (.+)$/m.exec(text)
  const author = /\*\*Author\*\*: (.+)/.exec(text)?.[1]?.trim()
  const words = Number((/\*\*Total Words\*\*: ([\d,]+)/.exec(text)?.[1] ?? '0').replaceAll(',', ''))
  return {
    token,
    title: head?.[2]?.trim() ?? token,
    kind: kindOf(head?.[1] ?? ''),
    ...(author && author !== 'N/A' ? { author } : {}),
    words: Number.isFinite(words) ? words : 0,
  }
}

export type EntityKind = 'character' | 'location' | 'scene'

export interface ReadEntity {
  name: string
  description: string
}

const NAME_KEYS = ['name', 'title', 'display_name', 'displayName', 'label'] as const
const DESCRIPTION_KEYS = [
  'description',
  'summary',
  'appearance',
  'bio',
  'biography',
  'personality',
  'background',
  'content',
  'text',
  'notes',
] as const

function stringsOf(source: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const value = source[key]
    return typeof value === 'string' && value.trim() !== '' ? [value.trim()] : []
  })
}

/**
 * 讀 Script Studio 的 `.character` / `.location` / `.scene` 檔（JSON）：取名稱，再把常見的描述欄位接起來。
 * 欄位名稱是依 slima-mcp 文件與常見命名猜的，**沒有實際對過 Slima 的資料**——格式對不上時，
 * 名稱退回檔名、描述退回原文，不會讓匯入失敗。
 */
export function readEntity(fileName: string, content: string): ReadEntity {
  const fallbackName = fileName.replace(/\.[^.]+$/, '')
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return { name: fallbackName, description: content.trim() }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { name: fallbackName, description: content.trim() }
  }
  const record = data as Record<string, unknown>
  // 有些格式把內容包在 data / attributes 底下
  const nested = ['data', 'attributes', 'fields']
    .map((key) => record[key])
    .filter(
      (v): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v),
    )
  const sources = [record, ...nested]
  const name = sources.flatMap((s) => stringsOf(s, NAME_KEYS))[0] ?? fallbackName
  const description = sources
    .flatMap((s) => stringsOf(s, DESCRIPTION_KEYS))
    .filter((text, index, all) => all.indexOf(text) === index)
    .join('\n')
  return { name, description }
}

const TEXT_EXTENSIONS = ['.md', '.markdown', '.txt']
const ENTITY_EXTENSIONS: Readonly<Record<string, EntityKind>> = {
  '.character': 'character',
  '.location': 'location',
  '.scene': 'scene',
}

/** 這個檔案能不能匯入，以及預設拿來做什麼。不能匯入的（圖片、關係圖…）回傳 undefined。 */
export function suggestUse(path: string): SlimaFileUse | undefined {
  const lower = path.toLowerCase()
  for (const [ext, use] of Object.entries(ENTITY_EXTENSIONS)) {
    if (lower.endsWith(ext)) return use
  }
  if (!TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return undefined
  if (/(^|\/)(characters?|角色|人物)(\/|$)/.test(lower)) return 'character'
  if (/(^|\/)(locations?|places?|world|worldbuilding|地點|場景|世界觀?)(\/|$)/.test(lower)) {
    return 'location'
  }
  return 'story'
}
