import { describe, expect, it, vi } from 'vitest'

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

  it('有聲音的成品記住接片的結果（重混從這支開始）與聲音的指紋；沒有聲音就都沒有', () => {
    const { repos } = newProject()
    const plain = repos.finalCuts.record({ assetHash: HASH('a'), takeIds: ['t1'] })
    expect(plain.baseAssetHash).toBeUndefined()
    expect(plain.soundKey).toBeUndefined()
    const mixed = repos.finalCuts.record({
      assetHash: HASH('m'),
      baseAssetHash: HASH('a'),
      soundKey: 'k1',
      takeIds: ['t1'],
    })
    expect(repos.finalCuts.latest()).toEqual(mixed)
    expect(mixed).toMatchObject({ baseAssetHash: HASH('a'), soundKey: 'k1' })
  })

  it('list：所有版本，新的在前；latest 就是第一個；沒有版本是空的', () => {
    const { repos } = newProject()
    expect(repos.finalCuts.list()).toEqual([])
    const a = repos.finalCuts.record({ assetHash: HASH('a'), takeIds: ['t1'] })
    const b = repos.finalCuts.record({ assetHash: HASH('b'), takeIds: ['t1'], soundKey: 'k' })
    expect(repos.finalCuts.list()).toEqual([b, a])
    expect(repos.finalCuts.latest()).toEqual(b)
  })

  it('latest 只向資料庫要最新的一筆（SQL 有 limit），不把所有版本撈回來再挑；結果跟 list 的第一個一樣', () => {
    const handle = newProject()
    const { repos, sqlite } = handle
    for (const c of ['a', 'b', 'c', 'd']) {
      repos.finalCuts.record({ assetHash: HASH(c), takeIds: [c] })
    }
    const prepared: string[] = []
    const prepare = sqlite.prepare.bind(sqlite)
    vi.spyOn(sqlite, 'prepare').mockImplementation(((sql: string) => {
      prepared.push(sql)
      return prepare(sql)
    }) as typeof sqlite.prepare)
    const latest = repos.finalCuts.latest()
    const selects = prepared.filter((sql) => /^select /i.test(sql) && sql.includes('final_cuts'))
    expect(selects).toHaveLength(1)
    expect(selects[0]).toMatch(/limit/i)
    expect(latest?.version).toBe(4)
    expect(latest).toEqual(repos.finalCuts.list()[0])
  })
})
