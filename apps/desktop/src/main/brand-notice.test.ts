import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('brand 資料夾的授權聲明', () => {
  it('資料夾自己有 NOTICE，根目錄的 NOTICE 指過來（圖像不在 Apache-2.0 內）', () => {
    const here = join(__dirname, '../renderer/brand')
    expect(readFileSync(join(here, 'NOTICE'), 'utf8')).toContain('NOT licensed under the')
    expect(readFileSync(join(__dirname, '../../../../NOTICE'), 'utf8')).toContain(
      'apps/desktop/src/renderer/brand/',
    )
  })
})
