import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChatPanelMessage } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  appendRecords,
  deleteConversationFile,
  readConversations,
  sanitizeMessage,
  writeConversation,
} from './chat-store'

const ID = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const AT = '2026-10-20T12:00:00.000Z'

const dirs: string[] = []
const project = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'svs-chat-store-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const info = (patch: Partial<{ title: string; claudeSession: string; origin: string }> = {}) => ({
  id: ID,
  title: '第一個對話',
  createdAt: AT,
  updatedAt: AT,
  ...patch,
})
const user = (id: string, text: string): ChatPanelMessage => ({
  id,
  role: 'user',
  text,
  steps: [],
  at: AT,
})
const assistant = (id: string, text: string, extra: Partial<ChatPanelMessage> = {}) =>
  ({ id, role: 'assistant', text, steps: [], at: AT, state: 'done', ...extra }) as ChatPanelMessage

describe('對話紀錄檔（專案資料夾的 chat/）', () => {
  it('第一行是版本；之後一行一筆；讀回來訊息順序不變、同一個 id 後面的蓋掉前面的', () => {
    const dir = project()
    appendRecords(dir, ID, [
      { t: 'conv', info: info() },
      { t: 'msg', message: user('u1', '嗨') },
    ])
    appendRecords(dir, ID, [
      { t: 'msg', message: assistant('a1', '你好') },
      { t: 'conv', info: info({ title: '改過的標題', claudeSession: 'sess-1' }) },
      { t: 'msg', message: assistant('a1', '你好（改過）') },
    ])
    const lines = readFileSync(join(dir, 'chat', `${ID}.jsonl`), 'utf8')
      .trim()
      .split('\n')
    expect(JSON.parse(lines[0] ?? '')).toEqual({ v: 1 })
    expect(lines).toHaveLength(6)
    const [conv] = readConversations(dir)
    expect(conv?.info).toMatchObject({ id: ID, title: '改過的標題', claudeSession: 'sess-1' })
    expect(conv?.messages.map((m) => [m.id, m.text])).toEqual([
      ['u1', '嗨'],
      ['a1', '你好（改過）'],
    ])
  })

  it('沒有 chat/ 資料夾＝沒有對話；壞掉的行略過；版本不認得的檔整個略過、不動它', () => {
    const dir = project()
    expect(readConversations(dir)).toEqual([])
    appendRecords(dir, ID, [
      { t: 'conv', info: info() },
      { t: 'msg', message: user('u1', '嗨') },
    ])
    const file = join(dir, 'chat', `${ID}.jsonl`)
    writeFileSync(
      file,
      `${readFileSync(file, 'utf8')}這行不是 JSON\n{"t":"msg","message":{"x":1}}\n`,
    )
    const future = join(dir, 'chat', `${ID2}.jsonl`)
    const futureText = '{"v":2}\n{"t":"conv","id":"x"}\n'
    writeFileSync(future, futureText)
    const warn = vi.fn()
    const found = readConversations(dir, warn)
    expect(found.map((c) => c.info.id)).toEqual([ID])
    expect(found[0]?.messages).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(readFileSync(future, 'utf8')).toBe(futureText)
  })

  it('只存已知欄位：步驟摘要截到 200 字；Claude 的原始事件裡別的東西（思考、帳號、用量、token）一個字都進不了檔案', () => {
    const dirty = {
      ...assistant('a1', '好了', {
        steps: [
          {
            id: 's1',
            tool: 'create_shot',
            label: '建立鏡頭',
            status: 'done',
            summary: 'x'.repeat(500),
          },
        ],
      }),
      // 假裝上游不小心帶了不該存的東西
      thinking: '內心獨白',
      email: 'me@example.com',
      usage: { input_tokens: 1 },
      apiKey: 'sk-secret',
    } as unknown as ChatPanelMessage
    const clean = sanitizeMessage(dirty)
    expect(Object.keys(clean).sort()).toEqual(['at', 'id', 'role', 'state', 'steps', 'text'])
    expect(clean.steps[0]?.summary).toHaveLength(200)
    const dir = project()
    appendRecords(dir, ID, [
      { t: 'conv', info: { ...info(), email: 'me@example.com' } as ReturnType<typeof info> },
      { t: 'msg', message: dirty },
    ])
    const text = readFileSync(join(dir, 'chat', `${ID}.jsonl`), 'utf8')
    for (const secret of ['內心獨白', 'me@example.com', 'input_tokens', 'sk-secret']) {
      expect(text).not.toContain(secret)
    }
  })

  it('讀回來時還在串流的訊息（App 當時被關掉）變成「沒做完」，不會永遠轉圈', () => {
    const dir = project()
    appendRecords(dir, ID, [
      { t: 'conv', info: info() },
      { t: 'msg', message: assistant('a1', '做到一半', { state: 'streaming' }) },
    ])
    const [conv] = readConversations(dir)
    expect(conv?.messages[0]).toMatchObject({ state: 'error', text: '做到一半' })
  })

  it('不合格式的對話 id 不會被拿去組檔案路徑', () => {
    const dir = project()
    expect(() => {
      appendRecords(dir, '../../etc/passwd', [{ t: 'conv', info: info() }])
    }).toThrow()
    mkdirSync(join(dir, 'chat'), { recursive: true })
    writeFileSync(join(dir, 'chat', 'not-a-uuid.jsonl'), '{"v":1}\n')
    expect(readConversations(dir)).toEqual([])
  })

  it('搬到別的專案：整個重寫、舊檔刪掉', () => {
    const from = project()
    const to = project()
    appendRecords(from, ID, [
      { t: 'conv', info: info() },
      { t: 'msg', message: user('u1', '嗨') },
      { t: 'msg', message: assistant('a1', '你好') },
    ])
    const [conv] = readConversations(from)
    if (!conv) throw new Error('沒讀到')
    writeConversation(to, { ...conv, info: { ...conv.info, origin: to } })
    deleteConversationFile(from, ID)
    expect(readdirSync(join(from, 'chat'))).toEqual([])
    const [moved] = readConversations(to)
    expect(moved?.info.origin).toBe(to)
    expect(moved?.messages).toHaveLength(2)
  })
})
