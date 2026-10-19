import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/** 連線 token：AI 工具連到本機 MCP 伺服器時帶的 `Authorization: Bearer …`。 */
export interface McpTokenStore {
  get: () => string
  /** 換一組新的；舊的立刻失效。 */
  regenerate: () => string
}

const PREFIX = 'svs_'
const VALID = /^svs_[A-Za-z0-9_-]{43}$/

const generate = (): string => PREFIX + randomBytes(32).toString('base64url')

/**
 * token 存在使用者資料夾的一個檔案（只有這個使用者讀得到，權限 600）。它只擋「這台電腦上其他的程式與網頁」，
 * 不是服務金鑰：服務金鑰（OpenRouter、fal.ai）永遠不會經過 MCP。檔案壞掉或格式不對就重新產生。
 */
export function createTokenStore(file: string): McpTokenStore {
  const save = (token: string): void => {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, token, { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, file)
    try {
      chmodSync(file, 0o600)
    } catch {
      // Windows 沒有這種權限位元；檔案仍然在使用者資料夾裡
    }
  }
  let current: string | undefined
  const load = (): string => {
    if (current) return current
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8').trim()
      if (VALID.test(text)) {
        current = text
        return text
      }
    }
    current = generate()
    save(current)
    return current
  }
  return {
    get: load,
    regenerate: () => {
      current = generate()
      save(current)
      return current
    },
  }
}
