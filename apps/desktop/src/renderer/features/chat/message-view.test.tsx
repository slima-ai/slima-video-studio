import { cleanup, render, screen } from '@testing-library/react'
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
      screen.getByText('已經建好專案「Claude 建的短片」，加了兩個鏡頭。'),
    ]) {
      // wrap-zh 帶 word-break: keep-all，中文句子只在空白與標點才折，會在奇怪的地方斷
      expect(el.className).not.toContain('wrap-zh')
      expect(el.className).toContain('break-words')
    }
  })
})
