import { describe, expect, it } from 'vitest'

import { newProject } from '../__tests__/helpers'

const HASH = (c: string): string => c.repeat(64)

describe('FinalCutRepository', () => {
  it('還沒接過：沒有最新的成品', () => {
    const { repos } = newProject()
    expect(repos.finalCuts.latest()).toBeUndefined()
  })

  it('每接一次多一個版本；最新的就是剛接好的，用了哪些影片版本照順序記下來', () => {
    const { repos } = newProject()
    const first = repos.finalCuts.record({
      assetHash: HASH('a'),
      durationSec: 9,
      takeIds: ['t1', 't2'],
    })
    expect(first).toMatchObject({ version: 1, durationSec: 9, takeIds: ['t1', 't2'] })
    const second = repos.finalCuts.record({ assetHash: HASH('b'), takeIds: ['t2', 't1'] })
    expect(second.version).toBe(2)
    expect(repos.finalCuts.latest()).toEqual(second)
    expect(repos.finalCuts.latest()?.durationSec).toBeUndefined()
  })
})
