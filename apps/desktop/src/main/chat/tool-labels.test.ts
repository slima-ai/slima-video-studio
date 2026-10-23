import { DEFAULT_LOCALE, setLocale } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { startRealMcp } from '../mcp/test-support'
import { bareToolName, hasToolLabel, toolDoingLabel, toolLabel } from './tool-labels'

const running: Awaited<ReturnType<typeof startRealMcp>>[] = []
afterEach(async () => {
  setLocale(DEFAULT_LOCALE)
  for (const r of running.splice(0)) await r.close()
})

describe('工具名換成白話', () => {
  it('去掉前綴；做完是「建立鏡頭」、進行中是「正在建立鏡頭…」', () => {
    expect(bareToolName('mcp__slima-video-studio__create_shot')).toBe('create_shot')
    expect(toolLabel('create_shot')).toBe('建立鏡頭')
    expect(toolDoingLabel('create_shot')).toBe('正在建立鏡頭…')
  })

  it('沒有對照的工具退回「做了一個步驟」，不會壞、也不把英文工具名給使用者看', () => {
    expect(toolLabel('brand_new_tool')).toBe('做了一個步驟')
    expect(toolDoingLabel('brand_new_tool')).toBe('正在做一個步驟…')
  })

  it('同一個詞不能指兩件事：重做（取消復原）和重新生成要分得開', () => {
    expect(toolLabel('redo')).not.toBe(toolLabel('regenerate_shot'))
    expect(toolLabel('regenerate_shot')).toBe('重新生成鏡頭')
    expect(toolLabel('redo')).toBe('重做（取消剛才的復原）')
  })

  it('我們 MCP 的每一個工具都有白話對照（新增工具忘了補會在這裡紅）', async () => {
    const r = await startRealMcp()
    running.push(r)
    const { tools } = await r.client.listTools()
    expect(tools.length).toBeGreaterThan(40)
    expect(tools.filter((t) => !hasToolLabel(t.name)).map((t) => t.name)).toEqual([])
  })

  it('英文：每一個工具的白話標籤都是英文，進行中與做完不同、重做和重新生成分得開', async () => {
    setLocale('en')
    const r = await startRealMcp()
    running.push(r)
    const { tools } = await r.client.listTools()
    const bad = /[㐀-鿿，。：；（）、！？「」・]/
    for (const tool of tools) {
      expect(bad.test(toolLabel(tool.name)), `${tool.name}: ${toolLabel(tool.name)}`).toBe(false)
    }
    expect(toolLabel('create_shot')).toBe('Create a shot')
    expect(toolDoingLabel('create_shot')).toBe('Create a shot…')
    expect(toolLabel('brand_new_tool')).toBe('Did a step')
    expect(toolLabel('redo')).not.toBe(toolLabel('regenerate_shot'))
  })
})
