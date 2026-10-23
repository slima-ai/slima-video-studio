import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, setLocale } from '../i18n'
import {
  chatStepLabel,
  chatToolDoingLabel,
  chatToolLabel,
  hasChatToolLabel,
} from './chat-tool-labels'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe('對話步驟的標籤：看工具名與狀態，顯示的當下才翻', () => {
  it('繁中：做完是「建立鏡頭」、進行中是「正在建立鏡頭…」；沒有對照的工具退回「做了一個步驟」', () => {
    expect(chatToolLabel('create_shot')).toBe('建立鏡頭')
    expect(chatToolDoingLabel('create_shot')).toBe('正在建立鏡頭…')
    expect(chatToolLabel('brand_new_tool')).toBe('做了一個步驟')
    expect(hasChatToolLabel('create_shot')).toBe(true)
    expect(hasChatToolLabel('brand_new_tool')).toBe(false)
  })

  it('同一個步驟，換介面語言就換字（不看存下來的 label）', () => {
    const running = { tool: 'generate_videos', status: 'running' as const }
    const done = { tool: 'generate_videos', status: 'done' as const }
    const failed = { tool: 'generate_videos', status: 'error' as const }
    expect([running, done, failed].map(chatStepLabel)).toEqual([
      '正在生成影片…',
      '生成影片',
      '生成影片',
    ])
    setLocale('en')
    expect([running, done, failed].map(chatStepLabel)).toEqual([
      'Generate videos…',
      'Generate videos',
      'Generate videos',
    ])
    expect(chatStepLabel({ tool: 'brand_new_tool', status: 'done' })).toBe('Did a step')
  })
})
