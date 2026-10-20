import { Fragment, type ReactNode } from 'react'

/**
 * Claude 回覆裡的 Markdown 顯示。自己寫的最小子集，不引整套函式庫：
 * 粗體、斜體、刪除線、行內程式碼、程式碼區塊、標題、清單（可巢狀）、表格、引用、分隔線。
 *
 * 安全邊界（寫死在做法裡，不靠過濾）：整個過程只產生 React 元素，字都當純文字放進去，
 * 沒有任何 `dangerouslySetInnerHTML`，也不解析 HTML——`<img onerror=…>`、`<script>` 會原樣顯示成字，不會執行。
 * 圖片不載入（只顯示替代文字）；連結不做成可點的連結（App 不替 Claude 開網頁），只顯示文字，
 * http／https 的網址附在後面讓使用者看得到、可以自己複製；`javascript:` 之類的網址一律不顯示。
 * 沒關起來的標記（串流到一半的 `**`、程式碼區塊）原樣當文字，之後補齊再變樣子。
 */

// ---- 行內 ----

const SAFE_URL = /^https?:\/\/[^\s<>]+$/i

function codeSpan(text: string, key: number): ReactNode {
  return (
    <code
      key={key}
      className="rounded bg-surface-overlay px-1 py-0.5 font-mono text-[0.85em] break-words"
    >
      {text}
    </code>
  )
}

/** 一個行內標記（成對的符號、連結的網址）最多往後找這麼遠；沒關起來的標記不會讓整段文字被反覆掃描。 */
const MAX_SPAN = 2000

/** 行內標記可能的開頭字元。 */
const MARKER_START = /[`![*~]/

/** 找成對的標記：回傳結束位置（標記開頭的索引），找不到或太遠回 -1；內容不能是空的。 */
function closeAt(text: string, from: number, mark: string): number {
  const k = text.slice(from, from + MAX_SPAN).indexOf(mark)
  return k > 0 ? from + k : -1
}

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let buffer = ''
  let key = 0
  const flush = (): void => {
    if (buffer !== '') {
      out.push(<Fragment key={key++}>{buffer}</Fragment>)
      buffer = ''
    }
  }
  let i = 0
  while (i < text.length) {
    // 一般的字（不是任何標記的開頭）直接放進去，不做任何比對
    if (!MARKER_START.test(text.charAt(i))) {
      buffer += text.charAt(i)
      i += 1
      continue
    }
    // 只往後看有限的長度（不是整段剩下的字）：每個位置的工作量有上限，長回覆才不會變成 n²
    const rest = text.slice(i, i + MAX_SPAN + 200)
    // 行內程式碼：裡面不再解析
    if (text[i] === '`') {
      const end = closeAt(text, i + 1, '`')
      if (end > 0) {
        flush()
        out.push(codeSpan(text.slice(i + 1, end), key++))
        i = end + 1
        continue
      }
    }
    // 圖片：不載入，只顯示替代文字
    const image = /^!\[([^\]\n]{0,300})\]\(((?:[^()\s]|\([^()\s]*\)){0,1500})[^)\n]{0,200}\)/.exec(
      rest,
    )
    if (image) {
      flush()
      const alt = image[1] ?? ''
      if (alt !== '') {
        out.push(
          <span key={key++} className="text-fg-muted">
            {alt}
          </span>,
        )
      }
      i += image[0].length
      continue
    }
    // 連結：只顯示文字；安全的網址附在後面
    const link = /^\[([^\]\n]{1,300})\]\(((?:[^()\s]|\([^()\s]*\)){0,1500})\)/.exec(rest)
    if (link) {
      flush()
      const label = link[1] ?? ''
      const url = link[2] ?? ''
      out.push(<Fragment key={key++}>{renderInline(label)}</Fragment>)
      if (SAFE_URL.test(url) && url !== label) {
        out.push(
          <span key={key++} className="break-all text-fg-muted">
            {' '}
            ({url})
          </span>,
        )
      }
      i += link[0].length
      continue
    }
    // 粗體、刪除線、斜體（斜體只認 *，不認 _：函式名 get_capabilities 不能被吃掉）
    const pairs: [string, 'strong' | 'del'][] = [
      ['**', 'strong'],
      ['~~', 'del'],
    ]
    let matched = false
    for (const [mark, tag] of pairs) {
      if (rest.startsWith(mark)) {
        const end = closeAt(text, i + mark.length, mark)
        if (end > 0) {
          flush()
          const inner = renderInline(text.slice(i + mark.length, end))
          out.push(
            tag === 'strong' ? (
              <strong key={key++}>{inner}</strong>
            ) : (
              <del key={key++}>{inner}</del>
            ),
          )
          i = end + mark.length
          matched = true
          break
        }
      }
    }
    if (matched) continue
    if (
      text[i] === '*' &&
      text[i + 1] !== '*' &&
      text[i + 1] !== ' ' &&
      text[i + 1] !== undefined
    ) {
      const limit = i + MAX_SPAN
      const nextStar = (from: number): number => {
        const k = text.slice(from, limit).indexOf('*')
        return k < 0 ? -1 : from + k
      }
      let end = nextStar(i + 1)
      while (end > 0 && (text[end - 1] === ' ' || text[end + 1] === '*')) {
        end = nextStar(end + 1)
      }
      if (end > i + 1) {
        flush()
        out.push(<em key={key++}>{renderInline(text.slice(i + 1, end))}</em>)
        i = end + 1
        continue
      }
    }
    buffer += text.charAt(i)
    i += 1
  }
  flush()
  return out
}

// ---- 區塊 ----

const FENCE = /^\s*```/
const HEADING = /^(#{1,6})\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const BULLET = /^(\s*)([-*+])\s+(.*)$/
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const isListLine = (line: string): boolean => BULLET.test(line) || ORDERED.test(line)
const indentOf = (line: string): number => line.length - line.trimStart().length

function splitRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  return row.split('|').map((cell) => cell.trim())
}

interface ListItem {
  text: string
  children: ListItem[]
  ordered: boolean
}

/** 從 start 開始吃一段清單（縮排比 base 深的算子項目），回傳項目與下一行的位置。 */
function parseList(
  lines: string[],
  start: number,
  base: number,
): { items: ListItem[]; next: number } {
  const items: ListItem[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const bullet = BULLET.exec(line)
    const ordered = ORDERED.exec(line)
    const match = bullet ?? ordered
    if (!match) break
    const indent = (match[1] ?? '').length
    if (indent < base) break
    if (indent > base) {
      // 縮得更深：是上一個項目的子清單
      const parent = items[items.length - 1]
      if (!parent) break
      const sub = parseList(lines, i, indent)
      parent.children.push(...sub.items)
      i = sub.next
      continue
    }
    items.push({ text: match[3] ?? '', children: [], ordered: ordered !== null })
    i += 1
  }
  return { items, next: i }
}

function ListView({ items, depth }: { items: ListItem[]; depth: number }): ReactNode {
  const ordered = items[0]?.ordered === true
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag
      className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-0.5 pl-5`}
      data-depth={depth}
    >
      {items.map((item, index) => (
        <li key={index}>
          {renderInline(item.text)}
          {item.children.length > 0 ? <ListView items={item.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </Tag>
  )
}

export function renderBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let key = 0
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      i += 1
      continue
    }
    // 程式碼區塊（串流到一半還沒收尾也先照程式碼顯示）
    if (FENCE.test(line)) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      i += 1
      out.push(
        <pre
          key={key++}
          data-testid="md-code-block"
          className="overflow-x-auto rounded-lg bg-surface-overlay p-2 font-mono text-xs"
        >
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      out.push(
        <p key={key++} className="font-semibold">
          {renderInline(heading[2] ?? '')}
        </p>,
      )
      i += 1
      continue
    }
    if (RULE.test(line)) {
      out.push(<hr key={key++} className="border-border" />)
      i += 1
      continue
    }
    // 表格：標題列＋分隔列（---）＋資料列
    if (line.includes('|') && TABLE_SEPARATOR.test(lines[i + 1] ?? '')) {
      const head = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        rows.push(splitRow(lines[i] ?? ''))
        i += 1
      }
      out.push(
        <div key={key++} className="overflow-x-auto" data-testid="md-table">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                {head.map((cell, c) => (
                  <th
                    key={c}
                    className="border border-border bg-surface-overlay px-2 py-1 text-left whitespace-nowrap"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {head.map((_, c) => (
                    <td key={c} className="min-w-[3.5em] border border-border px-2 py-1 align-top">
                      {renderInline(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    if (isListLine(line)) {
      const { items, next } = parseList(lines, i, indentOf(line))
      out.push(<ListView key={key++} items={items} depth={0} />)
      i = next
      continue
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        quoted.push(QUOTE.exec(lines[i] ?? '')?.[1] ?? '')
        i += 1
      }
      out.push(
        <blockquote key={key++} className="border-l-2 border-border pl-3 text-fg-muted">
          {renderBlocks(quoted.join('\n'))}
        </blockquote>,
      )
      continue
    }
    // 一般段落：連續的非空行；單一換行照樣換行
    const para: string[] = []
    while (i < lines.length) {
      const current = lines[i] ?? ''
      if (
        current.trim() === '' ||
        FENCE.test(current) ||
        HEADING.test(current) ||
        isListLine(current) ||
        QUOTE.test(current) ||
        RULE.test(current) ||
        (current.includes('|') && TABLE_SEPARATOR.test(lines[i + 1] ?? ''))
      ) {
        break
      }
      para.push(current)
      i += 1
    }
    if (para.length === 0) {
      // 防呆：什麼都沒吃到就當一般字，避免無窮迴圈
      para.push(line)
      i += 1
    }
    out.push(
      <p key={key++} className="whitespace-pre-wrap">
        {renderInline(para.join('\n'))}
      </p>,
    )
  }
  return out
}

/** Claude 的回覆文字：Markdown 的最小子集，一律當純文字顯示（見檔案開頭的安全邊界）。 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="break-words space-y-2 text-sm" data-testid="md">
      {renderBlocks(text)}
    </div>
  )
}
