/** 假 Slima 伺服器認得的 Token；其他 Token 會得到「Invalid API token」。 */
export const FAKE_SLIMA_TOKEN = 'slima_fake_valid_token_0000'

/** 假伺服器 fixture 裡的三本書（順序與 list_books 相同）。 */
export const FAKE_SLIMA_BOOKS = [
  { token: 'bk_novel1', title: '雨夜的貓', kind: 'writing', author: '小林', words: 12345 },
  { token: 'bk_script1', title: '鐵與花', kind: 'script', words: 3200 },
  { token: 'bk_kb1', title: '團隊資料庫', kind: 'knowledge', author: '編輯部', words: 800 },
] as const
