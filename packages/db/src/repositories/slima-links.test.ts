import { describe, expect, it } from 'vitest'

import { newProject } from '../__tests__/helpers'

describe('SlimaLinksRepository', () => {
  it('沒有匯入過就是空的', () => {
    expect(newProject().repos.slimaLinks.list()).toEqual([])
  })

  it('記下實體的來源；同一個實體重新匯入只更新、不重複', () => {
    const { repos } = newProject()
    const first = repos.slimaLinks.upsert({
      entityType: 'character',
      entityId: 'c1',
      bookToken: 'bk_1',
      path: 'characters/a.md',
      remoteVersion: 'v1',
    })
    expect(first).toMatchObject({ entityType: 'character', bookToken: 'bk_1', remoteVersion: 'v1' })

    repos.slimaLinks.upsert({
      entityType: 'character',
      entityId: 'c1',
      bookToken: 'bk_1',
      path: 'characters/a.md',
      remoteVersion: 'v2',
    })
    repos.slimaLinks.upsert({
      entityType: 'location',
      entityId: 'l1',
      bookToken: 'bk_1',
      path: 'w.md',
    })
    // 同一個實體來自另一個檔案：另外記一筆
    repos.slimaLinks.upsert({
      entityType: 'location',
      entityId: 'l1',
      bookToken: 'bk_1',
      path: 'w2.md',
    })

    const all = repos.slimaLinks.list()
    expect(all).toHaveLength(3)
    expect(repos.slimaLinks.forEntity('character', 'c1')?.remoteVersion).toBe('v2')
    expect(repos.slimaLinks.forEntity('location', 'l1')?.remoteVersion).toBeUndefined()
    expect(repos.slimaLinks.forSource('bk_1', 'w.md').map((l) => l.entityId)).toEqual(['l1'])
    expect(repos.slimaLinks.forSource('bk_2', 'w.md')).toEqual([])
  })
})
