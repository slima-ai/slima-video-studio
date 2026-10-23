import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ModelSpecSchema, billableChars, type ModelCard } from '@svs/schema'

import {
  BUILTIN_MODEL_FILES,
  expandModelSpecs,
  loadBuiltinModelCards,
  parseModelSpecs,
} from './cards'
import { priceLabel, priceShort } from './options'
import { ModelRegistry } from './registry'

const cards = loadBuiltinModelCards()
const NOW = () => new Date('2026-10-12T00:00:00Z')
const registry = new ModelRegistry(cards, NOW)
const FAL_ONLY = { configuredProviders: new Set(['fal']) }
const BOTH = { configuredProviders: new Set(['fal', 'openrouter']) }

const CHANNEL = {
  provider: 'fal',
  endpoints: { t2i: 'fal-ai/demo', edit: 'fal-ai/demo/edit' },
  pricing: { unit: 'image', usd: 0.01 },
  verification: { endpoint: false, pricing: false },
}
const SPEC = {
  key: 'demo',
  displayName: '測試',
  tasks: ['t2i', 'edit'],
  tier: 'budget',
  channels: [CHANNEL],
}

const withCard = (id: string, patch: Partial<ModelCard>): ModelRegistry =>
  new ModelRegistry(
    cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    NOW,
  )

describe('內建 ModelCard', () => {
  it('models 資料夾裡的每個 JSON 都登錄在清單裡，反之亦然', () => {
    const dir = join(import.meta.dirname, '../../models')
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
    expect([...BUILTIN_MODEL_FILES].sort()).toEqual(onDisk)
  })

  it('全部通過 schema 驗證、id 不重複，且涵蓋 MVP 用到的模型', () => {
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length)
    for (const id of [
      'openrouter/claude-sonnet-5.5',
      'openrouter/claude-opus-5.5',
      'openrouter/gpt-5.5',
      'fal/nano-banana-2',
      'fal/seedream-5.0',
      'fal/kling-3.0-pro',
      'fal/seedance-2.0',
      'fal/veo-3.1-lite',
    ]) {
      expect(registry.get(id), id).toBeDefined()
    }
  })

  it('還沒對照官方文件的價格與 endpoint 一定標為未核對（不能憑記憶當成事實）', () => {
    for (const card of cards.filter((c) => c.provider !== 'mock')) {
      if (card.verification.pricing || card.verification.endpoint) {
        expect(card.verification.checkedAt, card.id).toBeDefined()
      }
    }
  })

  it('parseModelSpecs 對格式錯誤與重複 key 直接丟錯；攤平後管道 id 重複也丟錯', () => {
    expect(() => parseModelSpecs([{ key: 'x' }])).toThrow(/模型 x 格式錯誤/)
    expect(() => parseModelSpecs([42])).toThrow(/#0 格式錯誤/)
    const [spec] = parseModelSpecs([SPEC])
    if (!spec) throw new Error('沒有解析出來')
    expect(() => parseModelSpecs([SPEC, SPEC])).toThrow(/key 重複/)
    expect(() =>
      expandModelSpecs([
        spec,
        { ...spec, key: 'other', channels: spec.channels.map((c) => ({ ...c, id: 'fal/demo' })) },
      ]),
    ).toThrow(/id 重複：fal\/demo/)
  })

  it('GPT Image 2：同一個 OpenRouter 模型開兩張卡（標準＝medium、高畫質＝high），都走 /images，價格各自寫', () => {
    const standard = registry.get('openrouter/gpt-image-2')
    const high = registry.get('openrouter/gpt-image-2-high')
    expect(standard?.imageApi).toEqual({ quality: 'medium' })
    expect(high?.imageApi).toEqual({ quality: 'high' })
    expect(standard?.endpoints).toEqual({ t2i: 'openai/gpt-image-2', edit: 'openai/gpt-image-2' })
    expect(high?.endpoints).toEqual(standard?.endpoints)
    expect(standard?.pricing).toEqual({ unit: 'image', usd: 0.042 })
    expect(high?.pricing).toEqual({ unit: 'image', usd: 0.145 })
    // 價格只量到少數幾次、依 token 計費會浮動，所以標「估算」
    expect(standard?.verification.pricing).toBe(false)
    expect(registry.estimate('openrouter/gpt-image-2-high', { images: 4 })).toBeCloseTo(0.58)
    // 其他圖片模型（Gemini 走 chat/completions）沒有 imageApi
    expect(registry.get('openrouter/gemini-3-pro-image')?.imageApi).toBeUndefined()
  })

  it('旁白模型卡：MiniMax（中文預設，漢字算兩個計費單位）與 ElevenLabs Eleven v3，聲音只列實測過的', () => {
    const minimax = registry.get('openrouter/minimax-speech-2.8-hd')
    if (minimax === undefined) throw new Error('找不到 MiniMax 旁白卡')
    const eleven = registry.get('openrouter/eleven-v3')
    expect(minimax.capabilities).toEqual(['tts'])
    expect(minimax.endpoints.tts).toBe('minimax/speech-2.8-hd')
    expect(minimax.voices.map((v) => v.id)).toEqual(['male-qn-qingse'])
    expect(eleven?.endpoints.tts).toBe('elevenlabs/eleven-v3')
    expect(eleven?.voices.map((v) => v.id)).toEqual(['Adam'])
    expect(eleven?.verification.pricing).toBe(false)
    const only = { configuredProviders: new Set(['openrouter']) }
    expect(registry.defaultFor({ ...only, capability: 'tts' })?.id).toBe(
      'openrouter/minimax-speech-2.8-hd',
    )
    // 實測：26 字（23 個漢字、3 個標點）收 US$0.0049；估算多算標點，會略高一點（不低估）
    const text = '黑藤爬滿了斷橋，小饅頭抱緊那顆紅色的種子，縱身一躍。'
    const chars = billableChars(minimax, text)
    expect(chars).toBe(52)
    const estimate = registry.estimate('openrouter/minimax-speech-2.8-hd', { chars })
    expect(estimate).toBeGreaterThanOrEqual(0.0049)
    expect(estimate).toBeLessThan(0.0049 * 1.1)
    // 沒有權重的卡，每個字算 1
    expect(billableChars({}, '你好 abc')).toBe(6)
  })

  it('voices 只能用在有 tts 的模型，且 id 不能重複', () => {
    const voice = { id: 'a', label: 'A' }
    const llm = {
      ...SPEC,
      tasks: ['llm'],
      channels: [
        { ...CHANNEL, provider: 'openrouter', endpoints: { llm: 'x/y' }, voices: [voice] },
      ],
    }
    expect(() => expandModelSpecs(parseModelSpecs([llm]))).toThrow(/voices 只能用在/)
    const dup = {
      ...SPEC,
      tasks: ['tts'],
      channels: [{ ...CHANNEL, endpoints: { tts: 'x/y' }, voices: [voice, voice] }],
    }
    expect(() => expandModelSpecs(parseModelSpecs([dup]))).toThrow(/voice id 不能重複/)
  })

  it('配樂模型卡：Lyria 3 Pro（預設，每首 0.08）與 Clip（約 30 秒，每首 0.04），依首計價', () => {
    const pro = registry.get('openrouter/lyria-3-pro')
    const clip = registry.get('openrouter/lyria-3-clip')
    expect(pro?.endpoints.music).toBe('google/lyria-3-pro-preview')
    expect(clip?.endpoints.music).toBe('google/lyria-3-clip-preview')
    expect(pro?.pricing).toEqual({ unit: 'track', usd: 0.08 })
    expect(clip?.pricing).toEqual({ unit: 'track', usd: 0.04 })
    const only = { configuredProviders: new Set(['openrouter']) }
    expect(registry.defaultFor({ ...only, capability: 'music' })?.id).toBe('openrouter/lyria-3-pro')
    expect(registry.estimate('openrouter/lyria-3-pro', { tracks: 3 })).toBeCloseTo(0.24)
    expect(() => registry.estimate('openrouter/lyria-3-pro', {})).toThrow(/首數/)
    expect(priceLabel({ unit: 'track', usd: 0.08 })).toBe('約 US$0.08／首')
    expect(priceShort({ unit: 'track', usd: 0.04 })).toBe('每首約 US$0.04')
  })

  it('每張卡都有給使用者看的一句白話說明：一行以內，不寫日期、實測、查無、估算這類工程用語', () => {
    for (const card of cards) {
      const note = card.userNote
      expect(note, `${card.id} 缺 userNote`).toBeTruthy()
      expect(note?.length ?? 0, `${card.id} 的 userNote 太長`).toBeLessThanOrEqual(40)
      expect(note, `${card.id} 的 userNote 有工程用語`).not.toMatch(
        /\d{4}-\d{2}|實測|查無|估算|未確認/,
      )
    }
  })

  it('匯出片尾的標註：每張真實模型卡都有一行英文標註，示範模型沒有；Kling 的字句固定', () => {
    for (const card of cards) {
      if (card.provider === 'mock') {
        expect(card.attribution, `${card.id} 是示範模型，不該有標註`).toBeUndefined()
        continue
      }
      expect(card.attribution, `${card.id} 缺 attribution`).toBeTruthy()
      expect(card.attribution?.length ?? 0).toBeLessThanOrEqual(60)
      expect(card.attribution, `${card.id} 的標註要是英文一行`).toMatch(/^[\x20-\x7e]+$/)
    }
    // 條款要求標示「Kling AI」（助理研究 §10）
    expect(registry.get('fal/kling-3.0-pro')?.attribution).toBe('Video generated with Kling AI')
    expect(registry.get('openrouter/kling-3.0-standard')?.attribution).toBe(
      'Video generated with Kling AI',
    )
  })

  it('Kling 3.0 Standard 兩個管道都有負面提示；OpenRouter 管道寫明實際供應商（atlas-cloud），fal 不需要', () => {
    const fal = registry.get('fal/kling-3.0-standard')
    const viaOpenRouter = registry.get('openrouter/kling-3.0-standard')
    for (const card of [fal, viaOpenRouter]) {
      // 模型卡上的內建清單只放通用的畫質字；fal 預設的 "blur, distort, and low quality" 不能因為換成我們的清單而不見
      expect(card?.negativePrompt?.default).toMatch(/blur.*distort.*low quality/)
      expect(card?.negativePrompt?.default).toContain('extra limbs')
      // 任何角色的特徵（嘴、手腳、耳朵…）都不能放在模型卡上：所有影片都會帶，換成別的角色就變成「不要嘴、不要手」
      for (const trait of [
        'mouth',
        'arms',
        'legs',
        'hands',
        'feet',
        'ears',
        'eyebrows',
        'eyelids',
      ]) {
        expect(card?.negativePrompt?.default, `模型卡上不能有角色特徵 ${trait}`).not.toContain(
          trait,
        )
      }
    }
    expect(viaOpenRouter?.negativePrompt?.routeProvider).toBe('atlas-cloud')
    expect(fal?.negativePrompt?.routeProvider).toBeUndefined()
    // 沒核對過文件的模型不填
    expect(registry.get('openrouter/kling-3.0-pro')?.negativePrompt).toBeUndefined()
    expect(registry.get('fal/kling-3.0-pro')?.negativePrompt).toBeUndefined()
  })

  it('新增 GPT Image 2 不改變既有的預設圖片模型，使用者要自己切換', () => {
    const only = { configuredProviders: new Set(['openrouter']) }
    for (const capability of ['t2i', 'edit'] as const) {
      expect(registry.defaultFor({ ...only, capability })?.id).toBe('openrouter/gemini-3-pro-image')
    }
    const ids = registry.available({ ...only, capability: 't2i' }).map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining(['openrouter/gpt-image-2', 'openrouter/gpt-image-2-high']),
    )
  })

  it('imageApi 只能用在 OpenRouter 的圖片管道', () => {
    const imageApi = { quality: 'medium' }
    const onFal = ModelSpecSchema.safeParse({
      ...SPEC,
      channels: [{ ...CHANNEL, imageApi }],
    })
    // 管道層級只是資料；展開成執行用的卡時才檢查供應商
    expect(onFal.success).toBe(true)
    expect(() =>
      expandModelSpecs(parseModelSpecs([{ ...SPEC, channels: [{ ...CHANNEL, imageApi }] }])),
    ).toThrow(/imageApi 只有 OpenRouter/)
    const llmOnly = {
      ...SPEC,
      tasks: ['llm'],
      channels: [
        {
          ...CHANNEL,
          provider: 'openrouter',
          endpoints: { llm: 'x/y' },
          imageApi,
        },
      ],
    }
    expect(() => expandModelSpecs(parseModelSpecs([llmOnly]))).toThrow(/imageApi 只能用在/)
  })

  it('同一個模型的管道共用名稱與分組；管道各自的端點、價格、角色一致性的機制', () => {
    const fal = registry.get('fal/kling-3.0-pro')
    const viaOpenRouter = registry.get('openrouter/kling-3.0-pro')
    expect(fal?.displayName).toBe('Kling 3.0 Pro')
    expect(viaOpenRouter?.displayName).toBe('Kling 3.0 Pro')
    expect(viaOpenRouter?.model).toBe('kling-3.0-pro')
    expect(fal?.characterMechanism).toBe('elements')
    // OpenRouter 的 Kling 沒有 Elements，參考圖路徑實測不建議（2026-10-23）：不宣稱角色一致性的機制
    expect(viaOpenRouter?.characterMechanism).toBe('none')
    // 能力看管道的端點：fal 上的 Kling 3.0 Pro 沒有參考生影片
    expect(fal?.capabilities).toEqual(['t2v', 'i2v'])
    expect(viaOpenRouter?.capabilities).toEqual(['t2v', 'i2v'])
    expect(fal?.badges).toEqual(['有聲'])
    // 示範模型沿用舊的 id，舊專案的版本紀錄照樣讀得到
    expect(registry.get('mock/video')?.model).toBe('mock-video')
  })

  it('Kling 3.0 的選單標籤沒有「角色一致」（Standard、Pro）：標籤只寫 App 真的用到或實測過的能力；那是廠商宣稱，App 沒用 Elements，實測參考圖反而走樣', () => {
    for (const id of [
      'fal/kling-3.0-standard',
      'openrouter/kling-3.0-standard',
      'fal/kling-3.0-pro',
      'openrouter/kling-3.0-pro',
    ]) {
      expect(registry.get(id)?.badges, id).toEqual(['有聲'])
    }
  })

  it('Kling 3.0 在 OpenRouter 的參考生影片（r2v）實測不建議：沒有 r2v 端點、沒有參考圖上限，並留著實測紀錄與日期', () => {
    for (const id of ['openrouter/kling-3.0-standard', 'openrouter/kling-3.0-pro']) {
      const card = registry.get(id)
      expect(card?.capabilities, id).not.toContain('r2v')
      expect(card?.endpoints.r2v, id).toBeUndefined()
      expect(card?.referenceLimits, id).toBeUndefined()
      const tested = card?.verification.tested ?? []
      expect(tested, id).toHaveLength(1)
      expect(tested[0]).toMatchObject({
        feature: 'input_references',
        result: 'not_recommended',
        checkedAt: '2026-10-23',
      })
    }
    // 其他影片模型的 r2v 不受影響（Seedance 在 fal 上有）
    expect(registry.get('fal/seedance-2.0')?.capabilities).toContain('r2v')
  })

  it('模型檔的檢查：管道的端點要在 tasks 裡、每個 task 都要有管道做得到、同一家只能一個管道', () => {
    const errors = (spec: unknown): string[] => {
      const result = ModelSpecSchema.safeParse(spec)
      return result.success ? [] : result.error.issues.map((i) => i.message)
    }
    expect(errors(SPEC)).toEqual([])
    expect(errors({ ...SPEC, tasks: ['t2i'] })).toEqual(['管道的 edit 不在模型的 tasks 裡'])
    expect(errors({ ...SPEC, tasks: ['t2i', 'edit', 'i2v'] })).toEqual(['沒有任何管道做得到 i2v'])
    expect(errors({ ...SPEC, channels: [CHANNEL, CHANNEL] })).toEqual([
      '同一個供應商（fal）只能有一個管道',
    ])
  })
})

describe('ModelRegistry：多管道', () => {
  it('同一個模型兩家都有時走較便宜的；一樣價錢就用選的那家，選單上照模型檔的順序（fal 在前）', () => {
    const seedance = registry.get('fal/seedance-2.0')
    if (!seedance) throw new Error('沒有 Seedance')
    expect(registry.channelsOf(seedance).map((c) => c.id)).toEqual([
      'fal/seedance-2.0',
      'openrouter/seedance-2.0',
    ])
    expect(registry.bestChannel(seedance, BOTH)?.id).toBe('openrouter/seedance-2.0')
    expect(registry.bestChannel(seedance, FAL_ONLY)?.id).toBe('fal/seedance-2.0')
    const kling = registry.get('openrouter/kling-3.0-pro')
    if (!kling) throw new Error('沒有 Kling')
    expect(registry.bestChannel(kling, BOTH)?.id).toBe('openrouter/kling-3.0-pro')
    expect(registry.bestChannel(kling, FAL_ONLY)?.id).toBe('fal/kling-3.0-pro')
    expect(registry.availableModels({ ...BOTH, capability: 'i2v' }).map((c) => c.id)).toContain(
      'fal/kling-3.0-pro',
    )
    // 選單上每個模型只出現一次
    const ids = registry.availableModels({ ...BOTH, capability: 'i2v' }).map((c) => c.id)
    expect(ids.filter((id) => id.endsWith('/seedance-2.0'))).toEqual(['openrouter/seedance-2.0'])
  })

  it('fal 上的 Veo 3.1 Lite 2026-10-22 下架：兩把 Key 都有就改走 OpenRouter；只有 fal 就沒得走，換同組的下一個', () => {
    const later = new ModelRegistry(cards, () => new Date('2026-10-22T00:00:00Z'))
    const veo = later.get('fal/veo-3.1-lite')
    if (!veo) throw new Error('沒有 Veo')
    expect(later.isSunset(veo)).toBe(true)
    expect(later.bestChannel(veo, BOTH)?.id).toBe('openrouter/veo-3.1-lite')
    expect(later.bestChannel(veo, FAL_ONLY)).toBeUndefined()
    // 經濟實惠組裡 fal 沒有別的影片模型 → 照預設的順序（平衡組推薦的）
    expect(later.replacementFor(veo, { ...FAL_ONLY, capability: 'i2v' })?.id).toBe(
      'fal/kling-3.0-standard',
    )
  })

  it('換成同一組（高品質）裡的下一個', () => {
    const gone = new ModelRegistry(
      cards.map((c) => (c.model === 'kling-3.0-pro' ? { ...c, status: 'sunset' as const } : c)),
      NOW,
    )
    const pro = gone.get('fal/kling-3.0-pro')
    if (!pro) throw new Error('沒有 Kling')
    expect(gone.replacementFor(pro, { ...FAL_ONLY, capability: 'i2v' })?.id).toBe(
      'fal/seedance-2.0',
    )
  })
})

describe('ModelRegistry', () => {
  it('只列出已填 Key 的供應商的模型；示範模式才會出現假模型', () => {
    expect(registry.available({ configuredProviders: new Set() })).toEqual([])
    const falOnly = registry.available(FAL_ONLY)
    expect(falOnly.length).toBeGreaterThan(0)
    expect(falOnly.every((c) => c.provider === 'fal')).toBe(true)

    const demo = registry.available({ configuredProviders: new Set(), demoMode: true })
    expect(demo.length).toBeGreaterThan(0)
    expect(demo.every((c) => c.provider === 'mock')).toBe(true)
    expect(
      registry.available({ ...FAL_ONLY, demoMode: false }).some((c) => c.provider === 'mock'),
    ).toBe(false)
  })

  it('依能力過濾', () => {
    const video = registry.available({ ...BOTH, capability: 'i2v' })
    expect(video.every((c) => c.capabilities.includes('i2v'))).toBe(true)
    expect(video.map((c) => c.id)).toContain('fal/kling-3.0-standard')
    expect(
      registry
        .available({ ...BOTH, capability: 'llm' })
        .map((c) => c.id)
        .sort(),
    ).toEqual(['openrouter/claude-opus-5.5', 'openrouter/claude-sonnet-5.5', 'openrouter/gpt-5.5'])
  })

  it('已下架或過了下架日的模型不會出現在選單', () => {
    const sunset = withCard('fal/seedream-5.0', { status: 'sunset' })
    expect(sunset.available(FAL_ONLY).map((c) => c.id)).not.toContain('fal/seedream-5.0')

    const dated = withCard('fal/seedream-5.0', { sunsetDate: '2026-10-12' })
    expect(dated.available(FAL_ONLY).map((c) => c.id)).not.toContain('fal/seedream-5.0')
    const future = withCard('fal/seedream-5.0', { sunsetDate: '2026-10-13' })
    expect(future.available(FAL_ONLY).map((c) => c.id)).toContain('fal/seedream-5.0')
    // deprecated 仍可選，只是不再推薦
    const old = withCard('fal/seedream-5.0', { status: 'deprecated' })
    expect(old.available(FAL_ONLY).map((c) => c.id)).toContain('fal/seedream-5.0')
  })

  it('依 tier 分成高品質／平衡／經濟實惠，推薦的排最前面；每個模型只列一次（走較便宜的管道）', () => {
    const groups = registry.grouped({ ...BOTH, capability: 'i2v' })
    expect(groups.premium.map((c) => c.id)).toEqual([
      'fal/kling-3.0-pro',
      'openrouter/seedance-2.0',
    ])
    expect(groups.balanced.map((c) => c.id)).toEqual(['fal/kling-3.0-standard'])
    expect(groups.budget.map((c) => c.id)).toEqual(['fal/veo-3.1-lite'])
  })

  it('預設選「平衡」裡推薦的；沒有就往其他組找；完全沒有就是 undefined', () => {
    expect(registry.defaultFor({ ...BOTH, capability: 'i2v' })?.id).toBe('fal/kling-3.0-standard')
    expect(registry.defaultFor({ ...BOTH, capability: 't2i' })?.id).toBe('fal/nano-banana-2')
    expect(registry.defaultFor({ ...BOTH, capability: 'llm' })?.id).toBe(
      'openrouter/claude-sonnet-5.5',
    )
    expect(
      registry.defaultFor({ configuredProviders: new Set(), capability: 'i2v' }),
    ).toBeUndefined()
    const noBalanced = withCard('fal/nano-banana-2', { status: 'sunset' })
    expect(noBalanced.defaultFor({ ...FAL_ONLY, capability: 't2i' })?.id).toBe('fal/seedream-5.0')
  })

  it('只填 OpenRouter 一把金鑰，快速開始需要的每種能力都有預設模型', () => {
    const only = { configuredProviders: new Set(['openrouter']) }
    const defaults = Object.fromEntries(
      (['llm', 't2i', 'edit', 'i2v', 't2v'] as const).map((capability) => [
        capability,
        registry.defaultFor({ ...only, capability })?.id,
      ]),
    )
    expect(defaults).toEqual({
      llm: 'openrouter/claude-sonnet-5.5',
      t2i: 'openrouter/gemini-3-pro-image',
      edit: 'openrouter/gemini-3-pro-image',
      i2v: 'openrouter/kling-3.0-standard',
      t2v: 'openrouter/kling-3.0-standard',
    })
    // 旁白也有了（MiniMax 當預設，中文優先）
    expect(registry.defaultFor({ ...only, capability: 'tts' })?.id).toBe(
      'openrouter/minimax-speech-2.8-hd',
    )
  })

  it('估算：OpenRouter 的 Veo 3.1 Lite 6 秒＝6 × 0.05（無聲是 2026-10-18 實測，有聲取規格表）；Kling Standard 無聲 5 秒＝5 × 0.084', () => {
    expect(registry.estimate('openrouter/veo-3.1-lite', { seconds: 6, audio: true })).toBeCloseTo(
      0.3,
    )
    expect(registry.estimate('openrouter/veo-3.1-lite', { seconds: 6 })).toBeCloseTo(0.3)
    expect(registry.estimate('openrouter/kling-3.0-standard', { seconds: 5 })).toBeCloseTo(0.42)
    // 最低計費 5 秒（2026-10-19 實測：3 秒有聲收 0.63、3 秒無聲收 0.42）：短於 5 秒的預估也按 5 秒算
    expect(registry.estimate('openrouter/kling-3.0-standard', { seconds: 3 })).toBeCloseTo(0.42)
    expect(
      registry.estimate('openrouter/kling-3.0-standard', { seconds: 3, audio: true }),
    ).toBeCloseTo(0.63)
    // 超過 5 秒照實際秒數
    expect(registry.estimate('openrouter/kling-3.0-standard', { seconds: 8 })).toBeCloseTo(0.672)
    // 沒有量過最低計費的管道（fal）照實際秒數，不亂套
    expect(registry.estimate('fal/kling-3.0-standard', { seconds: 3 })).toBeCloseTo(0.252)
  })

  it('OpenRouter 的 Veo 3.1 Lite 只收 4、6、8 秒（實測）；fal 通道沒實測，不宣稱離散秒數', () => {
    expect(registry.get('openrouter/veo-3.1-lite')?.durationSec).toEqual({
      min: 4,
      max: 8,
      steps: [4, 6, 8],
    })
    expect(registry.get('fal/veo-3.1-lite')?.durationSec?.steps).toBeUndefined()
  })

  it('estimate 依 ModelCard 價格估算；不認得的模型丟錯', () => {
    // Kling 3.0 Pro 5 秒有聲：5 × 0.168
    expect(registry.estimate('fal/kling-3.0-pro', { seconds: 5, audio: true })).toBeCloseTo(0.84)
    expect(registry.estimate('fal/nano-banana-2', { images: 4 })).toBeCloseTo(0.32)
    expect(() => registry.estimate('fal/ghost', { seconds: 1 })).toThrow(/找不到模型/)
  })
})
