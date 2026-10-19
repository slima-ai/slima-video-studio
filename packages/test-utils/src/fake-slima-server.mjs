// 假的 slima-mcp stdio 伺服器：工具名稱與回傳文字格式跟 slima-mcp 0.3.1／0.3.2 相同（0.3.2 只修了字數欄位：
// 0.3.1 讀不存在的 totalWordCount，列書時字數永遠是 0；這裡的 fixture 一直給真實的字數），
// 內含一本 Writing Studio、一本 Script Studio 與一本團隊知識庫的 fixture。CI 永遠不連 Slima 正式環境。
// 只認 SLIMA_API_TOKEN === VALID_TOKEN，其他 Token 的工具呼叫都回「Invalid API token」。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

export const VALID_TOKEN = 'slima_fake_valid_token_0000'
const PAGE_SIZE = 2

const BOOKS = [
  {
    token: 'bk_novel1',
    title: '雨夜的貓',
    studio: '📖 Writing Studio',
    author: '小林',
    words: 12345,
  },
  { token: 'bk_script1', title: '鐵與花', studio: '📝 Script Studio', author: '', words: 3200 },
  {
    token: 'bk_kb1',
    title: '團隊資料庫',
    studio: '📚 Team Knowledge Base',
    author: '編輯部',
    words: 800,
  },
]

// 檔案樹：資料夾用巢狀物件，檔案是字串內容。get_book_structure 會依 slima-mcp 的格式印出來。
const TREES = {
  bk_novel1: {
    'chapter-01.md': '# 第一章 雨夜\n\n阿鐵在雨夜的街角撿到一隻瘦小的貓。\n',
    'chapter-02.md': '# 第二章 倉庫\n\n他把貓帶回舊倉庫，天窗透進冷白的光。\n',
    characters: {
      '阿鐵.md': '短黑髮、琥珀色眼睛，穿深藍工作服的沉默修理工。',
    },
    world: {
      '舊倉庫.md': '潮濕的磚牆倉庫，堆滿木箱，天窗透進冷光。',
    },
    'cover.png': 'binary',
  },
  bk_script1: {
    '.script_studio': {
      characters: {
        'hero.character': JSON.stringify({
          name: '小花',
          description: '紮馬尾的少女，愛笑',
          scope: 'series',
        }),
        'tin.character': JSON.stringify({ name: '阿鐵', description: '沉默的修理工' }),
      },
      locations: {
        'yard.location': JSON.stringify({
          name: '廢料場',
          description: '生鏽的鐵架與雨水窪',
          scope: 'series',
        }),
      },
      seasons: {
        s1: {
          scenes: {
            'scene-01.scene': JSON.stringify({
              title: '雨中相遇',
              summary: '小花在廢料場遇見阿鐵。',
            }),
          },
        },
      },
      'series.json': '{}',
    },
  },
}

const fileAt = (token, path) =>
  path
    .split('/')
    .reduce(
      (node, part) => (node && typeof node === 'object' ? node[part] : undefined),
      TREES[token],
    )

const wordsOf = (content) => String(content).length

const printTree = (node, indent = 0) =>
  Object.entries(node)
    .map(([name, value]) => {
      const pad = '  '.repeat(indent)
      if (typeof value === 'object') return `${pad}📁 ${name}\n${printTree(value, indent + 1)}`
      return `${pad}📄 ${name} (${wordsOf(value)} words)`
    })
    .join('\n')

const text = (value, isError = false) => ({
  content: [{ type: 'text', text: value }],
  ...(isError ? { isError: true } : {}),
})

const guarded = (handler) => async (args) => {
  if (process.env.SLIMA_API_TOKEN !== VALID_TOKEN) {
    return text('Invalid API token. Please check your configuration.', true)
  }
  return handler(args)
}

const server = new McpServer({ name: 'slima', version: '0.3.1' })
const readOnly = { readOnlyHint: true, openWorldHint: true }
const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: true }

server.tool(
  'list_books',
  'List the books in your Slima library.',
  { page: z.number().optional() },
  readOnly,
  guarded(({ page }) => {
    const current = page ?? 1
    const totalPages = Math.ceil(BOOKS.length / PAGE_SIZE)
    const slice = BOOKS.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
    const list = slice
      .map(
        (b) =>
          `- **${b.title}** (${b.token}) — ${b.studio}\n  Author: ${b.author || 'N/A'} | Words: ${b.words.toLocaleString('en-US')}`,
      )
      .join('\n\n')
    const header =
      current < totalPages
        ? `Showing ${slice.length} of ${BOOKS.length} book(s) — page ${current} of ${totalPages}. Call list_books again with \`page: ${current + 1}\` for the rest.`
        : `Showing ${slice.length} of ${BOOKS.length} book(s) — page ${current} of ${totalPages} (this is the last page).`
    return text(`${header}\n\n${list}`)
  }),
)

server.tool(
  'get_book',
  'Get details of a specific book',
  { book_token: z.string() },
  readOnly,
  guarded(({ book_token }) => {
    const book = BOOKS.find((b) => b.token === book_token)
    if (!book) return text('Error: Book not found', true)
    return text(
      `# ${book.studio} — ${book.title}\n\n- **Token**: ${book.token}\n- **Author**: ${book.author || 'N/A'}\n- **Total Words**: ${book.words.toLocaleString('en-US')}`,
    )
  }),
)

server.tool(
  'get_book_structure',
  'Get the file/folder structure of a book',
  { book_token: z.string() },
  readOnly,
  guarded(({ book_token }) => {
    const tree = TREES[book_token]
    if (!tree) return text('No commits found. The book may be empty.')
    return text(`File structure for ${book_token}:\n\n${printTree(tree)}`)
  }),
)

server.tool(
  'read_file',
  'Read the content of any file in a book by its path.',
  { book_token: z.string(), path: z.string() },
  readOnly,
  guarded(({ book_token, path }) => {
    const content = fileAt(book_token, path)
    if (typeof content !== 'string') return text(`File not found: ${path}`, true)
    const name = path.split('/').at(-1)
    return text(
      `# ${name}\n\n**Path:** ${path}\n**Words:** ${wordsOf(content)}\n**Type:** text\n\n---\n\n${content}`,
    )
  }),
)

// 寫入類工具：App 的白名單必須擋住它們
server.tool(
  'create_book',
  'Create a new Writing Studio book.',
  { title: z.string() },
  writes,
  guarded(({ title }) => text(`✅ Book created: ${title}`)),
)
server.tool(
  'write_file',
  'Replace the entire content of an existing file.',
  { book_token: z.string(), path: z.string(), content: z.string() },
  writes,
  guarded(() => text('File updated successfully.')),
)

await server.connect(new StdioServerTransport())
