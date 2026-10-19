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
      models: {},
      budget: { perRunLimitUsd: 5 },
      modelNotices: [],
      storyboardGuide: '',
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

  it('分鏡準則：存下去會去掉頭尾空白，傳空字串表示恢復預設', () => {
    const custom = applyPatch(base, { storyboardGuide: '  多用遠景。\n ' })
    expect(custom.storyboardGuide).toBe('多用遠景。')
    expect(applyPatch(custom, { demoMode: true }).storyboardGuide).toBe('多用遠景。')
    expect(applyPatch(custom, { storyboardGuide: '' }).storyboardGuide).toBe('')
  })
})

describe('createMemorySettingsStore', () => {
  it('行為與檔案版相同但不寫檔', () => {
    const store = createMemorySettingsStore()
    expect(store.update({ demoMode: true }).demoMode).toBe(true)
    expect(store.get().demoMode).toBe(true)
  })
})
