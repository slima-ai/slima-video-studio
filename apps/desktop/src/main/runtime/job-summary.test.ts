import { DEFAULT_LOCALE, setLocale, t, type Job } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { toJobSummary } from './job-summary'

const base: Job = {
  id: 'j1',
  provider: 'fal',
  modelId: 'fal/nano-banana-2',
  kind: 'image',
  status: 'queued',
  attempt: 0,
  maxAttempts: 3,
  createdAt: '2026-10-12T08:00:00.000Z',
  updatedAt: '2026-10-12T08:00:00.000Z',
}

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe('toJobSummary', () => {
  it('有對到鏡頭就帶「第 N 鏡」，沒有就不帶', () => {
    expect(toJobSummary(base, '第 2 鏡').stepLabel).toBe('第 2 鏡')
    expect('stepLabel' in toJobSummary(base)).toBe(false)
  })

  it('Prompt 開頭當描述，多餘空白與換行壓成一格', () => {
    const s = toJobSummary({ ...base, input: { prompt: '  一隻貓\n  走在\t雨中 ' } })
    expect(s.promptPreview).toBe('一隻貓 走在 雨中')
  })

  it('中文描述後面接的畫風、運鏡英文關鍵字不顯示；整段英文就原樣顯示', () => {
    const zh = toJobSummary({
      ...base,
      input: {
        prompt: '開場：一隻貓在下雨的夜晚。寫實電影質感，photorealistic, cinematic lighting',
      },
    })
    expect(zh.promptPreview).toBe('開場：一隻貓在下雨的夜晚')
    const en = toJobSummary({ ...base, input: { prompt: 'a cat. slow push in' } })
    expect(en.promptPreview).toBe('a cat. slow push in')
  })

  it('太長的描述截斷並加上刪節號', () => {
    const s = toJobSummary({ ...base, input: { prompt: 'a'.repeat(200) } })
    expect(s.promptPreview).toBe(`${'a'.repeat(80)}…`)
  })

  it('文字模型用最後一則訊息；TTS 用 text', () => {
    expect(
      toJobSummary({
        ...base,
        kind: 'llm',
        input: {
          messages: [
            { role: 'user', content: '第一' },
            { role: 'user', content: '第二' },
          ],
        },
      }).promptPreview,
    ).toBe('第二')
    expect(toJobSummary({ ...base, kind: 'tts', input: { text: '你好' } }).promptPreview).toBe(
      '你好',
    )
  })

  it('沒有可用的描述就不放這個欄位', () => {
    for (const input of [undefined, null, 'x', {}, { prompt: '   ' }, { messages: [] }]) {
      expect(toJobSummary({ ...base, input })).not.toHaveProperty('promptPreview')
    }
  })

  it('只帶進度、花費與整理過的錯誤，不帶請求內容與供應商編號', () => {
    const s = toJobSummary({
      ...base,
      status: 'failed',
      providerJobId: 'secret-id',
      input: { prompt: 'p', referenceAssets: ['hash'] },
      output: { big: 'x' },
      costUsd: 0.08,
      nextRunAt: '2026-10-12T08:05:00.000Z',
      error: { code: 'provider_rejected', retryable: false, userMessage: '被拒絕了' },
    })
    expect(s).toEqual({
      id: 'j1',
      provider: 'fal',
      modelId: 'fal/nano-banana-2',
      kind: 'image',
      status: 'failed',
      promptPreview: 'p',
      attempt: 0,
      maxAttempts: 3,
      nextRunAt: '2026-10-12T08:05:00.000Z',
      costUsd: 0.08,
      error: { userMessage: '被拒絕了', retryable: false },
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
    })
  })

  it('失敗原因是錄的當下翻好的字：用繁中錄的，英文介面顯示英文；外部服務回的原文原樣', () => {
    const stored = t('errors.theServiceKeyForIs', { name: 'OpenRouter' })
    const failed: Job = {
      ...base,
      status: 'failed',
      error: { code: 'internal_error', retryable: false, userMessage: stored },
    }
    expect(toJobSummary(failed).error?.userMessage).toBe(stored)
    setLocale('en')
    const english = toJobSummary(failed).error?.userMessage ?? ''
    expect(english).toBe(t('errors.theServiceKeyForIs', { name: 'OpenRouter' }))
    expect(english).not.toMatch(/[㐀-鿿]/)
    const raw: Job = {
      ...failed,
      error: { code: 'internal_error', retryable: true, userMessage: 'HTTP 502 Bad Gateway' },
    }
    expect(toJobSummary(raw).error?.userMessage).toBe('HTTP 502 Bad Gateway')
  })
})
