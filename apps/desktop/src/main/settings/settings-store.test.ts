import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyPatch, createMemorySettingsStore, createSettingsStore } from './settings-store'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'svs-settings-'))
  file = join(dir, 'settings.json')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createSettingsStore', () => {
  it('沒有檔案時用預設值（單次上限 US$5、非示範模式、尚未完成引導）', () => {
    const store = createSettingsStore({ file })
    expect(store.get()).toEqual({
      onboardingDone: false,
      demoMode: false,
      advancedMode: false,
      theme: 'system',
      language: 'system',
      models: {},
      budget: { perRunLimitUsd: 5 },
      modelNotices: [],
      storyboardGuide: '',
      videoNegativePrompt: '',
      characterPrompts: {},
      productionGuide: '',
      mcp: { enabled: false, port: 47821, allowanceUsd: 0 },
      audio: { voices: {} },
      experiments: {},
    })
  })

  it('initial 只在沒有檔案時生效', () => {
    expect(createSettingsStore({ file, initial: { demoMode: true } }).get().demoMode).toBe(true)
    const store = createSettingsStore({ file, initial: { demoMode: true } })
    store.update({ demoMode: false })
    expect(createSettingsStore({ file, initial: { demoMode: true } }).get().demoMode).toBe(false)
  })

  it('更新立刻寫檔，重開後還在，且不留暫存檔', () => {
    const store = createSettingsStore({ file })
    store.update({ onboardingDone: true, models: { llm: 'openrouter/claude-sonnet-5.5' } })
    store.update({ budget: { perRunLimitUsd: 12, projectLimitUsd: 50 } })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ onboardingDone: true })
    expect(readdirSync(dir)).toEqual(['settings.json'])

    const reopened = createSettingsStore({ file }).get()
    expect(reopened.models).toEqual({ llm: 'openrouter/claude-sonnet-5.5' })
    expect(reopened.budget).toEqual({ perRunLimitUsd: 12, projectLimitUsd: 50 })
  })

  it('檔案損毀 → 備份、用預設值、警告，App 照常啟動', () => {
    writeFileSync(file, '{ not json')
    const warn = vi.fn()
    const store = createSettingsStore({ file, warn })
    expect(store.get().budget.perRunLimitUsd).toBe(5)
    expect(warn).toHaveBeenCalledOnce()
    expect(readdirSync(dir).some((f) => f.startsWith('settings.json.broken-'))).toBe(true)
    // 之後還能正常儲存
    store.update({ demoMode: true })
    expect(createSettingsStore({ file }).get().demoMode).toBe(true)
  })

  it('內容格式不對（欄位型別錯）也視為損毀', () => {
    writeFileSync(file, JSON.stringify({ demoMode: 'yes' }))
    const warn = vi.fn()
    expect(createSettingsStore({ file, warn }).get().demoMode).toBe(false)
    expect(warn).toHaveBeenCalled()
  })
})

describe('applyPatch', () => {
  const base = createMemorySettingsStore({ models: { llm: 'a/b', t2i: 'c/d' } }).get()

  it('models 逐項合併，null 表示改回推薦', () => {
    const next = applyPatch(base, { models: { llm: null, i2v: 'e/f' } })
    expect(next.models).toEqual({ t2i: 'c/d', i2v: 'e/f' })
  })

  it('沒提到的欄位維持原樣', () => {
    expect(applyPatch(base, {})).toEqual(base)
    expect(applyPatch(base, { demoMode: true }).models).toEqual(base.models)
  })

  it('介面語言：預設跟著系統；可以改成指定語言，改別的設定不會動到它', () => {
    expect(base.language).toBe('system')
    const en = applyPatch(base, { language: 'en' })
    expect(en.language).toBe('en')
    expect(applyPatch(en, { demoMode: true }).language).toBe('en')
    expect(applyPatch(en, { language: 'zh-TW' }).language).toBe('zh-TW')
  })

  it('舊的設定檔沒有 language 欄位，讀進來是「跟著系統」', () => {
    writeFileSync(file, JSON.stringify({ onboardingDone: true }), 'utf8')
    expect(createSettingsStore({ file }).get().language).toBe('system')
  })

  it('設定有變就通知訂閱的人（update 與 setNotices 都算）；取消訂閱之後不再通知', () => {
    const store = createMemorySettingsStore()
    const seen: string[] = []
    const off = store.subscribe((settings) => seen.push(settings.language))
    store.update({ language: 'en' })
    store.setNotices(['x'])
    off()
    store.update({ language: 'zh-TW' })
    expect(seen).toEqual(['en', 'en'])
  })

  it('AI 工具連線：預設關閉、額度 0；更新逐項合併，只改給的欄位', () => {
    expect(base.mcp).toEqual({ enabled: false, port: 47821, allowanceUsd: 0 })
    const on = applyPatch(base, { mcp: { enabled: true } })
    expect(on.mcp).toEqual({ enabled: true, port: 47821, allowanceUsd: 0 })
    const more = applyPatch(on, { mcp: { allowanceUsd: 2.5 } })
    expect(more.mcp).toEqual({ enabled: true, port: 47821, allowanceUsd: 2.5 })
    // 改別的設定不會動到它
    expect(applyPatch(more, { demoMode: true }).mcp).toEqual(more.mcp)
    // 沒給的欄位（undefined）不會把原值蓋掉
    expect(applyPatch(more, { mcp: { port: undefined, enabled: false } }).mcp).toEqual({
      enabled: false,
      port: 47821,
      allowanceUsd: 2.5,
    })
  })

  it('實驗功能：沒設就是沒有值（依版本決定）；更新逐項合併，沒給的欄位不蓋掉原值', () => {
    expect(base.experiments).toEqual({})
    const on = applyPatch(base, { experiments: { claudeChat: true } })
    expect(on.experiments).toEqual({ claudeChat: true })
    expect(applyPatch(on, { experiments: { claudeChat: undefined } }).experiments).toEqual({
      claudeChat: true,
    })
    // 用量上限：設了就存，null 改回預設
    const budget = applyPatch(on, { experiments: { claudeBudgetUsd: 1.5 } })
    expect(budget.experiments).toEqual({ claudeChat: true, claudeBudgetUsd: 1.5 })
    expect(applyPatch(budget, { experiments: { claudeBudgetUsd: null } }).experiments).toEqual({
      claudeChat: true,
    })
    expect(applyPatch(on, { demoMode: true }).experiments).toEqual({ claudeChat: true })
    expect(applyPatch(on, { experiments: { claudeChat: false } }).experiments).toEqual({
      claudeChat: false,
    })
  })

  it('分鏡準則：存下去會去掉頭尾空白，傳空字串表示恢復預設', () => {
    const custom = applyPatch(base, { storyboardGuide: '  多用遠景。\n ' })
    expect(custom.storyboardGuide).toBe('多用遠景。')
    expect(applyPatch(custom, { demoMode: true }).storyboardGuide).toBe('多用遠景。')
    expect(applyPatch(custom, { storyboardGuide: '' }).storyboardGuide).toBe('')
  })

  it('影片的負面提示：存前後空白會去掉；別的更新不動它；空字串就是恢復各模型內建的清單', () => {
    const custom = applyPatch(base, { videoNegativePrompt: '  mouth, arms \n' })
    expect(custom.videoNegativePrompt).toBe('mouth, arms')
    expect(applyPatch(custom, { demoMode: true }).videoNegativePrompt).toBe('mouth, arms')
    expect(applyPatch(custom, { videoNegativePrompt: '' }).videoNegativePrompt).toBe('')
  })

  it('角色提示詞範本：逐項合併、去掉頭尾空白；空白表示那一項恢復預設，沒提到的項目不動', () => {
    const one = applyPatch(base, { characterPrompts: { concept: '  我的概念圖範本 {{名稱}}\n' } })
    expect(one.characterPrompts).toEqual({ concept: '我的概念圖範本 {{名稱}}' })
    const two = applyPatch(one, { characterPrompts: { turnaround: '三視圖範本' } })
    expect(two.characterPrompts).toEqual({
      concept: '我的概念圖範本 {{名稱}}',
      turnaround: '三視圖範本',
    })
    // 改別的設定不會動到範本
    expect(applyPatch(two, { demoMode: true }).characterPrompts).toEqual(two.characterPrompts)
    // 空白＝恢復預設：設定檔裡就不留那一項
    expect(applyPatch(two, { characterPrompts: { concept: '   ' } }).characterPrompts).toEqual({
      turnaround: '三視圖範本',
    })
  })

  it('製片與一致性指南：去掉頭尾空白、傳空字串恢復預設，而且跟分鏡準則各存各的', () => {
    const custom = applyPatch(base, {
      productionGuide: '  臉先鎖定。\n ',
      storyboardGuide: '多用遠景。',
    })
    expect(custom.productionGuide).toBe('臉先鎖定。')
    expect(applyPatch(custom, { demoMode: true }).productionGuide).toBe('臉先鎖定。')
    const reset = applyPatch(custom, { productionGuide: '' })
    expect(reset.productionGuide).toBe('')
    expect(reset.storyboardGuide).toBe('多用遠景。')
  })
})

describe('createMemorySettingsStore', () => {
  it('行為與檔案版相同但不寫檔', () => {
    const store = createMemorySettingsStore()
    expect(store.update({ demoMode: true }).demoMode).toBe(true)
    expect(store.get().demoMode).toBe(true)
  })
})

describe('applyPatch：旁白的聲音', () => {
  it('逐模型合併；null 刪掉該模型的選擇（改回預設聲音）；沒提到的不動', () => {
    const base = createMemorySettingsStore().get()
    const a = applyPatch(base, { audio: { voices: { 'openrouter/eleven-v3': 'Adam' } } })
    expect(a.audio.voices).toEqual({ 'openrouter/eleven-v3': 'Adam' })
    const b = applyPatch(a, { audio: { voices: { 'openrouter/minimax-speech-2.8-hd': 'v' } } })
    expect(b.audio.voices).toEqual({
      'openrouter/eleven-v3': 'Adam',
      'openrouter/minimax-speech-2.8-hd': 'v',
    })
    expect(
      applyPatch(b, { audio: { voices: { 'openrouter/eleven-v3': null } } }).audio.voices,
    ).toEqual({
      'openrouter/minimax-speech-2.8-hd': 'v',
    })
    // 改別的設定不會動到聲音
    expect(applyPatch(b, { theme: 'dark' }).audio).toEqual(b.audio)
  })

  it('舊的設定檔沒有 audio 欄位，讀進來是空的', () => {
    writeFileSync(file, JSON.stringify({ onboardingDone: true }), 'utf8')
    expect(createSettingsStore({ file }).get().audio).toEqual({ voices: {} })
  })
})
