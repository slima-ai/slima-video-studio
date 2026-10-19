import { describe, expect, it } from 'vitest'

import { buildCsp } from './csp'

describe('buildCsp', () => {
  it('正式版不允許 unsafe-inline / unsafe-eval，也不允許遠端來源', () => {
    const csp = buildCsp({ dev: false })
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toMatch(/https?:/)
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  it('素材只能從 svs-asset 協定載入', () => {
    const csp = buildCsp({ dev: false })
    expect(csp).toContain('img-src')
    expect(csp).toContain('svs-asset:')
  })

  it('dev 模式放行 HMR 所需的 WebSocket', () => {
    expect(buildCsp({ dev: true })).toContain('ws://localhost:*')
    expect(buildCsp({ dev: false })).not.toContain('ws://')
  })
})
