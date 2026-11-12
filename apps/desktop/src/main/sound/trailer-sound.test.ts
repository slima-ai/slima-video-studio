import type { LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness, type HarnessOptions } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})
const setup = (options: HarnessOptions = {}) => {
  const h = createStudioHarness(options)
  harnesses.push(h)
  return h
}

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

describe('預告片的配樂：描述跟著腳本', () => {
  it('有預告片設定：描述有每一段的起訖秒數、片名前靜音、結尾重音、不要人聲、使用者選的情緒；長度＝成品長度＋3 秒，最後淡出 1.5 秒', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY, musicMood: '緊張、壓迫' })
    const film = h.sound.state().totalSec
    expect(film).toBeCloseTo(30, 1)
    const clip = await h.sound.generateMusic({})
    // 生成紀錄裡那一筆的文字（＝送給配樂模型的描述）
    expect(clip.text).toContain('Instrumental only, no vocals')
    expect(clip.text).toContain('Timeline: 0.0–')
    expect(clip.text).toMatch(/title: /)
    expect(clip.text).toMatch(/short silence at 2\d\.\d–2\d\.\d s, right before the title card/)
    expect(clip.text).toMatch(/final accent at 2\d\.\d s/)
    expect(clip.text).toContain('緊張、壓迫')
    expect(clip.text).toContain('33 s long')
    // 要的長度（示範的配樂照要求的秒數做）與淡出
    expect(clip.durationSec).toBeCloseTo(film + 3, 0)
    expect(clip.fadeOutSec).toBe(1.5)
  })

  it('不是預告片的專案：描述、長度、淡出都跟以前一樣', async () => {
    const h = setup()
    await h.runQuickStart()
    const clip = await h.sound.generateMusic({})
    expect(clip.text).toContain('Instrumental only, no vocals')
    expect(clip.text).not.toContain('Timeline')
    expect(clip.fadeOutSec).toBeUndefined()
    expect(clip.durationSec).toBeCloseTo(h.sound.state().totalSec, 0)
  })

  it('自己給了描述：用自己的，不被腳本蓋掉；要求的長度與淡出照預告片的規則', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const clip = await h.sound.generateMusic({ prompt: 'Calm piano, instrumental only.' })
    expect(clip.text).toBe('Calm piano, instrumental only.')
    expect(clip.fadeOutSec).toBe(1.5)
  })

  it('舊專案的腳本沒存段落：照類型模板的比例排各段，仍有時間碼', async () => {
    const h = setup()
    await h.trailer.plan({ text: STORY })
    const handle = h.projects.current()
    // 模擬 T7c 以前存的腳本：鏡頭沒有段落
    for (const shot of handle?.repos.shots.list() ?? []) {
      handle?.repos.shots.update(shot.id, { segment: undefined })
    }
    const clip = await h.sound.generateMusic({})
    expect(clip.text).toContain('hook:')
    expect(clip.text).toContain('escalate:')
    expect(clip.text).toMatch(/Timeline: 0\.0–3\.9 s hook/)
  })
})

describe('旁白貼合格子：念完量長度，太長就請文字模型改短、重念一次', () => {
  /** 示範的配音一個字約 0.08 秒：60 個字約 4.8 秒。 */
  const LONG =
    '黑藤爬滿了斷橋，她一個人守著最後一盞燈，直到有人敲門，門外的人說他來自河的另一邊，帶著一封沒有人敢拆開的信。'
  const COST = 0.01

  /** 假的文字模型：只回應「改短」請求，記下每一次問的內容。 */
  const shortener = (reply: (request: LlmRequest) => string | undefined) => {
    const calls: LlmRequest[] = []
    const llm = (request: LlmRequest): string | undefined => {
      if (!request.messages.some((m) => m.content.includes('請把這句旁白改短'))) return undefined
      calls.push(request)
      return reply(request)
    }
    return { calls, llm }
  }

  /** 一支 2 秒的鏡頭（影片真的是 2 秒）、台詞很長。 */
  async function twoSecondShot(h: ReturnType<typeof setup>, dialogue = LONG): Promise<string> {
    await h.runQuickStart({ durationSec: 2 })
    const first = h.shots.list().shots[0]
    if (!first) throw new Error('應該有鏡頭')
    h.shots.update(first.id, { dialogue })
    return first.id
  }
  const costRows = (h: ReturnType<typeof setup>) => {
    const handle = h.projects.current()
    return handle ? handle.repos.costs.list(handle.projectId) : []
  }

  it('3 秒以上的旁白放不進 2 秒的格子：改短一次、重念一次；台詞跟著換成改短的、提示說得出原句與新句、花費記三筆（念、改、再念）', async () => {
    const short = '黑藤爬滿了斷橋，她守著最後一盞燈，直到有人敲門。'
    const { calls, llm } = shortener(() => short)
    const h = setup({ mockLlm: llm, mockCostUsd: () => COST })
    const shotId = await twoSecondShot(h)
    const spentBefore = costRows(h).length
    const result = await h.sound.generateNarration({ shotId })
    expect(calls).toHaveLength(1)
    // 問模型的內容：原句、字數上限（比原句短）、鏡頭秒數
    const asked = calls[0]?.messages.map((m) => m.content).join('\n') ?? ''
    expect(asked).toContain(LONG)
    const limit = Number(/字數上限 (\d+) 個字/.exec(asked)?.[1])
    expect(limit).toBeGreaterThan(0)
    expect(limit).toBeLessThan(LONG.length)
    // 重念：新的版本、念的是改短的那句；台詞跟著換
    expect(result).toMatchObject({ version: 2, adopted: true, text: short })
    expect(result.shortened).toEqual({ shotNumber: 1, from: LONG, to: short })
    expect(h.shots.list().shots[0]?.dialogue).toBe(short)
    // 念完沒有超出格子，也沒有「台詞改過了」的警告
    const warnings = h.sound.state().warnings.map((w) => w.kind)
    expect(warnings).not.toContain('narration_too_long')
    expect(warnings).not.toContain('narration_text_changed')
    // 花費：念一次、改短一次、再念一次，各記一筆
    const rows = costRows(h).slice(spentBefore)
    expect(rows).toHaveLength(3)
    expect(rows.reduce((sum, r) => sum + r.amountUsd, 0)).toBeCloseTo(3 * COST, 9)
  })

  it('改短以後還是太長：不再試第二次，保留改短的版本、照現在的警告；花費仍是三筆', async () => {
    // 回一句只短了一點的（約 45 個字 ≈ 3.6 秒，還是超出 2 秒的格子）
    const stillLong = LONG.slice(0, 45)
    const { calls, llm } = shortener(() => stillLong)
    const h = setup({ mockLlm: llm, mockCostUsd: () => COST })
    const shotId = await twoSecondShot(h)
    const before = costRows(h).length
    const result = await h.sound.generateNarration({ shotId })
    expect(calls).toHaveLength(1)
    expect(result.version).toBe(2)
    expect(h.sound.state().warnings.map((w) => w.kind)).toContain('narration_too_long')
    expect(costRows(h).length - before).toBe(3)
  })

  it('旁白放得進格子：不呼叫文字模型、不重念、沒有提示', async () => {
    const { calls, llm } = shortener(() => '不該被呼叫')
    const h = setup({ mockLlm: llm, mockCostUsd: () => COST })
    const shotId = await twoSecondShot(h, '短短一句。')
    const result = await h.sound.generateNarration({ shotId })
    expect(calls).toHaveLength(0)
    expect(result.version).toBe(1)
    expect(result.shortened).toBeUndefined()
  })

  it('模型回的不比原句短、回空字串、或呼叫失敗：不重念、保留原旁白與警告，也不丟錯', async () => {
    for (const reply of [
      () => LONG + '啊',
      () => '   ',
      () => {
        throw new Error('網路斷了')
      },
    ]) {
      const { calls, llm } = shortener(reply)
      const h = setup({ mockLlm: llm, mockCostUsd: () => COST })
      const shotId = await twoSecondShot(h)
      const result = await h.sound.generateNarration({ shotId })
      expect(calls).toHaveLength(1)
      expect(result.version).toBe(1)
      expect(result.shortened).toBeUndefined()
      expect(h.shots.list().shots[0]?.dialogue).toBe(LONG)
      expect(h.sound.state().warnings.map((w) => w.kind)).toContain('narration_too_long')
    }
  })
})
