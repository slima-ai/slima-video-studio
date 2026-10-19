import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = join(__dirname, '../..')

// 預設的 5 秒逾時對 GitHub 的共用 runner 太緊（它比開發機慢 4～5 倍），會把「只是慢」誤判成失敗。
// 這裡釘住：兩份 vitest 設定都要把逾時拉到至少 15 秒（不是跳過、也不是停用，只是不要太緊）。
describe('vitest 的逾時', () => {
  it.each(['vitest.config.ts', 'apps/desktop/vitest.config.mts'])(
    '%s 的 testTimeout 至少 15 秒',
    (file) => {
      const source = readFileSync(join(root, file), 'utf8')
      const literal = /testTimeout:\s*([\d_]+|[A-Z_]+),/.exec(source)?.[1]
      expect(literal, `${file} 要設 testTimeout`).toBeDefined()
      const value = /^[\d_]+$/.test(literal ?? '')
        ? Number((literal ?? '').replaceAll('_', ''))
        : Number(
            new RegExp(`const ${literal ?? ''} = ([\\d_]+)`).exec(source)?.[1]?.replaceAll('_', ''),
          )
      expect(value).toBeGreaterThanOrEqual(15_000)
    },
  )
})
