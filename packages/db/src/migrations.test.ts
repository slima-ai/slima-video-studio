import { describe, expect, it } from 'vitest'

import { MIGRATIONS } from './migrations.generated'
// @ts-expect-error -- 內嵌腳本是 .mjs，沒有型別宣告
import { buildMigrationsSource } from '../scripts/embed-migrations.mjs'

describe('內嵌的 migration', () => {
  it('migrations.generated.ts 是最新的（改了 schema 後要執行 pnpm --filter @svs/db db:generate）', async () => {
    const { readFileSync } = await import('node:fs')
    const current = readFileSync(new URL('./migrations.generated.ts', import.meta.url), 'utf8')
    expect(current).toBe((buildMigrationsSource as () => string)())
  })

  it('migration 檔名依序編號', () => {
    MIGRATIONS.forEach((m, index) => {
      expect(m.tag.startsWith(String(index).padStart(4, '0'))).toBe(true)
      expect(m.statements.length).toBeGreaterThan(0)
    })
  })
})
