import { describe, expect, it } from 'vitest'

import { createLineParser, hasCjk, signalsOf, splitNotes, stripToolMarkup } from './stream-events'

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

describe('文字區塊的開始，以及英文工作筆記收起來', () => {
  const streamEvent = (event: object) => ({ type: 'stream_event', event })
  it('文字區塊開始有訊號（思考區塊、工具呼叫的開始沒有文字訊號；區塊結束不再有訊號）', () => {
    expect(
      signalsOf(
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
      ),
    ).toEqual([{ kind: 'text_start' }])
    expect(
      signalsOf(
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        }),
      ),
    ).toEqual([])
    expect(signalsOf(streamEvent({ type: 'content_block_stop', index: 0 }))).toEqual([])
  })

  it('splitNotes：中文回覆裡夾的一句短英文收起來，段落之間空一行', () => {
    expect(
      splitNotes([
        "Ignore the session USD budget note? It's the agent budget. Let's start.",
        '我先建專案。',
        'User explicitly asked; proceed.',
        '好了。',
      ]),
    ).toEqual({
      text: '我先建專案。\n\n好了。',
      notes: [
        "Ignore the session USD budget note? It's the agent budget. Let's start.",
        'User explicitly asked; proceed.',
      ],
    })
  })

  it('splitNotes：整則回覆都是英文（使用者用英文聊）一段都不收，連提到預算的也不收', () => {
    const reply = ['Your session budget is $5.', 'You have spent $0 so far.']
    expect(splitNotes(reply)).toEqual({ text: reply.join('\n\n'), notes: [] })
    expect(splitNotes(['USD budget: $0/$5; $5 remaining'])).toEqual({
      text: 'USD budget: $0/$5; $5 remaining',
      notes: [],
    })
  })

  it('splitNotes：長的英文段落不收（是真的在講話）；有中文的段落都留著；空段落略過', () => {
    const long = `Here is the plan. ${'x'.repeat(300)}`
    expect(splitNotes(['好的。', long, '', 'Ok 好']).notes).toEqual([])
    expect(splitNotes(['好的。', long, '', 'Ok 好']).text).toBe(`好的。\n\n${long}\n\nOk 好`)
  })
})

describe('stripToolMarkup：模型當成文字吐出來的工具呼叫標記', () => {
  it('整段 <invoke>…</invoke>（含 <parameter>）、<function_calls>、零散標籤都拿掉，旁邊的話留著', () => {
    expect(
      stripToolMarkup(
        '<invoke name="a__b">\n<parameter name="x">1</parameter>\n</invoke>\n\n我估了一下。',
      ).trim(),
    ).toBe('我估了一下。')
    expect(stripToolMarkup('<function_calls><invoke name="a"></invoke></function_calls>好')).toBe(
      '好',
    )
    expect(stripToolMarkup('好</invoke>')).toBe('好')
    expect(stripToolMarkup('<invoke name="a">x</invoke>好')).toBe('好')
  })

  it('串流到一半（標籤還沒收）：從開頭的標記到尾巴先不顯示', () => {
    expect(stripToolMarkup('我先看一下。<invoke name="mcp__slima-video-s')).toBe('我先看一下。')
  })

  it('沒有標記的文字、一般的角括號與程式碼說明原樣不動', () => {
    expect(stripToolMarkup('1 < 2，所以 a<b。')).toBe('1 < 2，所以 a<b。')
    expect(stripToolMarkup('用 <div> 包起來')).toBe('用 <div> 包起來')
    expect(stripToolMarkup('')).toBe('')
  })
})

describe('splitNotes 的 assumeCjk（串流途中）與 hasCjk', () => {
  it('assumeCjk：後面的中文還沒來，短英文先當筆記；不帶 assumeCjk 時（結束的重算）整則短英文原樣留著', () => {
    expect(splitNotes(['Ignore the budget note.'], { assumeCjk: true })).toEqual({
      text: '',
      notes: ['Ignore the budget note.'],
    })
    expect(splitNotes(['Ignore the budget note.'])).toEqual({
      text: 'Ignore the budget note.',
      notes: [],
    })
  })

  it('assumeCjk 也只收短的：超過上限的英文是真的在回答，照常顯示', () => {
    const long = 'word '.repeat(60)
    expect(splitNotes([long], { assumeCjk: true }).text).toBe(long.trim())
  })

  it('標記不論多長都先去掉，再判斷', () => {
    const markup = `<invoke name="x">${'a'.repeat(400)}</invoke>`
    expect(splitNotes([markup, '好。'])).toEqual({ text: '好。', notes: [] })
  })

  it('hasCjk', () => {
    expect(hasCjk('幫我加一個鏡頭')).toBe(true)
    expect(hasCjk('add a shot')).toBe(false)
  })
})
