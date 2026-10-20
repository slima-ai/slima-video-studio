import { EventEmitter } from 'node:events'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CHAT_BUDGET_DEFAULT_USD, type ChatEvent, type ChatPanelMessage } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { bridgeCommand } from '../mcp/connect'
import { readConversations } from './chat-store'
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

const init = (connected = true, sessionId = 's') => ({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
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
    claudeBudgetUsd?: number
    idleMs?: number
    /** 目前專案資料夾（有給才會存紀錄）。 */
    projectDir?: string
    /** 要不要接復原紀錄（記下 begin／結束的順序）。 */
    withHistory?: boolean
    /** 同一個專案資料夾在別的「App 啟動」裡：共用 tmp 目錄用。 */
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
  const project = {
    dir: options.projectDir,
    listeners: new Set<() => void>(),
    switchTo(dir: string | undefined): void {
      project.dir = dir
      for (const listener of project.listeners) listener()
    },
  }
  const historyLog: string[] = []
  const deps: ChatServiceDeps = {
    settings: {
      get: () => ({
        experiments: {
          ...(options.claudeChat === undefined ? {} : { claudeChat: options.claudeChat }),
          ...(options.claudeBudgetUsd === undefined
            ? {}
            : { claudeBudgetUsd: options.claudeBudgetUsd }),
        },
        mcp: { enabled: options.mcpEnabled ?? true, port: 47821, allowanceUsd: 0 },
      }),
    },
    packaged: options.packaged ?? false,
    bridge: bridgeCommand('/exe', '/bridge.js', '/user'),
    workDir,
    ...(options.withHistory === true
      ? {
          history: {
            beginAiTurn: (label: string) => {
              historyLog.push(`begin:${label}`)
              let done = false
              return () => {
                if (done) return
                done = true
                historyLog.push('end')
              }
            },
          },
        }
      : {}),
    ...(options.projectDir === undefined
      ? {}
      : {
          project: {
            dir: () => project.dir,
            onChange: (listener: () => void) => {
              project.listeners.add(listener)
              return () => {
                project.listeners.delete(listener)
              }
            },
          },
        }),
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
    ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
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
  return { service, children, calls, events, deps, last, project, historyLog }
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
    first.line(init(true, conv.id))
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

  it('用量到上限：這則可以「繼續」；再送一則會關掉舊行程、用 --resume 開新的（新的用量額度），上限照設定', async () => {
    const { service, children, calls, last } = setup({ claudeBudgetUsd: 2 })
    const conv = service.create()
    await service.send(conv.id, '嗨')
    expect(calls[0]?.args[calls[0].args.indexOf('--max-budget-usd') + 1]).toBe('2')
    children[0]?.line(init())
    children[0]?.line({ type: 'result', subtype: 'error_max_budget_usd', is_error: true })
    expect(last(conv.id, 'assistant')).toMatchObject({ state: 'error', resumable: true })
    await service.send(conv.id, '請接著剛才的做下去。')
    // 舊行程被關掉、新行程用 --resume 接回同一個 session
    expect(children[0]?.killed).toContain('SIGTERM')
    expect(children).toHaveLength(2)
    expect(calls[1]?.args).toContain('--resume')
    expect(calls[1]?.args).not.toContain('--session-id')
    // 新行程收到那句話
    expect(children[1]?.written).toHaveLength(1)
    // 舊行程晚一點才退出，不會把新的這一輪當成當掉
    children[0]?.emit('exit', 0, null)
    expect(last(conv.id, 'assistant')?.state).toBe('streaming')
  })

  it('沒設定時每一段的用量上限預設 US$5（不是 US$0.5：讀指南、呼叫幾個工具的一輪就會超過）', async () => {
    const { service, calls } = setup()
    const conv = service.create()
    await service.send(conv.id, '嗨')
    expect(calls[0]?.args[calls[0].args.indexOf('--max-budget-usd') + 1]).toBe('5')
    expect(CHAT_BUDGET_DEFAULT_USD).toBe(5)
  })

  it('步數到上限也能繼續；一般失敗不給「繼續」', async () => {
    const { service, children, last } = setup()
    const conv = service.create()
    await service.send(conv.id, '嗨')
    children[0]?.line(init())
    children[0]?.line({ type: 'result', subtype: 'error_max_turns', is_error: true })
    expect(last(conv.id, 'assistant')).toMatchObject({ state: 'error', resumable: true })
    await service.send(conv.id, '再來')
    children[1]?.line(init())
    children[1]?.line({ type: 'result', subtype: 'error_during_execution', is_error: true })
    expect(last(conv.id, 'assistant')?.state).toBe('error')
    expect(last(conv.id, 'assistant')?.resumable).toBeUndefined()
  })

  it('閒置夠久就關掉行程，之後講話用 --resume 接回；還在做事或剛講完話時不關', async () => {
    vi.useFakeTimers()
    try {
      const { service, children, calls } = setup({ idleMs: 1000 })
      const conv = service.create()
      await service.send(conv.id, '嗨')
      children[0]?.line(init())
      // 還在做事：過再久也不關
      vi.advanceTimersByTime(5000)
      expect(children[0]?.killed).toEqual([])
      children[0]?.line(success('好'))
      // 做完後倒數；沒到時間不關
      vi.advanceTimersByTime(900)
      expect(children[0]?.killed).toEqual([])
      vi.advanceTimersByTime(200)
      expect(children[0]?.killed).toEqual(['SIGTERM'])
      await vi.runAllTimersAsync()
      // 再講話：新行程、--resume、同一個對話
      await service.send(conv.id, '再來')
      expect(children).toHaveLength(2)
      expect(calls[1]?.args).toContain('--resume')
      // 講話的當下倒數取消：不會在做事中途被關
      vi.advanceTimersByTime(5000)
      expect(children[1]?.killed).toEqual([])
    } finally {
      vi.useRealTimers()
    }
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

describe('ChatService：對話紀錄存在專案資料夾的 chat/', () => {
  const projectDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'svs-chat-proj-'))
    dirs.push(d)
    return d
  }
  const arg = (args: string[] | undefined, flag: string): string | undefined => {
    const at = args?.indexOf(flag) ?? -1
    return at < 0 ? undefined : args?.[at + 1]
  }

  /** 講一句話、做完。 */
  async function say(
    s: ReturnType<typeof setup>,
    conversationId: string,
    text: string,
    sessionId?: string,
  ): Promise<FakeChild> {
    await s.service.send(conversationId, text)
    const child = s.children[s.children.length - 1]
    if (!child) throw new Error('沒有行程')
    child.line(init(true, sessionId))
    child.line(success(`回：${text}`))
    return child
  }

  it('講過的話存起來；重開 App（新的服務）讀得回來，接著講用 --resume 接回同一個 Claude session', async () => {
    const dir = projectDir()
    const a = setup({ projectDir: dir })
    const conv = a.service.create()
    // 還沒說話：不存檔
    expect(existsSync(join(dir, 'chat'))).toBe(false)
    await say(a, conv.id, '幫我建一個鏡頭', 'claude-session-1')
    expect(readdirSync(join(dir, 'chat'))).toEqual([`${conv.id}.jsonl`])
    a.service.dispose()

    const b = setup({ projectDir: dir })
    const [restored] = b.service.list().conversations
    expect(restored).toMatchObject({ id: conv.id, title: '幫我建一個鏡頭', running: false })
    expect(b.service.messages(conv.id).messages.map((m) => [m.role, m.text, m.state])).toEqual([
      ['user', '幫我建一個鏡頭', undefined],
      ['assistant', '回：幫我建一個鏡頭', 'done'],
    ])
    await b.service.send(conv.id, '再加一個')
    const args = b.calls[0]?.args
    expect(arg(args, '--resume')).toBe('claude-session-1')
    expect(args).not.toContain('--session-id')
    expect(args).not.toContain('--fork-session')
  })

  it('改名也存；沒開專案時只放記憶體、不寫任何檔案', async () => {
    const dir = projectDir()
    const a = setup({ projectDir: dir })
    const conv = a.service.create()
    await say(a, conv.id, '嗨')
    a.service.rename(conv.id, '我取的名字')
    const b = setup({ projectDir: dir })
    expect(b.service.list().conversations[0]?.title).toBe('我取的名字')
    const none = setup()
    const c = none.service.create()
    await say(none, c.id, '嗨')
    expect(none.service.messages(c.id).messages).toHaveLength(2)
  })

  it('專案另存出來的複本：對話跟著來，接著講用 --resume ＋ --fork-session（不跟原本的共用同一個 session）；分出來之後就是它自己的', async () => {
    const original = projectDir()
    const copy = projectDir()
    const a = setup({ projectDir: original })
    const conv = a.service.create()
    await say(a, conv.id, '原本專案裡的對話', 'session-orig')
    // 另存為：chat/ 一起複製
    cpSync(join(original, 'chat'), join(copy, 'chat'), { recursive: true })

    const b = setup({ projectDir: copy })
    expect(b.service.list().conversations).toHaveLength(1)
    const child = await say(b, conv.id, '複本裡接著講', 'session-forked')
    expect(arg(b.calls[0]?.args, '--resume')).toBe('session-orig')
    expect(b.calls[0]?.args).toContain('--fork-session')
    child.emit('exit', 0, null)
    // 分出新 session 之後：下次接續用新的、不再分岔
    await b.service.send(conv.id, '再講一句')
    expect(arg(b.calls[1]?.args, '--resume')).toBe('session-forked')
    expect(b.calls[1]?.args).not.toContain('--fork-session')
    // 原本專案的紀錄沒被動到
    const c = setup({ projectDir: original })
    expect(c.service.messages(conv.id).messages).toHaveLength(2)
  })

  it('Claude 那邊找不到這個對話的舊紀錄：改開新的、把我們存的內容帶過去當背景、使用者看不到錯誤', async () => {
    const dir = projectDir()
    const a = setup({ projectDir: dir })
    const conv = a.service.create()
    await say(a, conv.id, '暗號是香蕉', 'gone-session')
    a.service.dispose()

    const b = setup({ projectDir: dir })
    await b.service.send(conv.id, '暗號是什麼？')
    expect(arg(b.calls[0]?.args, '--resume')).toBe('gone-session')
    const old = b.children[0]
    // claude 說找不到就退出（還沒有 init）
    old?.stderr.emit('data', 'No conversation found with session ID: gone-session\n')
    old?.emit('exit', 1, null)
    expect(b.children).toHaveLength(2)
    expect(b.calls[1]?.args).toContain('--session-id')
    expect(b.calls[1]?.args).not.toContain('--resume')
    const sent = JSON.stringify(b.children[1]?.written[0])
    expect(sent).toContain('暗號是香蕉')
    expect(sent).toContain('回：暗號是香蕉')
    expect(sent).toContain('現在使用者說：暗號是什麼？')
    // 畫面上沒有錯誤；新的行程回覆後一切照常
    const fresh = b.children[1]
    fresh?.line(init(true, 'new-session'))
    fresh?.line(success('香蕉'))
    const messages = b.service.messages(conv.id).messages
    expect(messages.map((m) => m.state)).toEqual([undefined, 'done', undefined, 'done'])
    expect(messages[3]?.text).toBe('香蕉')
    // 使用者那一則存的是他自己說的話，不是帶了背景的那一長串
    expect(messages[2]?.text).toBe('暗號是什麼？')
    // 之後接著講用新的 session
    fresh?.emit('exit', 0, null)
    await b.service.send(conv.id, '還在嗎')
    expect(arg(b.calls[2]?.args, '--resume')).toBe('new-session')
  })

  it('不是「找不到舊紀錄」的退出照舊當成連線中斷，不會偷偷重開', async () => {
    const dir = projectDir()
    const a = setup({ projectDir: dir })
    const conv = a.service.create()
    await say(a, conv.id, '嗨', 'sess')
    const b = setup({ projectDir: dir })
    await b.service.send(conv.id, '再嗨')
    b.children[0]?.stderr.emit('data', 'something else broke')
    b.children[0]?.emit('exit', 1, null)
    expect(b.children).toHaveLength(1)
    expect(b.service.messages(conv.id).messages.at(-1)).toMatchObject({ state: 'error' })
  })

  it('專案換了：目前專案的對話才出現在清單；正在做事的對話（Claude 剛建了新專案）跟著搬過去，通知畫面重讀', async () => {
    const first = projectDir()
    const second = projectDir()
    const s = setup({ projectDir: first })
    const idle = s.service.create()
    await say(s, idle.id, '第一個專案裡聊過的', 's1')
    const busy = s.service.create()
    await s.service.send(busy.id, '建一個新專案')
    expect(s.service.list().conversations).toHaveLength(2)
    // Claude 建了新專案、App 切過去
    s.project.switchTo(second)
    expect(s.events.some((e) => e.type === 'reset')).toBe(true)
    // 正在做事的那個跟過來；沒在做事的留在第一個專案
    expect(s.service.list().conversations.map((c) => c.id)).toEqual([busy.id])
    expect(readdirSync(join(second, 'chat'))).toEqual([`${busy.id}.jsonl`])
    expect(existsSync(join(first, 'chat', `${busy.id}.jsonl`))).toBe(false)
    expect(existsSync(join(first, 'chat', `${idle.id}.jsonl`))).toBe(true)
    // 做完之後它還在新專案的清單裡，紀錄也在新專案
    const child = s.children[s.children.length - 1]
    child?.line(init(true, 's2'))
    child?.line(success('建好了'))
    expect(s.service.list().conversations.map((c) => c.id)).toEqual([busy.id])
    expect(readConversations(second)[0]?.messages).toHaveLength(2)
    // 切回第一個專案：看得到第一個專案的對話
    s.project.switchTo(first)
    expect(s.service.list().conversations.map((c) => c.id)).toEqual([idle.id])
  })

  it('同一個 App 裡另存為：切到複本後清單照複本的紀錄重讀（同一個 id 不會被舊專案的那份擋住），舊專案的行程收掉', async () => {
    const original = projectDir()
    const copy = projectDir()
    const s = setup({ projectDir: original })
    const conv = s.service.create()
    const child = await say(s, conv.id, '原本專案裡的對話', 'session-orig')
    cpSync(join(original, 'chat'), join(copy, 'chat'), { recursive: true })
    s.project.switchTo(copy)
    // 舊專案那個對話的行程被收掉（紀錄在它自己的專案裡，回去再讀）
    expect(child.killed).toContain('SIGTERM')
    const [listed] = s.service.list().conversations
    expect(listed).toMatchObject({ id: conv.id, running: false })
    expect(s.service.messages(conv.id).messages).toHaveLength(2)
    await s.service.send(conv.id, '複本裡接著講')
    const forked = s.children[s.children.length - 1]
    forked?.line(init(true, 'session-forked'))
    forked?.line(success('好'))
    const args = s.calls[s.calls.length - 1]?.args
    expect(arg(args, '--resume')).toBe('session-orig')
    expect(args).toContain('--fork-session')
    // 切回原本的專案：原本的紀錄原樣、沒有複本裡才說的話
    s.project.switchTo(original)
    expect(s.service.messages(conv.id).messages.map((m) => m.text)).toEqual([
      '原本專案裡的對話',
      '回：原本專案裡的對話',
    ])
  })
})

describe('ChatService：Claude 一輪的改動合成一步復原', () => {
  it('開始做事時開始記、這一輪結束（做完）就收尾——一輪一筆', async () => {
    const { service, children, historyLog } = setup({ withHistory: true })
    const conv = service.create()
    await service.send(conv.id, '嗨')
    expect(historyLog).toEqual(['begin:Claude 這一輪的改動'])
    children[0]?.line(init())
    children[0]?.line(success('好'))
    expect(historyLog).toEqual(['begin:Claude 這一輪的改動', 'end'])
    await service.send(conv.id, '再來')
    children[0]?.line(success('好 2'))
    expect(historyLog).toEqual([
      'begin:Claude 這一輪的改動',
      'end',
      'begin:Claude 這一輪的改動',
      'end',
    ])
  })

  it('做到一半被停止、出錯、行程當掉：一樣收尾（已經做的改動才能一步退）', async () => {
    // 停止
    const a = setup({ withHistory: true })
    const c1 = a.service.create()
    await a.service.send(c1.id, '做很久')
    a.service.stop(c1.id)
    a.children[0]?.line({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      terminal_reason: 'aborted_streaming',
    })
    expect(a.historyLog.at(-1)).toBe('end')
    // 出錯
    const b = setup({ withHistory: true })
    const c2 = b.service.create()
    await b.service.send(c2.id, '做')
    b.children[0]?.line({ type: 'result', subtype: 'error_during_execution', is_error: true })
    expect(b.historyLog.at(-1)).toBe('end')
    // 行程當掉
    const c = setup({ withHistory: true })
    const c3 = c.service.create()
    await c.service.send(c3.id, '做')
    c.children[0]?.emit('exit', 1, null)
    expect(c.historyLog).toEqual(['begin:Claude 這一輪的改動', 'end'])
  })

  it('檢查沒過（沒裝／沒登入）根本沒開始做事：不開始記', async () => {
    const { service, historyLog } = setup({
      withHistory: true,
      check: { state: 'not_installed' },
    })
    const conv = service.create()
    await expect(service.send(conv.id, '嗨')).rejects.toBeTruthy()
    expect(historyLog).toEqual([])
  })

  it('這一輪做到一半換了專案（Claude 建了新專案）：舊專案收尾、新專案接著記', async () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'svs-chat-h1-'))
    const dir2 = mkdtempSync(join(tmpdir(), 'svs-chat-h2-'))
    dirs.push(dir1, dir2)
    const s = setup({ withHistory: true, projectDir: dir1 })
    const conv = s.service.create()
    await s.service.send(conv.id, '建一個新專案')
    s.project.switchTo(dir2)
    expect(s.historyLog).toEqual(['begin:Claude 這一輪的改動', 'end', 'begin:Claude 這一輪的改動'])
    s.children[0]?.line(init())
    s.children[0]?.line(success('好'))
    expect(s.historyLog.at(-1)).toBe('end')
  })
})
