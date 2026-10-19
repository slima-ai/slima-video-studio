import { describe, expect, it } from 'vitest'

import { isSlimaReadTool, SLIMA_READ_TOOLS } from './tools'
import {
  parseBookDetail,
  parseBookList,
  parseFileRead,
  parseFileTree,
  readEntity,
  suggestUse,
} from './parse'

const PAGE_1 = `Showing 2 of 3 book(s) — page 1 of 2. Call list_books again with \`page: 2\` for the rest.

- **雨夜的貓** (bk_novel1) — 📖 Writing Studio
  Author: 小林 | Words: 12,345

- **鐵與花** (bk_script1) — 📝 Script Studio
  Author: N/A | Words: 3,200

_📝 Script Studio books have write restrictions via MCP._`

describe('parseBookList', () => {
  it('解析書名、token、類型、作者與字數，並找出下一頁', () => {
    expect(parseBookList(PAGE_1)).toEqual({
      books: [
        { token: 'bk_novel1', title: '雨夜的貓', kind: 'writing', author: '小林', words: 12345 },
        { token: 'bk_script1', title: '鐵與花', kind: 'script', words: 3200 },
      ],
      nextPage: 2,
    })
  })

  it('最後一頁沒有下一頁；團隊知識庫分成 knowledge；書名可以含括號與星號以外的符號', () => {
    const parsed = parseBookList(`Found 1 book(s):

- **資料庫 (v2)** (bk_kb1) — 📚 Team Knowledge Base
  Author: 團隊 | Words: 800
`)
    expect(parsed.nextPage).toBeUndefined()
    expect(parsed.books).toEqual([
      { token: 'bk_kb1', title: '資料庫 (v2)', kind: 'knowledge', author: '團隊', words: 800 },
    ])
  })

  it('沒有書、或格式看不懂時回傳空清單而不是丟錯', () => {
    expect(parseBookList('No books found in your library.')).toEqual({ books: [] })
    expect(parseBookList('???')).toEqual({ books: [] })
  })
})

describe('唯讀工具白名單', () => {
  it('只包含查詢類工具；寫入類一律不在裡面', () => {
    for (const name of SLIMA_READ_TOOLS) expect(isSlimaReadTool(name)).toBe(true)
    for (const name of [
      'create_book',
      'write_file',
      'edit_file',
      'create_file',
      'delete_file',
      'append_to_file',
      'create_note',
      'create_comment',
      'analyze_chapter',
      'update_script',
    ]) {
      expect(isSlimaReadTool(name)).toBe(false)
    }
  })
})

describe('parseFileTree', () => {
  it('用縮排和資料夾名稱還原每個檔案的完整路徑，並讀出字數', () => {
    const files = parseFileTree(`File structure for Writing Studio — 雨夜的貓 (bk_novel1):

📄 chapter-01.md (1,200 words) [M]
📁 characters
  📄 阿鐵.md (23 words)
  📁 舊稿
    📄 草稿 一.md
📁 world
  📄 舊倉庫.md (20 words)
📄 cover.png (6 words)`)
    expect(files).toEqual([
      { path: 'chapter-01.md', name: 'chapter-01.md', words: 1200 },
      { path: 'characters/阿鐵.md', name: '阿鐵.md', words: 23 },
      { path: 'characters/舊稿/草稿 一.md', name: '草稿 一.md', words: 0 },
      { path: 'world/舊倉庫.md', name: '舊倉庫.md', words: 20 },
      { path: 'cover.png', name: 'cover.png', words: 6 },
    ])
  })

  it('沒有檔案（空書）時回傳空清單', () => {
    expect(parseFileTree('No commits found. The book may be empty.')).toEqual([])
  })
})

describe('parseFileRead / parseBookDetail', () => {
  it('分出標頭與內容；內容裡再出現 --- 不會被截斷；空檔案回傳空字串', () => {
    const parsed = parseFileRead(`# a.md

**Path:** x/a.md
**Words:** 1,024
**Type:** text

---

第一段

---

第二段`)
    expect(parsed).toEqual({
      name: 'a.md',
      path: 'x/a.md',
      words: 1024,
      content: '第一段\n\n---\n\n第二段',
    })
    expect(parseFileRead('# b.md\n\n**Path:** b.md\n\n---\n\n(empty file)').content).toBe('')
  })

  it('get_book 的標頭：書名、類型、作者、字數', () => {
    expect(
      parseBookDetail(
        '# 📝 Script Studio — 鐵與花\n\n- **Token**: bk_script1\n- **Author**: N/A\n- **Total Words**: 3,200',
        'bk_script1',
      ),
    ).toEqual({ token: 'bk_script1', title: '鐵與花', kind: 'script', words: 3200 })
  })
})

describe('readEntity', () => {
  it('取名稱與常見的描述欄位；包在 data 底下也讀得到', () => {
    expect(
      readEntity(
        'hero.character',
        JSON.stringify({ name: '小花', description: '愛笑', bio: '孤兒' }),
      ),
    ).toEqual({ name: '小花', description: '愛笑\n孤兒' })
    expect(
      readEntity(
        'x.location',
        JSON.stringify({ data: { title: '廢料場', summary: '生鏽的鐵架' } }),
      ),
    ).toEqual({ name: '廢料場', description: '生鏽的鐵架' })
  })

  it('格式看不懂時不丟錯：名稱用檔名、描述用原文', () => {
    expect(readEntity('阿鐵.character', '{}')).toEqual({ name: '阿鐵', description: '' })
    expect(readEntity('阿鐵.character', '不是 JSON')).toEqual({
      name: '阿鐵',
      description: '不是 JSON',
    })
    expect(readEntity('a.scene', '[1,2]')).toEqual({ name: 'a', description: '[1,2]' })
  })
})

describe('suggestUse', () => {
  it('依副檔名與資料夾猜用途；圖片等不能匯入的回傳 undefined', () => {
    expect(suggestUse('.script_studio/characters/a.character')).toBe('character')
    expect(suggestUse('.script_studio/locations/a.location')).toBe('location')
    expect(suggestUse('.script_studio/seasons/s1/scenes/a.scene')).toBe('scene')
    expect(suggestUse('chapter-01.md')).toBe('story')
    expect(suggestUse('characters/阿鐵.md')).toBe('character')
    expect(suggestUse('世界觀/舊倉庫.md')).toBe('location')
    expect(suggestUse('notes/想法.txt')).toBe('story')
    expect(suggestUse('cover.png')).toBeUndefined()
    expect(suggestUse('.script_studio/series.json')).toBeUndefined()
  })
})
