import type { ChatConversation, ChatPanelMessage, ChatPrereq } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { ChatProvider } from './chat-context'
import { ChatDrawer } from './chat-drawer'
import { ChatLauncher } from './chat-launcher'

const ID = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const AT = '2026-10-20T10:00:00.000Z'

const conversation = (patch: Partial<ChatConversation> = {}): ChatConversation => ({
  id: ID,
  title: '新對話',
  createdAt: AT,
  updatedAt: AT,
  running: false,
  ...patch,
})
const message = (patch: Partial<ChatPanelMessage>): ChatPanelMessage => ({
  id: 'm1',
  role: 'assistant',
  text: '',
  steps: [],
  at: AT,
  ...patch,
})

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

function setup(
  options: {
    prereq?: ChatPrereq
    packaged?: boolean
    claudeChat?: boolean
    conversations?: ChatConversation[]
    messages?: Record<string, ChatPanelMessage[]>
  } = {},
) {
  let created = 0
  const fake = installFakeSvs({
    'app.getInfo': () => ({
      name: 'x',
      version: '0',
      platform: 'darwin',
      packaged: options.packaged ?? false,
    }),
    'settings.get': () => ({
      onboardingDone: true,
      demoMode: true,
      advancedMode: false,
      storyboardGuide: '',
      mcp: { enabled: true, port: 47821, allowanceUsd: 0 },
      theme: 'system',
      models: {},
      budget: { perRunLimitUsd: 5 },
      modelNotices: [],
      audio: { voices: {} },
      experiments: options.claudeChat === undefined ? {} : { claudeChat: options.claudeChat },
    }),
    'chat.status': () => options.prereq ?? { state: 'ready', version: '2.1.304' },
    'chat.list': () => ({ conversations: options.conversations ?? [] }),
    'chat.create': () => conversation({ id: created++ === 0 ? ID : ID2 }),
    'chat.messages': (p: { conversationId: string }) => ({
      messages: options.messages?.[p.conversationId] ?? [],
    }),
    'chat.send': () => ({}),
    'chat.stop': () => ({}),
    'settings.update': () => ({}),
  })
  render(
    <ChatProvider>
      <ChatLauncher />
      <ChatDrawer />
    </ChatProvider>,
  )
  return fake
}

const openPanel = async (): Promise<void> => {
  fireEvent.click(await screen.findByTestId('chat-launcher'))
}

describe('Claude 對話面板：開關與開啟', () => {
  it('開發版預設有右下角按鈕；打包版預設沒有；使用者在設定頁設了就照他的', async () => {
    setup({ packaged: false })
    expect(await screen.findByTestId('chat-launcher')).toBeTruthy()
    cleanup()
    setup({ packaged: true })
    await waitFor(() => {
      expect(screen.queryByTestId('chat-launcher')).toBeNull()
    })
    expect(screen.queryByTestId('chat-drawer')).toBeNull()
    cleanup()
    setup({ packaged: true, claudeChat: true })
    expect(await screen.findByTestId('chat-launcher')).toBeTruthy()
    cleanup()
    setup({ packaged: false, claudeChat: false })
    await waitFor(() => {
      expect(screen.queryByTestId('chat-launcher')).toBeNull()
    })
  })

  it('一開始是收起的（內容不可操作）；按按鈕整條從右邊滑出；再按收起', async () => {
    setup()
    const drawer = await screen.findByTestId('chat-drawer')
    expect(drawer.getAttribute('data-open')).toBe('false')
    expect(drawer.hasAttribute('inert')).toBe(true)
    await openPanel()
    expect(drawer.getAttribute('data-open')).toBe('true')
    expect(drawer.hasAttribute('inert')).toBe(false)
    expect(await screen.findByTestId('chat-input')).toBeTruthy()
    fireEvent.click(screen.getByTestId('chat-launcher'))
    expect(drawer.getAttribute('data-open')).toBe('false')
  })

  it('沒有任何對話時自動開一個，可以直接開始講', async () => {
    const fake = setup()
    await openPanel()
    await screen.findByTestId('chat-input')
    expect(fake.calls.filter((c) => c.channel === 'chat.create')).toHaveLength(1)
  })

  it('有舊對話：選最近的一個、載入它的內容，也可以切換與開新對話', async () => {
    const fake = setup({
      conversations: [
        conversation({ id: ID, title: '甲' }),
        conversation({ id: ID2, title: '乙' }),
      ],
      messages: {
        [ID]: [message({ id: 'u1', role: 'user', text: '嗨甲' })],
        [ID2]: [message({ id: 'u2', role: 'user', text: '嗨乙' })],
      },
    })
    await openPanel()
    expect(await screen.findByText('嗨甲')).toBeTruthy()
    fireEvent.change(screen.getByTestId('chat-conversation-select'), { target: { value: ID2 } })
    expect(await screen.findByText('嗨乙')).toBeTruthy()
    expect(screen.queryByText('嗨甲')).toBeNull()
    fireEvent.click(screen.getByTestId('chat-new'))
    await waitFor(() => {
      expect(fake.calls.filter((c) => c.channel === 'chat.create')).toHaveLength(1)
    })
  })
})

describe('Claude 對話面板：還不能開始時的說明卡', () => {
  it.each([
    [{ state: 'not_installed' }, '需要你電腦上的 Claude Code'],
    [{ state: 'too_old', version: '2.0.0', minVersion: '2.1.259' }, '版本太舊'],
    [{ state: 'not_logged_in', version: '2.1.304' }, '請先登入 Claude Code'],
    [{ state: 'mcp_off' }, '先打開「AI 工具連線」'],
  ] as const)('%j：說明卡寫「%s」，不顯示輸入框', async (prereq, words) => {
    setup({ prereq })
    await openPanel()
    const card = await screen.findByTestId('chat-prereq')
    expect(card.getAttribute('data-state')).toBe(prereq.state)
    expect(card.textContent).toContain(words)
    expect(screen.queryByTestId('chat-input')).toBeNull()
  })

  it('mcp_off 的說明用設定頁現在的名字：「AI 工具的總額度」「設定 → AI 工具連線」，沒有舊字「可以花多少」', async () => {
    setup({ prereq: { state: 'mcp_off' } })
    await openPanel()
    const text = (await screen.findByTestId('chat-prereq')).textContent
    expect(text).toContain('受「AI 工具的總額度」限制')
    expect(text).toContain('「設定 → AI 工具連線」調高「AI 工具的總額度」')
    expect(text).not.toContain('可以花多少')
  })

  it('disabled 的說明講「打開」開關，不講「勾選」', async () => {
    setup({ prereq: { state: 'disabled' } })
    await openPanel()
    const text = (await screen.findByTestId('chat-prereq')).textContent
    expect(text).toContain('「設定」→「實驗功能」，打開「畫布右下角的 Claude 對話」')
    expect(text).not.toContain('勾選')
  })

  it('沒登入：「我登入好了」重新檢查；這一次通過就出現輸入框', async () => {
    let state: ChatPrereq = { state: 'not_logged_in', version: '2.1.304' }
    const fake = installFakeSvs({
      'app.getInfo': () => ({ name: 'x', version: '0', platform: 'darwin', packaged: false }),
      'chat.status': () => state,
      'chat.list': () => ({ conversations: [conversation()] }),
      'chat.messages': () => ({ messages: [] }),
    })
    render(
      <ChatProvider>
        <ChatLauncher />
        <ChatDrawer />
      </ChatProvider>,
    )
    await openPanel()
    await screen.findByTestId('chat-prereq')
    state = { state: 'ready', version: '2.1.304' }
    fireEvent.click(screen.getByTestId('chat-recheck'))
    expect(await screen.findByTestId('chat-input')).toBeTruthy()
    const statusCalls = fake.calls.filter((c) => c.channel === 'chat.status')
    expect(statusCalls).toHaveLength(2)
    // 第一次打開用預熱好的結果；使用者按「重新檢查」一定重問
    expect(statusCalls.map((c) => c.payload)).toEqual([{ fresh: false }, { fresh: true }])
  })

  it('AI 工具連線沒開：一個按鈕打開它，再檢查一次', async () => {
    let mcpOn = false
    const fake = installFakeSvs({
      'app.getInfo': () => ({ name: 'x', version: '0', platform: 'darwin', packaged: false }),
      'chat.status': () => (mcpOn ? { state: 'ready', version: '2.1.304' } : { state: 'mcp_off' }),
      'chat.list': () => ({ conversations: [conversation()] }),
      'chat.messages': () => ({ messages: [] }),
      'settings.update': () => {
        mcpOn = true
        return {}
      },
    })
    render(
      <ChatProvider>
        <ChatLauncher />
        <ChatDrawer />
      </ChatProvider>,
    )
    await openPanel()
    fireEvent.click(await screen.findByText('打開 AI 工具連線'))
    expect(await screen.findByTestId('chat-input')).toBeTruthy()
    expect(fake.calls.find((c) => c.channel === 'settings.update')?.payload).toEqual({
      mcp: { enabled: true },
    })
    // 只有開關變了、Claude Code 沒變：再檢查一次用查好的結果，不重問
    expect(fake.calls.filter((c) => c.channel === 'chat.status').map((c) => c.payload)).toEqual([
      { fresh: false },
      { fresh: false },
    ])
  })
})

describe('Claude 對話面板：講話與串流', () => {
  it('Enter 送出（Shift+Enter 換行、輸入法選字中的 Enter 不送）；送出後輸入框清空', async () => {
    const fake = setup({ conversations: [conversation()] })
    await openPanel()
    const input = await screen.findByTestId<HTMLTextAreaElement>('chat-input')
    fireEvent.change(input, { target: { value: '建三個鏡頭' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(fake.calls.filter((c) => c.channel === 'chat.send')).toHaveLength(0)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(fake.calls.find((c) => c.channel === 'chat.send')?.payload).toEqual({
        conversationId: ID,
        text: '建三個鏡頭',
      })
    })
    await waitFor(() => {
      expect(input.value).toBe('')
    })
  })

  it('主程序推來的訊息：使用者的話、工具步驟（進行中→做完）、一路長出來的文字、做完', async () => {
    const fake = setup({ conversations: [conversation()] })
    await openPanel()
    await screen.findByTestId('chat-input')
    const push = (m: ChatPanelMessage): void => {
      act(() => {
        fake.emit('chat.event', { type: 'message', conversationId: ID, message: m })
      })
    }
    push(message({ id: 'u', role: 'user', text: '建一個鏡頭' }))
    expect(screen.getByTestId('chat-message-user').textContent).toBe('建一個鏡頭')
    push(message({ id: 'a', state: 'streaming' }))
    expect(screen.getByText('Claude 正在想…')).toBeTruthy()
    push(
      message({
        id: 'a',
        state: 'streaming',
        steps: [{ id: 't', tool: 'create_shot', label: '正在建立鏡頭…', status: 'running' }],
      }),
    )
    expect(screen.getByTestId('chat-step').textContent).toBe('正在建立鏡頭…')
    expect(screen.getByTestId('chat-step').getAttribute('data-status')).toBe('running')
    push(
      message({
        id: 'a',
        state: 'done',
        text: '建好了第 1 鏡。',
        steps: [
          { id: 't', tool: 'create_shot', label: '建立鏡頭', status: 'done', summary: '第 1 鏡' },
        ],
      }),
    )
    expect(screen.getAllByTestId('chat-step')).toHaveLength(1)
    expect(screen.getByTestId('chat-step').getAttribute('data-status')).toBe('done')
    expect(screen.getByText('建好了第 1 鏡。')).toBeTruthy()
  })

  it('Claude 做事時送出鈕變成停止鈕；按停止或 Esc 都送 chat.stop；做完換回送出', async () => {
    const fake = setup({ conversations: [conversation()] })
    await openPanel()
    const input = await screen.findByTestId('chat-input')
    expect(screen.queryByTestId('chat-stop')).toBeNull()
    act(() => {
      fake.emit('chat.event', {
        type: 'conversation',
        conversation: conversation({ running: true }),
      })
    })
    fireEvent.click(screen.getByTestId('chat-stop'))
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => {
      expect(fake.calls.filter((c) => c.channel === 'chat.stop')).toEqual([
        { channel: 'chat.stop', payload: { conversationId: ID } },
        { channel: 'chat.stop', payload: { conversationId: ID } },
      ])
    })
    act(() => {
      fake.emit('chat.event', {
        type: 'conversation',
        conversation: conversation({ running: false }),
      })
    })
    expect(screen.queryByTestId('chat-stop')).toBeNull()
    expect(screen.getByTestId('chat-send')).toBeTruthy()
  })

  it('已停止與出錯都有白話說明', async () => {
    const fake = setup({ conversations: [conversation()] })
    await openPanel()
    await screen.findByTestId('chat-input')
    act(() => {
      fake.emit('chat.event', {
        type: 'message',
        conversationId: ID,
        message: message({ id: 'a', state: 'stopped' }),
      })
    })
    expect(screen.getByTestId('chat-stopped').textContent).toContain(
      '已經送出去的生成任務不會跟著取消',
    )
    act(() => {
      fake.emit('chat.event', {
        type: 'message',
        conversationId: ID,
        message: message({ id: 'b', state: 'error', error: '和 Claude 的連線中斷了。' }),
      })
    })
    expect(screen.getByTestId('chat-error').textContent).toBe('和 Claude 的連線中斷了。')
  })

  it('用量到上限：最後一則出現「繼續」，按了送出接著做的話；不是最後一則、一般失敗、進行中都沒有', async () => {
    const fake = setup({ conversations: [conversation()] })
    await openPanel()
    await screen.findByTestId('chat-input')
    const emit = (m: ChatPanelMessage): void => {
      act(() => {
        fake.emit('chat.event', { type: 'message', conversationId: ID, message: m })
      })
    }
    // 一般失敗：沒有繼續
    emit(message({ id: 'a', state: 'error', error: '連線中斷了。' }))
    expect(screen.queryByTestId('chat-continue')).toBeNull()
    // 用量到上限：有
    emit(message({ id: 'u', role: 'user', text: '第 2 鏡改成近景' }))
    emit(message({ id: 'b', state: 'error', error: '這一段用量到上限了。', resumable: true }))
    fireEvent.click(screen.getByTestId('chat-continue'))
    await waitFor(() => {
      // 只續做被打斷的那一句，不是「接著剛才的做下去」
      expect(fake.calls.find((c) => c.channel === 'chat.send')?.payload).toEqual({
        conversationId: ID,
        text: '剛才那句「第 2 鏡改成近景」被用量上限打斷。先看專案現在的狀態，把那句還沒做完的部分做完；不要做那句以外的事。',
      })
    })
    // 後面又有新的一則：舊的那則不再有按鈕
    emit(message({ id: 'c', state: 'streaming' }))
    expect(screen.queryByTestId('chat-continue')).toBeNull()
  })

  it('專案換了（另存為、開別的專案）：丟掉舊專案的對話，載入新專案的；沒有就開一個空的', async () => {
    const options: Parameters<typeof setup>[0] = {
      conversations: [conversation({ id: ID, title: '舊專案的對話' })],
      messages: { [ID]: [message({ id: 'u1', role: 'user', text: '舊專案裡說的' })] },
    }
    const fake = setup(options)
    await openPanel()
    expect(await screen.findByText('舊專案裡說的')).toBeTruthy()
    // 換到另一個專案：它有自己的一個對話
    options.conversations = [conversation({ id: ID2, title: '新專案的對話' })]
    options.messages = { [ID2]: [message({ id: 'u2', role: 'user', text: '新專案裡說的' })] }
    act(() => {
      fake.emit('chat.event', { type: 'reset' })
    })
    expect(await screen.findByText('新專案裡說的')).toBeTruthy()
    expect(screen.queryByText('舊專案裡說的')).toBeNull()
    // 再換到一個沒有任何對話的專案：自動開一個空的、可以直接講
    options.conversations = []
    options.messages = {}
    act(() => {
      fake.emit('chat.event', { type: 'reset' })
    })
    await waitFor(() => {
      expect(screen.queryByText('新專案裡說的')).toBeNull()
    })
    expect(await screen.findByTestId('chat-input')).toBeTruthy()
    expect(fake.calls.filter((c) => c.channel === 'chat.create').length).toBeGreaterThan(0)
  })
})
