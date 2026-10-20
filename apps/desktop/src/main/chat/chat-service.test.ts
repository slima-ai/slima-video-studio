import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChatEvent, ChatPanelMessage } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { bridgeCommand } from '../mcp/connect'
import type { ClaudeCheck } from './claude-check'
import type { SpawnClaude } from './claude-process'
import { createChatService, type ChatServiceDeps } from './chat-service'

/** `expect.stringContaining` 回傳 any，包成字串型別才不會被 lint 擋。 */
const contains = (text: string): string => expect.stringContaining(text) as string

const TOOL = 'mcp__slima-video-studio__create_shot'

/** 假的 claude 行程：記下收到什麼、讓測試照劇本吐事件。 */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly written: Record<string, unknown>[] = []
  readonly killed: string[] = []
  readonly stdin = {
    write: (data: string): boolean => {
      this.written.push(JSON.parse(data) as Record<string, unknown>)
      return true
    },
    end: (): void => undefined,
  }
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed.push(signal)
    queueMicrotask(() => this.emit('exit', null, signal))
    return true
  }
  line(event: unknown): void {
    this.stdout.emit('data', `${JSON.stringify(event)}\n`)
  }
}

const init = (connected = true) => ({
  type: 'system',
  subtype: 'init',
  session_id: 's',
  mcp_servers: [{ name: 'slima-video-studio', status: connected ? 'connected' : 'failed' }],
})
const text = (delta: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } },
})
const toolStart = (id: string) => ({
  type: 'stream_event',
  event: {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id, name: TOOL },
  },
})
const toolResult = (id: string, body: string, isError = false) => ({
  type: 'user',
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: id,
        content: [{ type: 'text', text: body }],
        ...(isError ? { is_error: true } : {}),
      },
    ],
  },
})
const success = (result: string) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result,
})

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup(
  options: {
    packaged?: boolean
    claudeChat?: boolean
    mcpEnabled?: boolean
    check?: ClaudeCheck
    interruptGraceMs?: number
  } = {},
) {
  const children: FakeChild[] = []
  const calls: { file: string; args: string[]; cwd: string; env: Record<string, string> }[] = []
  const spawn: SpawnClaude = (file, args, o) => {
    const child = new FakeChild()
    children.push(child)
    calls.push({ file, args, cwd: o.cwd, env: o.env })
    return child
  }
  const events: ChatEvent[] = []
  const workDir = mkdtempSync(join(tmpdir(), 'svs-chat-'))
  dirs.push(workDir)
  let n = 0
  const deps: ChatServiceDeps = {
    settings: {
      get: () => ({
        experiments: options.claudeChat === undefined ? {} : { claudeChat: options.claudeChat },
        mcp: { enabled: options.mcpEnabled ?? true, port: 47821, allowanceUsd: 0 },
      }),
    },
    packaged: options.packaged ?? false,
    bridge: bridgeCommand('/exe', '/bridge.js', '/user'),
    workDir,
    check: () =>
      Promise.resolve(options.check ?? { state: 'ready', path: '/bin/claude', version: '2.1.304' }),
    spawn,
    broadcast: (_name, payload) => {
      events.push(payload)
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    env: { PATH: '/usr/bin', HOME: '/home/x', ANTHROPIC_API_KEY: 'sk-secret', SVS_X: '1' },
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    emitThrottleMs: 0,
    ...(options.interruptGraceMs === undefined
      ? {}
      : { interruptGraceMs: options.interruptGraceMs }),
  }
  const service = createChatService(deps)
  const last = (
    conversationId: string,
    role: 'user' | 'assistant',
  ): ChatPanelMessage | undefined =>
    [...events]
      .reverse()
      .find(
        (e) =>
          e.type === 'message' && e.conversationId === conversationId && e.message.role === role,
      )?.type === 'message'
      ? (
          [...events]
            .reverse()
            .find(
              (e) =>
                e.type === 'message' &&
                e.conversationId === conversationId &&
                e.message.role === role,
            ) as {
            message: ChatPanelMessage
          }
        ).message
      : undefined
  return { service, children, calls, events, deps, last }
}

describe('ChatService：開對話、送一則、一路串流', () => {
  it('一輪：使用者的話、工具步驟（進行中→做完）、文字一路長出來、做完；標題取第一句話的開頭', async () => {
    const { service, children, calls, events, last } = setup()
    const conv = service.create()
    expect(conv.title).toBe('新對話')
    await service.send(conv.id, '幫我建一個鏡頭，畫面是下雨的街角，要拍得有一點孤單')
    const child = children[0]
    if (!child) throw new Error('沒有啟動行程')
    // 第一則：--session-id、只傳必要的環境、在我們的工作資料夾
    expect(calls[0]?.args).toContain('--session-id')
    expect(calls[0]?.env).toEqual({ PATH: '/usr/bin', HOME: '/home/x' })
    expect(calls[0]?.file).toBe('/bin/claude')
    expect(child.written).toEqual([
      {
        type: 'user',
        message: { role: 'user', content: '幫我建一個鏡頭，畫面是下雨的街角，要拍得有一點孤單' },
      },
    ])
    expect(service.list().conversations[0]).toMatchObject({ running: true })
    expect(service.list().conversations[0]?.title).toBe('幫我建一個鏡頭，畫面是下雨的街角，要拍得…')

    child.line(init())
    child.line(toolStart('t1'))
    expect(last(conv.id, 'assistant')?.steps).toEqual([
      { id: 't1', tool: 'create_shot', label: '正在建立鏡頭…', status: 'running' },
    ])
    child.line(toolResult('t1', '建好了第 1 鏡'))
    expect(last(conv.id, 'assistant')?.steps).toEqual([
      {
        id: 't1',
        tool: 'create_shot',
        label: '建立鏡頭',
        status: 'done',
        summary: '建好了第 1 鏡',
      },
    ])
    child.line(text('已經'))
    child.line(text('建好了。'))
    expect(last(conv.id, 'assistant')).toMatchObject({ text: '已經建好了。', state: 'streaming' })
    child.line(success('已經建好了。'))
    expect(last(conv.id, 'assistant')).toMatchObject({ text: '已經建好了。', state: 'done' })
    expect(service.list().conversations[0]).toMatchObject({ running: false })
    expect(service.messages(conv.id).messages.map((m) => [m.role, m.text])).toEqual([
      ['user', '幫我建一個鏡頭，畫面是下雨的街角，要拍得有一點孤單'],
      ['assistant', '已經建好了。'],
    ])
    expect(events.at(-1)).toMatchObject({ type: 'conversation' })
  })

  it('同一個行程接著講第二則（不重新啟動）；行程結束後再講，用 --resume 接回同一個對話', async () => {
    const { service, children, calls } = setup()
    const conv = service.create()
    await service.send(conv.id, '一')
    const first = children[0]
    if (!first) throw new Error()
    first.line(init())
    first.line(success('好'))
    await service.send(conv.id, '二')
    expect(children).toHaveLength(1)
    expect(first.written).toHaveLength(2)
    first.line(success('好 2'))
    // 行程自己退出（例如被使用者在終端機砍了）
    first.emit('exit', 0, null)
    await service.send(conv.id, '三')
    expect(children).toHaveLength(2)
    expect(calls[1]?.args).toContain('--resume')
    expect(calls[1]?.args).not.toContain('--session-id')
    expect(calls[1]?.args[calls[1].args.indexOf('--resume') + 1]).toBe(conv.id)
  })

  it('上一則還在進行時再送：說明稍等；做完就能再送', async () => {
    const { service, children } = setup()
    const conv = service.create()
    await service.send(conv.id, '一')
    await expect(service.send(conv.id, '二')).rejects.toMatchObject({
      userMessage: contains('還在做上一則'),
    })
    children[0]?.line(init())
    children[0]?.line(success('好'))
    await expect(service.send(conv.id, '二')).resolves.toBeUndefined()
  })

  it('兩個對話各自一個行程、互不干擾', async () => {
    const { service, children, calls } = setup()
    const a = service.create()
    const b = service.create()
    await service.send(a.id, '甲')
    await service.send(b.id, '乙')
    expect(children).toHaveLength(2)
    expect(calls.map((c) => c.args[c.args.indexOf('--session-id') + 1])).toEqual([a.id, b.id])
    children[1]?.line(init())
    children[1]?.line(text('乙的回覆'))
    children[1]?.line(success('乙的回覆'))
    expect(service.messages(a.id).messages.at(-1)).toMatchObject({ state: 'streaming', text: '' })
    expect(service.messages(b.id).messages.at(-1)).toMatchObject({
      state: 'done',
      text: '乙的回覆',
    })
  })

  it('改名', () => {
    const { service } = setup()
    const conv = service.create()
    expect(service.rename(conv.id, '做廣告短片').title).toBe('做廣告短片')
    expect(service.list().conversations[0]?.title).toBe('做廣告短片')
  })
})

describe('ChatService：停止', () => {
  it('停止鈕：送 control_request interrupt（行程不用重開）；結果是被中斷就標「已停止」，沒做完的步驟標沒做完', async () => {
    const { service, children, last } = setup()
    const conv = service.create()
    await service.send(conv.id, '做很多事')
    const child = children[0]
    if (!child) throw new Error()
    child.line(init())
    child.line(toolStart('t1'))
    service.stop(conv.id)
    expect(child.written.at(-1)).toMatchObject({
      type: 'control_request',
      request: { subtype: 'interrupt' },
    })
    expect(child.killed).toEqual([])
    child.line({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      terminal_reason: 'aborted_streaming',
    })
    expect(last(conv.id, 'assistant')).toMatchObject({
      state: 'stopped',
      steps: [{ id: 't1', status: 'error', label: '建立鏡頭', summary: '沒有做完' }],
    })
    expect(service.list().conversations[0]).toMatchObject({ running: false })
    // 行程還活著：下一則直接送進同一個行程
    await service.send(conv.id, '再來')
    expect(children).toHaveLength(1)
  })

  it('對方沒在時限內結束這一輪：改用 SIGINT 當備案', async () => {
    const { service, children } = setup({ interruptGraceMs: 20 })
    const conv = service.create()
    await service.send(conv.id, '做很多事')
    service.stop(conv.id)
    await vi.waitFor(() => {
      expect(children[0]?.killed).toContain('SIGINT')
    })
  })

  it('沒有進行中的一輪：停止什麼都不做', () => {
    const { service, children } = setup()
    const conv = service.create()
    service.stop(conv.id)
    expect(children).toHaveLength(0)
  })
})

describe('ChatService：出錯要說白話', () => {
  it('MCP 沒連上：這一輪結束並說明，行程收掉', async () => {
    const { service, children, last } = setup()
    const conv = service.create()
    await service.send(conv.id, '嗨')
    children[0]?.line(init(false))
    expect(last(conv.id, 'assistant')).toMatchObject({
      state: 'error',
      error: contains('AI 工具連線'),
    })
    expect(children[0]?.killed).toContain('SIGTERM')
  })

  it('登入失敗的重試事件：請他先登入', async () => {
    const { service, children, last } = setup()
    const conv = service.create()
    await service.send(conv.id, '嗨')
    children[0]?.line({ type: 'system', subtype: 'api_retry', error: 'authentication_failed' })
    expect(last(conv.id, 'assistant')).toMatchObject({
      state: 'error',
      error: contains('登入'),
    })
  })

  it('行程在一輪中間當掉：說明連線中斷、再送一則會接著聊（stderr 只進紀錄）', async () => {
    const { service, children, last, deps } = setup()
    const conv = service.create()
    await service.send(conv.id, '嗨')
    children[0]?.line(init())
    children[0]?.stderr.emit('data', 'some internal failure')
    children[0]?.emit('exit', 1, null)
    expect(last(conv.id, 'assistant')).toMatchObject({
      state: 'error',
      error: contains('連線中斷'),
    })
    expect(JSON.stringify(service.messages(conv.id))).not.toContain('some internal failure')
    expect(deps.log.warn).toHaveBeenCalled()
    await service.send(conv.id, '再試')
    expect(children).toHaveLength(2)
  })

  it('這一輪做不完（用量到上限）：用白話說原因', async () => {
    const { service, children, last } = setup()
    const conv = service.create()
    await service.send(conv.id, '嗨')
    children[0]?.line(init())
    children[0]?.line({
      type: 'result',
      subtype: 'error_max_budget_usd',
      is_error: true,
      result: 'raw',
    })
    expect(last(conv.id, 'assistant')).toMatchObject({
      state: 'error',
      error: contains('用量到上限'),
    })
  })

  it('找不到、版本太舊、沒登入：不啟動行程、說明原因，而且之後修好了還能再送', async () => {
    for (const [check, words] of [
      [{ state: 'not_installed' }, '找不到 Claude Code'],
      [{ state: 'too_old', path: '/c', version: '2.0.0', minVersion: '2.1.259' }, '版本太舊'],
      [{ state: 'not_logged_in', path: '/c', version: '2.1.304' }, '登入'],
    ] as const) {
      const { service, children } = setup({ check })
      const conv = service.create()
      await expect(service.send(conv.id, '嗨')).rejects.toMatchObject({
        userMessage: contains(words),
      })
      expect(children).toHaveLength(0)
      expect(service.list().conversations[0]).toMatchObject({ running: false })
    }
  })
})

describe('ChatService.status：能不能開始', () => {
  it('實驗功能開關：沒設時開發版開、打包版關；使用者設了就照他的', async () => {
    expect(await setup({ packaged: false }).service.status()).toMatchObject({ state: 'ready' })
    expect(await setup({ packaged: true }).service.status()).toEqual({ state: 'disabled' })
    expect(await setup({ packaged: true, claudeChat: true }).service.status()).toMatchObject({
      state: 'ready',
    })
    expect(await setup({ packaged: false, claudeChat: false }).service.status()).toEqual({
      state: 'disabled',
    })
  })

  it('開關關著時送訊息會被擋下（不只是畫面藏起來）', async () => {
    const { service, children } = setup({ packaged: true })
    const conv = service.create()
    await expect(service.send(conv.id, '嗨')).rejects.toMatchObject({
      userMessage: contains('實驗功能'),
    })
    expect(children).toHaveLength(0)
  })

  it('AI 工具連線沒開：先說這個（Claude 靠它改專案）', async () => {
    expect(await setup({ mcpEnabled: false }).service.status()).toEqual({ state: 'mcp_off' })
  })

  it('沒裝、太舊、沒登入、可以用', async () => {
    expect(await setup({ check: { state: 'not_installed' } }).service.status()).toEqual({
      state: 'not_installed',
    })
    expect(
      await setup({
        check: { state: 'too_old', path: '/c', version: '2.0.0', minVersion: '2.1.259' },
      }).service.status(),
    ).toEqual({ state: 'too_old', version: '2.0.0', minVersion: '2.1.259' })
    expect(
      await setup({
        check: { state: 'not_logged_in', path: '/c', version: '2.1.304' },
      }).service.status(),
    ).toEqual({ state: 'not_logged_in', version: '2.1.304' })
  })
})

describe('ChatService.dispose', () => {
  it('結束 App 時把所有 claude 行程收掉', async () => {
    const { service, children } = setup()
    const conv = service.create()
    await service.send(conv.id, '嗨')
    service.dispose()
    expect(children[0]?.killed).toContain('SIGTERM')
  })
})
