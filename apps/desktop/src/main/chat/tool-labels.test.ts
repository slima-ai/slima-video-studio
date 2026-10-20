import { afterEach, describe, expect, it } from 'vitest'

import { startRealMcp } from '../mcp/test-support'
import { bareToolName, hasToolLabel, toolDoingLabel, toolLabel } from './tool-labels'

const running: Awaited<ReturnType<typeof startRealMcp>>[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
})

describe('工具名換成白話', () => {
  it('去掉前綴；做完是「建立鏡頭」、進行中是「正在建立鏡頭…」', () => {
    expect(bareToolName('mcp__slima-video-studio__create_shot')).toBe('create_shot')
    expect(toolLabel('create_shot')).toBe('建立鏡頭')
    expect(toolDoingLabel('create_shot')).toBe('正在建立鏡頭…')
  })

  it('沒有對照的工具退回「使用工具 xxx」，不會壞', () => {
    expect(toolLabel('brand_new_tool')).toBe('使用工具 brand_new_tool')
    expect(toolDoingLabel('brand_new_tool')).toBe('正在使用工具 brand_new_tool…')
  })

  it('我們 MCP 的每一個工具都有白話對照（新增工具忘了補會在這裡紅）', async () => {
    const r = await startRealMcp()
    running.push(r)
    const { tools } = await r.client.listTools()
    expect(tools.length).toBeGreaterThan(40)
    expect(tools.filter((t) => !hasToolLabel(t.name)).map((t) => t.name)).toEqual([])
  })
})
