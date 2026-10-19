import { describe, expect, it } from 'vitest'

import { PACKAGE_NAME } from './index'

describe('@svs/providers', () => {
  it('匯出套件名稱', () => {
    expect(PACKAGE_NAME).toBe('@svs/providers')
  })
})
