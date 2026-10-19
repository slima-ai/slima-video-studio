import { ModelRegistry, loadBuiltinModelCards } from '@svs/providers'
import { describe, expect, it, vi } from 'vitest'

import { MemoryVault } from '../keys/key-vault'
import { createSettingsService } from './model-service'
import { createMemorySettingsStore } from './settings-store'

const KEY = 'abcdefgh12345678'

/** 固定日期：fal 上的 Veo 3.1 Lite 2026-10-22 下架，測試不能跟著真實日期變。 */
const BEFORE_SUNSET = '2026-10-13T00:00:00Z'
const AFTER_SUNSET = '2026-10-22T00:00:00Z'

function setup(
  options: { keys?: string[]; demoMode?: boolean; now?: string; project?: boolean } = {},
) {
  const keys = new MemoryVault()
  for (const provider of options.keys ?? []) keys.set(provider, KEY)
  const store = createMemorySettingsStore({ demoMode: options.demoMode ?? false })
  let clock = options.now ?? BEFORE_SUNSET
  const onNotice = vi.fn()
  // 假的「開著的專案」：project 為 false 時表示沒開專案
  const project = { open: options.project ?? false, models: {} as Record<string, string> }
  const service = createSettingsService({
    store,
    registry: new ModelRegistry(loadBuiltinModelCards(), () => new Date(clock)),
    keys,
    onNotice,
    project: {
      current: () => (project.open ? { name: '海邊的貓', models: project.models } : undefined),
      set: (models) => {
        project.models = { ...models }
      },
    },
  })
  const setNow = (iso: string): void => {
    clock = iso
  }
  return { keys, store, service, onNotice, setNow, project }
}

describe('SettingsService.listModels', () => {
  it('沒有任何 Key 也不是示範模式 → 沒有模型可選；每個真實模型都列在「還不能用」，寫要填哪家的金鑰', () => {
    const { models, selected, locked } = setup().service.listModels()
    expect(models).toEqual([])
    expect(selected).toEqual({})
    const byName = new Map(locked.map((m) => [m.displayName, m.needsKey]))
    expect(byName.get('Kling 3.0 Standard')).toBe('fal.ai 或 OpenRouter')
    expect(byName.get('Nano Banana 2')).toBe('fal.ai')
    expect(byName.get('Claude Sonnet 5.5')).toBe('OpenRouter')
    // 示範模型不算
    expect(locked.some((m) => m.provider === 'mock')).toBe(false)
    // 每個模型只列一次
    expect(new Set(locked.map((m) => m.displayName)).size).toBe(locked.length)
  })

  it('填了 OpenRouter：OpenRouter 有的都能用了，只剩 fal.ai 才有的模型還不能用；示範模式不列', () => {
    const { locked } = setup({ keys: ['openrouter'] }).service.listModels()
    expect(locked.map((m) => m.displayName).sort()).toEqual(['Nano Banana 2', 'Seedream 5.0 Lite'])
    expect(locked.every((m) => m.needsKey === 'fal.ai')).toBe(true)
    expect(setup({ demoMode: true }).service.listModels().locked).toEqual([])
  })

  it('示範模式只列示範模型，並自動選它們', () => {
    const { models, selected } = setup({ demoMode: true, keys: ['fal'] }).service.listModels()
    expect(new Set(models.map((m) => m.provider))).toEqual(new Set(['mock']))
    // 示範模式沒有示範配樂，只有旁白
    expect(selected).toEqual({
      llm: 'mock/llm',
      t2i: 'mock/image',
      i2v: 'mock/video',
      tts: 'mock/tts',
    })
  })

  it('只填 fal 的 Key → 看得到圖片與影片模型，沒有文字模型', () => {
    const { models, selected } = setup({ keys: ['fal'] }).service.listModels()
    expect(models.every((m) => m.provider === 'fal')).toBe(true)
    expect(selected.llm).toBeUndefined()
    expect(selected.t2i).toBe('fal/nano-banana-2')
    expect(selected.i2v).toBe('fal/kling-3.0-standard')
  })

  it('兩個 Key 都填 → 預設是「平衡」裡推薦的', () => {
    const { selected } = setup({ keys: ['fal', 'openrouter'] }).service.listModels()
    expect(selected).toEqual({
      llm: 'openrouter/claude-sonnet-5.5',
      t2i: 'fal/nano-banana-2',
      i2v: 'fal/kling-3.0-standard',
      tts: 'openrouter/minimax-speech-2.8-hd',
      music: 'openrouter/lyria-3-pro',
    })
  })

  it('使用者選的模型優先；選的模型不能用了（Key 被刪）就退回推薦的', () => {
    const { service, keys } = setup({ keys: ['fal'] })
    service.update({ models: { i2v: 'fal/veo-3.1-lite' } })
    expect(service.resolveModel('i2v')).toBe('fal/veo-3.1-lite')
    keys.delete('fal')
    expect(service.resolveModel('i2v')).toBeUndefined()
    keys.set('fal', KEY)
    expect(service.resolveModel('i2v')).toBe('fal/veo-3.1-lite')
  })

  it('切到示範模式時，之前選的真實模型不會被用到', () => {
    const { service, store } = setup({ keys: ['fal'] })
    service.update({ models: { t2i: 'fal/seedream-5.0' } })
    store.update({ demoMode: true })
    expect(service.resolveModel('t2i')).toBe('mock/image')
  })

  it('每個選項都附白話價格，沒核對過的標為估算', () => {
    const { models } = setup({ keys: ['fal'] }).service.listModels()
    const nano = models.find((m) => m.id === 'fal/nano-banana-2')
    expect(nano).toMatchObject({ priceLabel: '約 US$0.08／張', priceVerified: true })
    expect(nano).not.toHaveProperty('endpoints')
    expect(models.find((m) => m.id === 'fal/seedream-5.0')?.priceVerified).toBe(false)
  })
})

describe('SettingsService：多管道與下架', () => {
  it('同一個模型兩家都能走時走較便宜的；選單上每個模型只出現一次，並寫出也能走哪家', () => {
    const { service } = setup({ keys: ['fal', 'openrouter'] })
    // 選的是 fal 上的 Seedance 2.0：OpenRouter 上約一半價，實際走 OpenRouter
    service.update({ models: { i2v: 'fal/seedance-2.0' } })
    expect(service.resolveModel('i2v')).toBe('openrouter/seedance-2.0')
    const { models, selected } = service.listModels()
    expect(selected.i2v).toBe('openrouter/seedance-2.0')
    const seedance = models.filter((m) => m.displayName === 'Seedance 2.0')
    expect(seedance.map((m) => m.id)).toEqual(['openrouter/seedance-2.0'])
    expect(seedance[0]?.otherChannels).toEqual(['fal.ai'])
    expect(models.find((m) => m.id === 'fal/kling-3.0-pro')?.badges).toEqual(['有聲', '角色一致'])
  })

  it('只有一家的 Key：選另一家的同一個模型也能用（走有 Key 的那家）', () => {
    const { service } = setup({ keys: ['openrouter'] })
    service.update({ models: { i2v: 'fal/kling-3.0-pro' } })
    expect(service.resolveModel('i2v')).toBe('openrouter/kling-3.0-pro')
  })

  it('選的模型在 fal 下架、但 OpenRouter 也有：改走 OpenRouter，不用通知', () => {
    const { service, onNotice, setNow, store } = setup({ keys: ['fal', 'openrouter'] })
    service.update({ models: { i2v: 'fal/veo-3.1-lite' } })
    expect(service.resolveModel('i2v')).toBe('fal/veo-3.1-lite')
    setNow(AFTER_SUNSET)
    expect(service.resolveModel('i2v')).toBe('openrouter/veo-3.1-lite')
    expect(onNotice).not.toHaveBeenCalled()
    expect(store.get().modelNotices).toEqual([])
  })

  it('下架又沒有別家可走：換成同一組的下一個、記住，通知只說一次（關掉 App 再開也不會再說）', () => {
    const { service, onNotice, setNow, store } = setup({ keys: ['fal'] })
    service.update({ models: { i2v: 'fal/veo-3.1-lite' } })
    setNow(AFTER_SUNSET)
    expect(service.resolveModel('i2v')).toBe('fal/kling-3.0-standard')
    expect(store.get().models.i2v).toBe('fal/kling-3.0-standard')
    expect(onNotice).toHaveBeenCalledTimes(1)
    // 之後再查不會再換、也不會再多一則通知
    expect(service.resolveModel('i2v')).toBe('fal/kling-3.0-standard')
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(service.takeNotices()).toEqual([
      '「Veo 3.1 Lite」已經下架，影片改用「Kling 3.0 Standard」。可以到設定換別的。',
    ])
    expect(service.takeNotices()).toEqual([])
  })

  it('升級前存的設定（舊的 ModelCard id）照樣讀得到', () => {
    const { service } = setup({ keys: ['fal', 'openrouter'] })
    for (const id of ['openrouter/kling-3.0-standard', 'fal/nano-banana-2']) {
      expect(() =>
        service.update({ models: { [id.includes('nano') ? 't2i' : 'i2v']: id } }),
      ).not.toThrow()
    }
    expect(service.resolveModel('t2i')).toBe('fal/nano-banana-2')
    // 一樣價錢就照使用者選的那家
    expect(service.resolveModel('i2v')).toBe('openrouter/kling-3.0-standard')
  })
})

describe('SettingsService.update', () => {
  it('選不存在的模型、或模型做不到那個用途 → 拒絕，設定不變', () => {
    const { service, store } = setup({ keys: ['fal'] })
    expect(() => service.update({ models: { t2i: 'no/such' } })).toThrow(/沒辦法用在這個用途/)
    expect(() => service.update({ models: { llm: 'fal/nano-banana-2' } })).toThrow()
    expect(store.get().models).toEqual({})
  })

  it('null（改回推薦）不需要驗證', () => {
    const { service } = setup()
    expect(service.update({ models: { llm: null } }).models).toEqual({})
  })

  it('單次花費上限必須大於 0', () => {
    const { service } = setup()
    expect(() => service.update({ budget: { perRunLimitUsd: 0 } })).toThrow(/大於 0/)
    expect(service.update({ budget: { perRunLimitUsd: 8 } }).budget.perRunLimitUsd).toBe(8)
  })
})

describe('SettingsService：這個專案預設用什麼', () => {
  it('沒開專案 → listModels 的 project 是 null；設定專案模型會被拒絕', () => {
    const { service } = setup({ keys: ['fal'] })
    expect(service.listModels().project).toBeNull()
    expect(() => {
      service.setProjectModels({ t2i: 'fal/seedream-5.0' })
    }).toThrow('請先開啟或建立一個專案')
  })

  it('專案指定的模型蓋過 App 設定；App 設定的選單照樣顯示自己的；改回 null 就跟著 App', () => {
    const { service, project } = setup({ keys: ['fal'], project: true })
    expect(service.listModels().project).toEqual({ name: '海邊的貓', models: {} })
    service.setProjectModels({ t2i: 'fal/seedream-5.0' })
    expect(project.models).toEqual({ t2i: 'fal/seedream-5.0' })
    expect(service.resolveModel('t2i')).toBe('fal/seedream-5.0')
    // 沒指定的用途照 App 設定
    expect(service.resolveModel('i2v')).toBe('fal/kling-3.0-standard')
    const listing = service.listModels()
    expect(listing.selected.t2i).toBe('fal/nano-banana-2')
    expect(listing.project?.models).toEqual({ t2i: 'fal/seedream-5.0' })
    service.setProjectModels({ t2i: null })
    expect(project.models).toEqual({})
    expect(service.resolveModel('t2i')).toBe('fal/nano-banana-2')
  })

  it('指定「高品質／平衡／經濟」時照那一組，不看專案設定', () => {
    const { service } = setup({ keys: ['fal'], project: true })
    service.setProjectModels({ i2v: 'fal/kling-3.0-standard' })
    expect(service.resolveModel('i2v', 'premium')).not.toBe('fal/kling-3.0-standard')
  })

  it('專案指定的模型現在不能用（Key 被刪）就跟著 App 設定，listModels 也不列它', () => {
    const { service, keys } = setup({ keys: ['fal', 'openrouter'], project: true })
    service.setProjectModels({ t2i: 'fal/seedream-5.0', llm: 'openrouter/claude-sonnet-5.5' })
    keys.delete('fal')
    expect(service.resolveModel('t2i')).not.toBe('fal/seedream-5.0')
    expect(service.listModels().project?.models).toEqual({ llm: 'openrouter/claude-sonnet-5.5' })
  })

  it('專案的模型下架又沒別家可走：改寫專案設定（App 設定不動），通知說是這個專案', () => {
    const { service, store, setNow, project, onNotice } = setup({ keys: ['fal'], project: true })
    service.setProjectModels({ i2v: 'fal/veo-3.1-lite' })
    setNow(AFTER_SUNSET)
    expect(service.resolveModel('i2v')).toBe('fal/kling-3.0-standard')
    expect(project.models).toEqual({ i2v: 'fal/kling-3.0-standard' })
    expect(store.get().models).toEqual({})
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(service.takeNotices()).toEqual([
      '「Veo 3.1 Lite」已經下架，這個專案的影片改用「Kling 3.0 Standard」。可以到設定換別的。',
    ])
  })

  it('選不存在的模型、或做不到那個用途 → 拒絕，專案設定不變', () => {
    const { service, project } = setup({ keys: ['fal'], project: true })
    expect(() => {
      service.setProjectModels({ llm: 'fal/nano-banana-2' })
    }).toThrow('沒辦法用在這個用途')
    expect(project.models).toEqual({})
  })
})

describe('SettingsService：旁白與配樂', () => {
  it('只填 OpenRouter：旁白預設 MiniMax、配樂預設 Lyria 3 Pro；選單帶出每個模型的聲音', () => {
    const { service } = setup({ keys: ['openrouter'] })
    expect(service.resolveModel('tts')).toBe('openrouter/minimax-speech-2.8-hd')
    expect(service.resolveModel('music')).toBe('openrouter/lyria-3-pro')
    const listing = service.listModels()
    expect(listing.selected.tts).toBe('openrouter/minimax-speech-2.8-hd')
    expect(listing.selected.music).toBe('openrouter/lyria-3-pro')
    expect(listing.voices['openrouter/minimax-speech-2.8-hd']).toBe('male-qn-qingse')
    const minimax = listing.models.find((m) => m.id === 'openrouter/minimax-speech-2.8-hd')
    expect(minimax?.voices.map((v) => v.id)).toEqual(['male-qn-qingse'])
  })

  it('可以換旁白模型與聲音；聲音一定要在該模型的清單裡，換了模型就用新模型的預設聲音', () => {
    const { service } = setup({ keys: ['openrouter'] })
    service.update({ models: { tts: 'openrouter/eleven-v3' } })
    expect(service.resolveModel('tts')).toBe('openrouter/eleven-v3')
    expect(service.resolveVoice('openrouter/eleven-v3')).toBe('Adam')
    service.update({ audio: { voices: { 'openrouter/eleven-v3': 'Adam' } } })
    expect(service.listModels().voices['openrouter/eleven-v3']).toBe('Adam')
    expect(() =>
      service.update({ audio: { voices: { 'openrouter/eleven-v3': 'Rachel' } } }),
    ).toThrow(/沒辦法用在這個旁白模型/)
    expect(() => service.update({ audio: { voices: { 'openrouter/ghost': 'Adam' } } })).toThrow(
      /沒辦法用在這個旁白模型/,
    )
    // null 改回預設聲音
    service.update({ audio: { voices: { 'openrouter/eleven-v3': null } } })
    expect(service.resolveVoice('openrouter/eleven-v3')).toBe('Adam')
  })

  it('旁白模型不能拿去當配樂用；沒有聲音清單的模型沒有聲音可選', () => {
    const { service } = setup({ keys: ['openrouter'] })
    expect(() => service.update({ models: { music: 'openrouter/eleven-v3' } })).toThrow(
      /沒辦法用在這個用途/,
    )
    expect(service.resolveVoice('openrouter/lyria-3-pro')).toBeUndefined()
  })

  it('這個專案可以自己指定旁白模型', () => {
    const { service, project } = setup({ keys: ['openrouter'], project: true })
    service.setProjectModels({ tts: 'openrouter/eleven-v3' })
    expect(project.models.tts).toBe('openrouter/eleven-v3')
    expect(service.resolveModel('tts')).toBe('openrouter/eleven-v3')
  })
})
