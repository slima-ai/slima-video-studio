import type { ProjectHandle } from '@svs/db'
import { ModelRegistry, loadBuiltinModelCards } from '@svs/providers'
import { describe, expect, it } from 'vitest'

import { MADE_WITH, collectAttributions, creditLines } from './credits'
import { creditsHtml } from './render-card-electron'

const registry = new ModelRegistry(loadBuiltinModelCards())

/** 只有 collectAttributions 讀得到的那幾個資料表。 */
function fakeHandle(input: {
  takes?: { kind: 'first_frame' | 'video'; modelId: string; adopted: boolean }[]
  clips?: { modelId: string }[]
  jobs?: { kind: string; status: string; modelId: string }[]
}): ProjectHandle {
  const takes = input.takes ?? []
  return {
    repos: {
      shots: {
        list: () => [{ id: 's1' }],
        listTakes: (_shotId: string, kind: string) => takes.filter((t) => t.kind === kind),
      },
      sound: { listClips: () => input.clips ?? [] },
      jobs: { list: () => input.jobs ?? [] },
    },
  } as unknown as ProjectHandle
}

describe('collectAttributions', () => {
  it('列出實際用到的服務：影片、圖片、聲音、配樂、其他，去重；沒用到的模型不列', () => {
    const handle = fakeHandle({
      takes: [
        { kind: 'video', modelId: 'openrouter/kling-3.0-standard', adopted: true },
        { kind: 'first_frame', modelId: 'openrouter/gpt-image-2-high', adopted: true },
        // 沒有被採用的版本不算
        { kind: 'video', modelId: 'fal/seedance-2.0', adopted: false },
      ],
      clips: [
        { modelId: 'openrouter/minimax-speech-2.8-hd' },
        { modelId: 'openrouter/lyria-3-pro' },
      ],
      jobs: [
        { kind: 'llm', status: 'succeeded', modelId: 'openrouter/claude-sonnet-5.5' },
        // 同一家的另一個模型：標註一樣，只列一次
        { kind: 'llm', status: 'succeeded', modelId: 'openrouter/claude-opus-5.5' },
        // 失敗的不算
        { kind: 'llm', status: 'failed', modelId: 'openrouter/gpt-5.5' },
      ],
    })
    expect(collectAttributions(handle, registry)).toEqual([
      'Video generated with Kling AI',
      'Images generated with GPT Image (OpenAI)',
      'Voice by MiniMax',
      'Music generated with Google Lyria',
      'Story and prompts assisted by Claude (Anthropic)',
    ])
  })

  it('示範模型沒有標註；不認得的模型略過；什麼都沒用就是空的', () => {
    const demo = fakeHandle({
      takes: [{ kind: 'video', modelId: 'mock/video', adopted: true }],
      clips: [{ modelId: 'mock/tts' }, { modelId: 'x/ghost' }],
    })
    expect(collectAttributions(demo, registry)).toEqual([])
    expect(collectAttributions(fakeHandle({}), registry)).toEqual([])
  })
})

describe('creditLines 與字卡的 HTML', () => {
  it('最後一行永遠是產品；沒有任何標註時只有這一行', () => {
    expect(creditLines(['Video generated with Kling AI'])).toEqual([
      'Video generated with Kling AI',
      MADE_WITH,
    ])
    expect(creditLines([])).toEqual([MADE_WITH])
  })

  it('字卡 HTML 會跳脫特殊字元，不會讓標註文字變成標籤', () => {
    const html = creditsHtml(['A <b>&</b> "B"', MADE_WITH], 720)
    expect(html).not.toContain('<b>')
    expect(html).toContain('&#60;b&#62;')
    expect(html).toContain(MADE_WITH)
  })
})
