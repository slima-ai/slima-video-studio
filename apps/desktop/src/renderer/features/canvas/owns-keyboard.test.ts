import { describe, expect, it } from 'vitest'

import { ownsKeyboard } from './owns-keyboard'

const make = (html: string): HTMLElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  const el = host.firstElementChild
  if (!(el instanceof HTMLElement)) throw new Error('沒有元素')
  return el
}

describe('ownsKeyboard：焦點在哪些東西上，畫布不處理 Delete／Backspace', () => {
  it('卡片裡的影片：焦點在 <video> 上按 Delete 不會刪卡', () => {
    const card = make(
      '<div class="react-flow__node"><video data-testid="inline-video" tabindex="0"></video></div>',
    )
    const video = card.querySelector('video')
    expect(ownsKeyboard(video)).toBe(true)
    // 事件從影片冒到 window，畫布看到的 target 還是影片
    let seen: EventTarget | null = null
    window.addEventListener(
      'keydown',
      (event) => {
        seen = event.target
      },
      { once: true },
    )
    video?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    expect(ownsKeyboard(seen)).toBe(true)
  })

  it('輸入框、按鈕（播放控制列的暫停、靜音）、進度與音量條、選單項目也一樣', () => {
    for (const html of [
      '<input>',
      '<textarea></textarea>',
      '<select></select>',
      '<button>暫停</button>',
      '<input type="range">',
      '<div role="menuitem">複製</div>',
    ]) {
      expect(ownsKeyboard(make(html)), html).toBe(true)
    }
  })

  it('卡片本身、畫布空白處、沒有焦點：照常處理（Delete 刪選取的卡）', () => {
    // jsdom 沒有實作 isContentEditable（undefined），所以用 falsy 比
    expect(ownsKeyboard(make('<div class="react-flow__node">卡</div>'))).toBeFalsy()
    expect(ownsKeyboard(make('<div class="react-flow__pane"></div>'))).toBeFalsy()
    expect(ownsKeyboard(document.body)).toBeFalsy()
    expect(ownsKeyboard(null)).toBeFalsy()
  })
})
