import type { ChatPanelMessage } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { continueText } from './continue-text'

const AT = '2026-10-21T00:00:00.000Z'
const user = (id: string, text: string): ChatPanelMessage => ({
  id,
  role: 'user',
  text,
  steps: [],
  at: AT,
})
const claude = (id: string, patch: Partial<ChatPanelMessage> = {}): ChatPanelMessage => ({
  id,
  role: 'assistant',
  text: '',
  steps: [],
  at: AT,
  state: 'error',
  resumable: true,
  ...patch,
})

describe('continueText：「繼續」只續做被打斷的那一句', () => {
  it('引用使用者最後一句話，說先看專案現在的狀態、只做那一句', () => {
    const messages = [user('u1', '第 2 鏡改成近景'), claude('a1')]
    expect(continueText(messages, 1)).toBe(
      '剛才那句「第 2 鏡改成近景」被用量上限打斷。先看專案現在的狀態，把那句還沒做完的部分做完；不要做那句以外的事。',
    )
  })

  it('不再是會讓 Claude 把預告的影片、配樂、匯出全做掉的「接著剛才的做下去」', () => {
    const text = continueText([user('u1', '改鏡頭'), claude('a1')], 1)
    expect(text).not.toContain('接著剛才的做下去')
    expect(text).toContain('不要做那句以外的事')
  })

  it('用最靠近的那句使用者的話，不是第一句', () => {
    const messages = [
      user('u1', '幫我做一支短片'),
      claude('a1', { state: 'done', resumable: false, text: '做好了，你說「繼續」我就生成影片' }),
      user('u2', '第 2 鏡改成近景'),
      claude('a2'),
    ]
    const text = continueText(messages, 3)
    expect(text).toContain('「第 2 鏡改成近景」')
    expect(text).not.toContain('幫我做一支短片')
  })

  it('按過一次「繼續」又被打斷：引用的還是使用者最早的原話，不會一層包一層', () => {
    const first = continueText([user('u1', '第 2 鏡改成近景'), claude('a1')], 1)
    const text = continueText(
      [user('u1', '第 2 鏡改成近景'), claude('a1'), user('u2', first), claude('a2')],
      3,
    )
    expect(text).toBe(first)
  })

  it('原話很長：只留開頭並加「…」；換行與多餘空白壓成一個空格', () => {
    const long = `第一行\n第二行 ${'字'.repeat(400)}`
    const text = continueText([user('u1', long), claude('a1')], 1)
    expect(text).toContain('「第一行 第二行 ')
    expect(text).toContain('…」被用量上限打斷。')
    expect(text.length).toBeLessThan(400)
  })

  it('找不到使用者的話（理論上不會）：不引用，仍然說只做被打斷的那件事', () => {
    const text = continueText([claude('a1')], 0)
    expect(text).toContain('被用量上限打斷了')
    expect(text).toContain('不要做那件事以外的事')
    expect(text).not.toContain('「')
  })
})
