import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { NodeRegistry, canConnect, defineNode } from './node'

const make = (type: string) =>
  defineNode({
    type,
    version: 1,
    inputs: {},
    outputs: { value: 'text' },
    params: z.object({}),
    run: () => ({ value: 'x' }),
  })

describe('NodeRegistry', () => {
  it('註冊、查詢、列出類型', () => {
    const registry = new NodeRegistry().register(make('a')).register(make('b'))
    expect(registry.has('a')).toBe(true)
    expect(registry.has('c')).toBe(false)
    expect(registry.get('b')?.type).toBe('b')
    expect(registry.get('c')).toBeUndefined()
    expect(registry.types()).toEqual(['a', 'b'])
  })

  it('同一個類型不能重複註冊', () => {
    const registry = new NodeRegistry().register(make('a'))
    expect(() => registry.register(make('a'))).toThrow('節點類型重複註冊：a')
  })
})

describe('canConnect', () => {
  it('沿用 schema 的連線規則', () => {
    expect(canConnect('text', 'text')).toBe(true)
    expect(canConnect('image', 'imageList')).toBe(true)
    expect(canConnect('text', 'image')).toBe(false)
  })
})
