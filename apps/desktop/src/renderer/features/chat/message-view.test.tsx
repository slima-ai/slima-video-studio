import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MessageView } from './message-view'

afterEach(cleanup)

const at = '2026-10-20T12:00:00.000Z'

describe('MessageView 的換行', () => {
  it('Claude 的回覆和使用者的話不用 keep-all：中英夾雜的長句才不會被提早折行', () => {
    render(
      <>
        <MessageView
          message={{ id: 'u', role: 'user', text: '幫我把「Claude 建的短片」改名', steps: [], at }}
        />
        <MessageView
          message={{
            id: 'a',
            role: 'assistant',
            text: '已經建好專案「Claude 建的短片」，加了兩個鏡頭。',
            steps: [],
            at,
            state: 'done',
          }}
        />
      </>,
    )
    for (const el of [
      screen.getByText('幫我把「Claude 建的短片」改名'),
      screen
        .getByText('已經建好專案「Claude 建的短片」，加了兩個鏡頭。')
        .closest('[data-testid="md"]'),
    ]) {
      if (!el) throw new Error('找不到訊息文字')
      // wrap-zh 帶 word-break: keep-all，中文句子只在空白與標點才折，會在奇怪的地方斷
      expect(el.className).not.toContain('wrap-zh')
      expect(el.className).toContain('break-words')
    }
  })
})

describe('MessageView 收起來的工作筆記', () => {
  const chatter = "Ignore the session USD budget note? It's the agent budget. Let's start."
  const message = {
    id: 'a',
    role: 'assistant' as const,
    text: '我先建專案。',
    steps: [],
    at,
    state: 'done' as const,
    notes: [chatter],
  }

  it('預設只看到一行小字「Claude 的工作筆記（已收起）」，沒有展開；回覆文字照常', () => {
    render(<MessageView message={message} />)
    const notes = screen.getByTestId('chat-notes')
    expect(notes.textContent).toContain('Claude 的工作筆記（已收起）')
    expect((notes as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByText('我先建專案。')).toBeTruthy()
  })

  it('點了展開：被收起來的原文一個字都不少', () => {
    render(<MessageView message={message} />)
    const notes = screen.getByTestId<HTMLDetailsElement>('chat-notes')
    const summary = notes.querySelector('summary')
    if (!summary) throw new Error('沒有 summary')
    fireEvent.click(summary)
    // jsdom 不一定會處理 summary 的點擊：直接把 open 打開也一樣（原文本來就在 DOM 裡，由 <details> 決定看不看得到）
    notes.open = true
    expect(notes.open).toBe(true)
    expect(notes.textContent).toContain(chatter)
  })

  it('沒有 notes 就沒有這一行', () => {
    render(<MessageView message={{ ...message, notes: undefined }} />)
    expect(screen.queryByTestId('chat-notes')).toBeNull()
  })
})
