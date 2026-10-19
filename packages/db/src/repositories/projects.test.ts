import { describe, expect, it } from 'vitest'

import { newProject } from '../__tests__/helpers'

describe('ProjectsRepository', () => {
  it('update 只改傳入的欄位並更新 updatedAt', () => {
    const handle = newProject()
    const before = handle.repos.projects.get()
    const after = handle.repos.projects.update({
      budget: { perRunLimitUsd: 12, projectLimitUsd: 100 },
    })
    expect(after.name).toBe(before.name)
    expect(after.budget).toEqual({ perRunLimitUsd: 12, projectLimitUsd: 100 })
    expect(after.updatedAt >= before.updatedAt).toBe(true)
    expect(handle.repos.projects.get()).toEqual(after)
  })

  it('這個專案預設用的模型：新專案是空的（跟著 App 設定），存了讀得回來', () => {
    const handle = newProject()
    expect(handle.repos.projects.get().models).toEqual({})
    handle.repos.projects.update({ models: { t2i: 'fal/seedream-5.0' } })
    expect(handle.repos.projects.get().models).toEqual({ t2i: 'fal/seedream-5.0' })
  })

  it('拒絕不合法的值', () => {
    const handle = newProject()
    expect(() => handle.repos.projects.update({ name: '' })).toThrow()
    expect(() => handle.repos.projects.update({ budget: { perRunLimitUsd: -1 } })).toThrow()
    expect(() => handle.repos.projects.update({ models: { t2i: '' } })).toThrow()
  })

  it('毀損的資料（資料庫被外部改壞）讀取時會被 Zod 擋下', () => {
    const handle = newProject()
    handle.sqlite.prepare("update projects set aspect_ratio = '7:3'").run()
    expect(() => handle.repos.projects.get()).toThrow()
  })
})
