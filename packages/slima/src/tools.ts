/**
 * App 允許呼叫的 slima-mcp 工具。**只有唯讀工具**，其他（建立、寫入、刪除、留言…）一律不開放：
 * 第一版只讀不寫，白名單也是對 LLM 開放工具時的上限。
 */
export const SLIMA_READ_TOOLS = [
  'list_books',
  'get_book',
  'get_book_structure',
  'get_chapter',
  'read_file',
  'search_content',
  'semantic_search',
  'list_notes',
  'get_writing_stats',
] as const

export type SlimaReadTool = (typeof SLIMA_READ_TOOLS)[number]

export function isSlimaReadTool(name: string): name is SlimaReadTool {
  return (SLIMA_READ_TOOLS as readonly string[]).includes(name)
}
