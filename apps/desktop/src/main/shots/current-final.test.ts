import type { FinalCut, ProjectHandle } from '@svs/db'
import { describe, expect, it } from 'vitest'

import { currentFinal, cutTakeIdsOf } from './current-final'

const cut = (version: number, takeIds: string[], soundKey?: string): FinalCut => ({
  id: `cut-${String(version)}`,
  version,
  assetHash: `hash-${String(version)}`,
  takeIds,
  ...(soundKey === undefined ? {} : { soundKey }),
  createdAt: '2026-10-21T00:00:00.000Z',
})

/** 最小的假專案：幾個鏡頭（放不放進成品、採用中的影片版本）、幾個成品版本、哪些檔案還在。 */
function fakeHandle(options: {
  shots: { id: string; inCut: boolean; take?: string }[]
  cuts: FinalCut[]
  missing?: string[]
}): ProjectHandle {
  return {
    repos: {
      shots: {
        list: () => options.shots.map((s) => ({ id: s.id, inCut: s.inCut })),
        listTakes: (shotId: string) => {
          const take = options.shots.find((s) => s.id === shotId)?.take
          return take === undefined ? [] : [{ id: take, adopted: true }]
        },
      },
      finalCuts: { list: () => [...options.cuts].sort((a, b) => b.version - a.version) },
    },
    assets: {
      find: (hash: string) =>
        options.missing?.includes(hash) === true ? undefined : { path: `/x/${hash}`, mime: 'v' },
    },
  } as unknown as ProjectHandle
}

const SHOTS = [
  { id: 's1', inCut: true, take: 't1' },
  { id: 's2', inCut: true, take: 't2' },
  { id: 's3', inCut: false, take: 't3' },
]

describe('cutTakeIdsOf', () => {
  it('放進成品的鏡頭依序的採用中影片版本；沒有影片的是空字串；沒放進成品的不算', () => {
    expect(cutTakeIdsOf(fakeHandle({ shots: SHOTS, cuts: [] }))).toEqual(['t1', 't2'])
    expect(
      cutTakeIdsOf(fakeHandle({ shots: [{ id: 'a', inCut: true }, ...SHOTS], cuts: [] })),
    ).toEqual(['', 't1', 't2'])
  })
})

describe('currentFinal：成品的目前版本＝跟現在狀態對得上的那一版', () => {
  it('沒接過成品：沒有', () => {
    expect(currentFinal(fakeHandle({ shots: SHOTS, cuts: [] }), undefined)).toBeUndefined()
  })

  it('最新一版就對得上：用它，不 stale', () => {
    const handle = fakeHandle({
      shots: SHOTS,
      cuts: [cut(1, ['t1', 't2']), cut(2, ['t1', 't2'], 'K')],
    })
    expect(currentFinal(handle, 'K')).toMatchObject({ stale: false, cut: { version: 2 } })
  })

  it('復原／重做：聲音指紋回到較早的版本，就是那一版（不是最新的），不 stale', () => {
    const handle = fakeHandle({
      shots: SHOTS,
      cuts: [cut(1, ['t1', 't2'], 'A'), cut(2, ['t1', 't2'], 'B'), cut(3, ['t1', 't2'], 'C')],
    })
    expect(currentFinal(handle, 'A')).toMatchObject({ stale: false, cut: { version: 1 } })
    expect(currentFinal(handle, 'B')).toMatchObject({ stale: false, cut: { version: 2 } })
    expect(currentFinal(handle, 'C')).toMatchObject({ stale: false, cut: { version: 3 } })
  })

  it('沒有聲音（指紋是 undefined）也算：回到沒有聲音的那一版', () => {
    const handle = fakeHandle({
      shots: SHOTS,
      cuts: [cut(1, ['t1', 't2']), cut(2, ['t1', 't2'], 'K')],
    })
    expect(currentFinal(handle, undefined)).toMatchObject({ stale: false, cut: { version: 1 } })
  })

  it('同樣的條件有好幾版：用最新的那一版', () => {
    const handle = fakeHandle({
      shots: SHOTS,
      cuts: [cut(1, ['t1', 't2'], 'K'), cut(2, ['t1', 't2'], 'X'), cut(3, ['t1', 't2'], 'K')],
    })
    expect(currentFinal(handle, 'K')).toMatchObject({ cut: { version: 3 } })
  })

  it('影片一樣、只有聲音不同：對不上，用最新一版，原因是聲音（重混就好）', () => {
    const handle = fakeHandle({ shots: SHOTS, cuts: [cut(1, ['t1', 't2'], 'A')] })
    expect(currentFinal(handle, 'Z')).toMatchObject({ stale: 'sound', cut: { version: 1 } })
  })

  it('用的影片版本換了：就算聲音一樣也對不上，原因是鏡頭（要重新接）', () => {
    const handle = fakeHandle({
      shots: [
        { id: 's1', inCut: true, take: 't1-new' },
        { id: 's2', inCut: true, take: 't2' },
      ],
      cuts: [cut(1, ['t1', 't2'], 'A')],
    })
    expect(currentFinal(handle, 'A')).toMatchObject({ stale: 'shots', cut: { version: 1 } })
  })

  it('多一個鏡頭放進成品、或關掉一個：對不上（長度不同），原因是鏡頭', () => {
    const cuts = [cut(1, ['t1', 't2'], 'A')]
    const more = fakeHandle({
      shots: [...SHOTS.slice(0, 2), { id: 's3', inCut: true, take: 't3' }],
      cuts,
    })
    expect(currentFinal(more, 'A')).toMatchObject({ stale: 'shots' })
    const [firstShot] = SHOTS
    if (!firstShot) throw new Error('fixture')
    const fewer = fakeHandle({ shots: [firstShot], cuts })
    expect(currentFinal(fewer, 'A')).toMatchObject({ stale: 'shots' })
  })

  it('對得上的那一版檔案不在了：不用它，照常當成對不上（重混），不會拿到沒有檔案的版本', () => {
    const handle = fakeHandle({
      shots: SHOTS,
      cuts: [cut(1, ['t1', 't2'], 'A'), cut(2, ['t1', 't2'], 'B')],
      missing: ['hash-1'],
    })
    expect(currentFinal(handle, 'A')).toMatchObject({ stale: 'sound', cut: { version: 2 } })
  })

  it('較新的同條件版本檔案不在、較舊的在：用較舊的那一版', () => {
    const handle = fakeHandle({
      shots: SHOTS,
      cuts: [cut(1, ['t1', 't2'], 'K'), cut(2, ['t1', 't2'], 'K')],
      missing: ['hash-2'],
    })
    expect(currentFinal(handle, 'K')).toMatchObject({ stale: false, cut: { version: 1 } })
  })
})
