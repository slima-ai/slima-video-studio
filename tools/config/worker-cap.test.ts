import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const MAX_WORKERS = 8
const root = join(__dirname, '../..')

function literal(file: string, key: 'maxWorkers' | 'workers'): number | null {
  const source = readFileSync(join(root, file), 'utf8')
  const match = new RegExp(`^\\s*${key}:\\s*(\\d+),?\\s*(?://.*)?$`, 'm').exec(source)
  return match?.[1] ? Number(match[1]) : null
}

// 測試的平行數上限是 8，而且必須是寫死的數字：不能用 CPU 數推算（這台機器同時有好幾個專案在跑測試）。
describe('測試平行數上限', () => {
  it.each([
    ['vitest.config.ts', 'maxWorkers'],
    ['apps/desktop/vitest.smoke.config.mts', 'maxWorkers'],
    ['apps/desktop/playwright.config.ts', 'workers'],
  ] as const)('%s 的 %s 是 1～8 的數字', (file, key) => {
    const value = literal(file, key)
    expect(value, `${file} 要寫死 ${key}: <1～${MAX_WORKERS} 的數字>`).not.toBeNull()
    expect(value).toBeGreaterThanOrEqual(1)
    expect(value).toBeLessThanOrEqual(MAX_WORKERS)
  })
})
