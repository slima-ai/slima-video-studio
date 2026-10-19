import type { SlimaBook } from '@svs/schema'

import type { SlimaConnection } from './connection'
import {
  parseBookDetail,
  parseBookList,
  parseFileRead,
  parseFileTree,
  type ParsedFile,
  type TreeFile,
} from './parse'

const MAX_PAGES = 20

/** 對 Slima 的唯讀查詢。匯入服務只依賴這個介面，測試可以用記憶體版本取代。 */
export interface SlimaReader {
  /** 列出所有的書（自動翻頁）。 */
  listBooks: () => Promise<SlimaBook[]>
  getBook: (bookToken: string) => Promise<SlimaBook>
  /** 書裡所有的檔案（沒有資料夾）。 */
  listFiles: (bookToken: string) => Promise<TreeFile[]>
  readFile: (bookToken: string, path: string) => Promise<ParsedFile>
}

export type SlimaApi = SlimaReader

/** 在連線之上提供有型別的唯讀查詢。 */
export function createSlimaApi(connection: Pick<SlimaConnection, 'callTool'>): SlimaApi {
  return {
    async listBooks() {
      const books: SlimaBook[] = []
      let page = 1
      for (let i = 0; i < MAX_PAGES; i += 1) {
        const text = await connection.callTool('list_books', page === 1 ? {} : { page })
        const parsed = parseBookList(text)
        books.push(...parsed.books)
        if (parsed.nextPage === undefined || parsed.nextPage <= page) break
        page = parsed.nextPage
      }
      return books
    },

    async getBook(bookToken) {
      return parseBookDetail(
        await connection.callTool('get_book', { book_token: bookToken }),
        bookToken,
      )
    },

    async listFiles(bookToken) {
      return parseFileTree(
        await connection.callTool('get_book_structure', { book_token: bookToken }),
      )
    },

    async readFile(bookToken, path) {
      const parsed = parseFileRead(
        await connection.callTool('read_file', { book_token: bookToken, path }),
      )
      return { ...parsed, path: parsed.path || path }
    },
  }
}
