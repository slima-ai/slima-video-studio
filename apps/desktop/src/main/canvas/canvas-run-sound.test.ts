import { describe, expect, it } from 'vitest'

import { soundDoneNotice, soundStartNotice } from './canvas-run-sound'

const plan = (patch: Partial<Parameters<typeof soundStartNotice>[0] & object> = {}) => ({
  narration: true,
  music: true,
  narrationShots: 3,
  dialogueShots: 3,
  usd: 0.1,
  ...patch,
})

describe('soundStartNotice：開始加聲音時只寫真的會做的', () => {
  it('有台詞的鏡頭＋配樂：旁白與配樂；沒有台詞：只有配樂；兩樣都沒有東西要加：不通知', () => {
    expect(soundStartNotice(plan())?.message).toBe('成品接好了，正在加旁白與配樂…')
    expect(soundStartNotice(plan({ narrationShots: 0, dialogueShots: 0 }))?.message).toBe(
      '成品接好了，正在加配樂…',
    )
    expect(soundStartNotice(plan({ music: false }))?.message).toBe('成品接好了，正在加旁白…')
    expect(soundStartNotice(plan({ narrationShots: 0, music: false }))).toBeUndefined()
    expect(soundStartNotice(undefined)).toBeUndefined()
  })
})

describe('soundDoneNotice：加完聲音的那一句，說實話', () => {
  it('旁白與配樂都加了；只加旁白；只加配樂', () => {
    expect(soundDoneNotice({ narrations: 3, music: true }).message).toBe('旁白與配樂也加好了')
    expect(soundDoneNotice({ narrations: 3, music: false }).message).toBe('旁白加好了')
    expect(soundDoneNotice({ narrations: 0, music: true }).message).toBe('配樂加好了')
  })

  it('要念旁白、卻沒有鏡頭可念：說原因（沒有台詞／有台詞的都已經有旁白）', () => {
    expect(
      soundDoneNotice({ narrations: 0, music: true, noNarrationBecause: { dialogueShots: 0 } })
        .message,
    ).toBe('配樂加好了；沒有鏡頭有台詞，所以沒有旁白')
    expect(
      soundDoneNotice({ narrations: 0, music: true, noNarrationBecause: { dialogueShots: 2 } })
        .message,
    ).toBe('配樂加好了；有台詞的鏡頭都已經有旁白了')
    expect(
      soundDoneNotice({ narrations: 0, music: false, noNarrationBecause: { dialogueShots: 0 } })
        .message,
    ).toBe('成品接好了；沒有鏡頭有台詞，所以沒有旁白')
  })

  it('加不成：danger，指向成品面板', () => {
    expect(soundDoneNotice({ narrations: 0, music: false, problem: '沒有可用的模型' })).toEqual({
      tone: 'danger',
      message: '聲音沒加成（沒有可用的模型）：可以在成品面板的「聲音」區再試',
    })
  })
})
