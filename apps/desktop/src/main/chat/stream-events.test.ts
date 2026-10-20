import { describe, expect, it } from 'vitest'

import { createLineParser, isBudgetChatter, signalsOf } from './stream-events'

/** `expect.stringContaining` 回傳 any，包成字串型別才不會被 lint 擋。 */
const contains = (text: string): string => expect.stringContaining(text) as string

const TOOL = 'mcp__slima-video-studio__create_shot'

describe('signalsOf：claude -p 串流事件 → 我們要用的訊號', () => {
  it('init：記下 session id，MCP 有連上才算數', () => {
    const connected = {
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      mcp_servers: [{ name: 'slima-video-studio', status: 'connected' }],
    }
    expect(signalsOf(connected)).toEqual([{ kind: 'init', sessionId: 's1', mcpConnected: true }])
    const failed = {
      ...connected,
      mcp_servers: [{ name: 'slima-video-studio', status: 'failed' }],
    }
    expect(signalsOf(failed)).toEqual([{ kind: 'init', sessionId: 's1', mcpConnected: false }])
    // 沒有我們的伺服器（被別的設定擋掉）
    expect(signalsOf({ ...connected, mcp_servers: [] })).toEqual([
      { kind: 'init', sessionId: 's1', mcpConnected: false },
    ])
  })

  it('文字一個字一個字長出來；思考與簽章的片段一律忽略', () => {
    const delta = (d: object) => ({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: d },
    })
    expect(signalsOf(delta({ type: 'text_delta', text: '好的' }))).toEqual([
      { kind: 'text', delta: '好的' },
    ])
    expect(signalsOf(delta({ type: 'thinking_delta', thinking: '想一想' }))).toEqual([])
    expect(signalsOf(delta({ type: 'signature_delta', signature: 'abc' }))).toEqual([])
    expect(signalsOf(delta({ type: 'input_json_delta', partial_json: '{"a"' }))).toEqual([])
  })

  it('工具一開始就出現（不等參數長完），名字去掉前綴；完整訊息裡的 tool_use 也有（呼叫端用 id 去重）', () => {
    const start = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't1', name: TOOL },
      },
    }
    expect(signalsOf(start)).toEqual([{ kind: 'tool_start', id: 't1', tool: 'create_shot' }])
    const full = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'x' },
          { type: 'tool_use', id: 't1', name: TOOL, input: {} },
        ],
      },
    }
    expect(signalsOf(full)).toEqual([{ kind: 'tool_start', id: 't1', tool: 'create_shot' }])
  })

  it('工具結果：成功或失敗，摘要最多 200 字，圖片只寫（圖片）', () => {
    const result = (content: unknown, isError?: boolean) => ({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content,
            ...(isError ? { is_error: true } : {}),
          },
        ],
      },
    })
    expect(signalsOf(result([{ type: 'text', text: '建好了\n第 1 鏡' }]))).toEqual([
      { kind: 'tool_result', id: 't1', ok: true, summary: '建好了 第 1 鏡' },
    ])
    expect(signalsOf(result('x'.repeat(500), true))).toEqual([
      { kind: 'tool_result', id: 't1', ok: false, summary: `${'x'.repeat(200)}…` },
    ])
    expect(
      signalsOf(
        result([
          { type: 'image', source: {} },
          { type: 'text', text: 'ok' },
        ]),
      ),
    ).toEqual([{ kind: 'tool_result', id: 't1', ok: true, summary: '（圖片） ok' }])
  })

  it('result：成功、被中斷、用量到上限、其他失敗各是一種；不貼原始錯誤文字', () => {
    expect(
      signalsOf({ type: 'result', subtype: 'success', is_error: false, result: '做好了' }),
    ).toEqual([{ kind: 'result', ok: true, interrupted: false, text: '做好了' }])
    expect(
      signalsOf({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        terminal_reason: 'aborted_streaming',
      }),
    ).toEqual([{ kind: 'result', ok: false, interrupted: true, text: '' }])
    const [budget] = signalsOf({
      type: 'result',
      subtype: 'error_max_budget_usd',
      is_error: true,
      result: 'raw',
    })
    expect(budget).toMatchObject({ kind: 'result', ok: false, interrupted: false })
    // 給使用者看的 error 是白話，不含 claude 回的原始文字
    expect(budget).toMatchObject({ error: contains('用量到上限'), resumable: true })
    // 步數到上限也能接著做；其他失敗不能
    expect(
      signalsOf({ type: 'result', subtype: 'error_max_turns', is_error: true })[0],
    ).toMatchObject({ resumable: true })
    expect(
      signalsOf({ type: 'result', subtype: 'error_during_execution', is_error: true })[0],
    ).not.toHaveProperty('resumable')
    expect((budget as { error?: string }).error).not.toContain('raw')
  })

  it('登入失敗的重試事件；子代理的事件、不認得的事件一律忽略', () => {
    expect(
      signalsOf({ type: 'system', subtype: 'api_retry', error: 'authentication_failed' }),
    ).toEqual([{ kind: 'auth_failed' }])
    expect(signalsOf({ type: 'system', subtype: 'api_retry', error: 'rate_limit' })).toEqual([])
    expect(
      signalsOf({
        type: 'stream_event',
        parent_tool_use_id: 'sub1',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
      }),
    ).toEqual([])
    for (const ignored of ['rate_limit_event', 'system'] as const) {
      expect(
        signalsOf({ type: ignored, subtype: 'commands_changed', skills: ['私人技能'] }),
      ).toEqual([])
    }
    expect(signalsOf('壞掉')).toEqual([])
  })
})

describe('createLineParser', () => {
  it('把片段拼成一行一行；壞行與空行略過，不中斷後面的', () => {
    const seen: unknown[] = []
    const push = createLineParser((e) => seen.push(e))
    push('{"a":1}\n{"b"')
    push(':2}\n\nnot json\n{"c":3}')
    push('\n')
    expect(seen).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })
})

describe('文字區塊的開始與結束，以及預算提示的碎碎念', () => {
  const streamEvent = (event: object) => ({ type: 'stream_event', event })
  it('文字區塊開始、任何區塊結束都有訊號（工具呼叫的開始仍只算工具）', () => {
    expect(
      signalsOf(
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
      ),
    ).toEqual([{ kind: 'text_start' }])
    expect(signalsOf(streamEvent({ type: 'content_block_stop', index: 0 }))).toEqual([
      { kind: 'block_end' },
    ])
    expect(
      signalsOf(
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        }),
      ),
    ).toEqual([])
  })

  it('isBudgetChatter：短的、沒有中文、在講 USD／session／agent budget 或 budget note 的才算', () => {
    expect(
      isBudgetChatter("Ignore the session USD budget note? It's the agent budget. Let's start."),
    ).toBe(true)
    expect(isBudgetChatter('USD budget: $0/$5; $5 remaining')).toBe(true)
    // 有中文：是真的回覆
    expect(isBudgetChatter('USD budget 是 Claude Code 附的提示')).toBe(false)
    // 沒在講預算提示
    expect(isBudgetChatter('Demo placeholders; content matches. Generate videos.')).toBe(false)
    expect(isBudgetChatter('')).toBe(false)
    // 太長：是真的在回答（例如使用者用英文問預算）
    expect(isBudgetChatter(`Here is the USD budget plan. ${'x'.repeat(300)}`)).toBe(false)
  })
})
