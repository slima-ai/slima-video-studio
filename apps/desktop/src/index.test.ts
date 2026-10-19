import { describe, expect, it } from 'vitest'

import { APP_NAME } from './index'

describe('@svs/desktop', () => {
  it('匯出應用名稱', () => {
    expect(APP_NAME).toBe('Slima Video Studio')
  })
})
