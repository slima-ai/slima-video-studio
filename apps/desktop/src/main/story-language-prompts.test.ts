import { createHash } from 'node:crypto'

import { DEFAULT_STORYBOARD_GUIDE } from '@svs/schema'
import { QUICK_STYLES, breakdownSystemPrompt } from '@svs/workflows'
import { describe, expect, it } from 'vitest'

import { anchorSystemPrompt } from './characters/anchor-suggester'
import { outlineSystemPrompt } from './outline/outline-service'
import { sceneSystemPrompt } from './storyboard/storyboard-service'

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

const ZH = '一隻貓在雨夜找到溫暖的家。'
const EN = 'Mina is the last keeper of a small lighthouse on a rocky island.'
const JA = 'ミナは岩だらけの島の小さな灯台の最後の番人でした。嵐の夜、瓶が流れ着きました。'
const KO = '미나는 바위섬의 작은 등대의 마지막 지기였습니다.'

const breakdown = (story: string): string =>
  breakdownSystemPrompt({
    story,
    narration: false,
    durationSec: 3,
    knownCharacters: [],
    style: 'realistic',
    guide: DEFAULT_STORYBOARD_GUIDE,
  })
const scene = (content: string): string =>
  sceneSystemPrompt(QUICK_STYLES.realistic, DEFAULT_STORYBOARD_GUIDE, [content])

/**
 * 中文內容的提示一字不改：提示會影響快取，改了已存的結果都會被標成需要重新生成。
 * 這四個雜湊是「加語言判斷之前」的提示（逐字照抄當時的程式）算出來的；如果你是刻意改了提示，更新這裡的雜湊，
 * 並在 PR 說明寫清楚為什麼（會讓已存的結果需要重跑）。
 */
const GOLDEN = {
  breakdown: '9ed175212904419024815bd5df4f2aebe740a4196f26b576dbe4846eef3dac50',
  outline: 'b5c55884b29ed424487e6ee70528caf5701dd20c9a45140c4f32c43a9fc13a39',
  scene: 'e982c27aaec77f6a69cd6439b0aab973308cbe1fb138b84b3f796b26e1b10bcc',
  anchor: 'c54e509db26d46fccd60582b430b75defde892fe6d7299e718ad22837718e760',
} as const

describe('中文的故事：給 AI 的提示和以前逐字相同', () => {
  it('拆鏡、拆大綱、拆場、整理固定外觀：中文內容的提示雜湊不變', () => {
    expect(sha(breakdown(ZH))).toBe(GOLDEN.breakdown)
    expect(sha(outlineSystemPrompt(ZH, []))).toBe(GOLDEN.outline)
    expect(sha(scene(ZH))).toBe(GOLDEN.scene)
    expect(sha(anchorSystemPrompt('短黑髮、深藍雨衣'))).toBe(GOLDEN.anchor)
  })

  it('中英混著寫（有漢字、沒有假名）也算中文：提示不變', () => {
    expect(sha(breakdown('小饅頭 meets the red seed'))).toBe(GOLDEN.breakdown)
    expect(sha(outlineSystemPrompt('小饅頭 meets the red seed', []))).toBe(GOLDEN.outline)
  })
})

describe('不是中文的故事（英文、日文、韓文）：提示多一句「用故事的語言寫、名字照原文」', () => {
  const cases: [string, string][] = [
    ['英文', EN],
    ['日文', JA],
    ['韓文', KO],
  ]

  it.each(cases)('%s：只是中文版的提示加上一句，其他一字不差', (_name, story) => {
    const base = {
      breakdown: breakdown(ZH),
      outline: outlineSystemPrompt(ZH, []),
      scene: scene(ZH),
      anchor: anchorSystemPrompt('短黑髮'),
    }
    const now = {
      breakdown: breakdown(story),
      outline: outlineSystemPrompt(story, []),
      scene: scene(story),
      anchor: anchorSystemPrompt(story),
    }
    for (const key of ['breakdown', 'outline', 'scene', 'anchor'] as const) {
      expect(now[key], key).not.toBe(base[key])
      expect(now[key], key).toContain('不是中文')
      expect(now[key], key).toContain('不要翻成中文')
      expect(now[key].length, key).toBeGreaterThan(base[key].length)
    }
    // 拆鏡與拆場：那一句放在「只輸出 JSON」之後、分鏡準則之前，準則與格式要求都還在
    for (const key of ['breakdown', 'scene'] as const) {
      const text = now[key]
      expect(text.indexOf('只輸出 JSON')).toBeLessThan(text.indexOf('不是中文'))
      expect(text.indexOf('不是中文')).toBeLessThan(text.indexOf(DEFAULT_STORYBOARD_GUIDE))
      expect(text).toContain(DEFAULT_STORYBOARD_GUIDE)
    }
    // 拆大綱：已經建好的角色清單還在
    expect(outlineSystemPrompt(story, ['Mina'])).toContain('已經建好的角色有：Mina')
  })

  it('要旁白時，英文故事的 dialogue 也用故事的語言（不是中文）', () => {
    const text = breakdownSystemPrompt({
      story: EN,
      narration: true,
      durationSec: 3,
      knownCharacters: [],
      style: 'realistic',
      guide: '',
    })
    expect(text).toContain('dialogue 也一樣，不用中文')
  })
})
