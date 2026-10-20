import { AppError } from '@svs/schema'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ProjectManager } from './project-manager'

const dirs: string[] = []
const managers: ProjectManager[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'svs-pm-'))
  dirs.push(d)
  return d
}
const manager = (): ProjectManager => {
  const m = new ProjectManager('test')
  managers.push(m)
  return m
}

afterEach(() => {
  for (const m of managers.splice(0)) m.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('ProjectManager', () => {
  it('create → info → close → open，資料與 id 保持一致', () => {
    const m = manager()
    const dir = join(tmp(), '短片.svsproj')
    const created = m.create(dir, '短片')
    expect(created).toMatchObject({ name: '短片', dir, aspectRatio: '16:9' })
    expect(m.info()).toEqual(created)
    m.close()
    expect(m.info()).toBeNull()
    expect(m.open(dir)).toEqual(created)
  })

  it('開另一個專案會先關掉目前的（釋放它的鎖）', () => {
    const m = manager()
    const base = tmp()
    const a = join(base, 'a.svsproj')
    const b = join(base, 'b.svsproj')
    m.create(a, 'a')
    m.create(b, 'b')
    expect(m.info()?.name).toBe('b')
    // a 的鎖已釋放，可以再開
    expect(m.open(a).name).toBe('a')
  })

  it('另一個管理者（視窗）開著的專案不能再開，錯誤是型別化的', () => {
    const base = tmp()
    const dir = join(base, 'x.svsproj')
    manager().create(dir, 'x')
    try {
      manager().open(dir)
      expect.unreachable()
    } catch (error) {
      expect((error as AppError).code).toBe('project_locked')
    }
  })

  it('開啟失敗後，原本開著的專案已被關閉，狀態一致', () => {
    const m = manager()
    const base = tmp()
    m.create(join(base, 'a.svsproj'), 'a')
    expect(() => m.open(join(base, 'missing.svsproj'))).toThrow(AppError)
    expect(m.info()).toBeNull()
    expect(m.current()).toBeUndefined()
  })

  it('改名：資料庫與 project.json 兩份一起改，重開還是新名字；資料夾不變', () => {
    const m = manager()
    const dir = join(tmp(), '短片.svsproj')
    m.create(dir, '短片')
    expect(m.rename('新名字')).toMatchObject({ name: '新名字', dir })
    const file = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as { name: string }
    expect(file.name).toBe('新名字')
    m.close()
    expect(m.open(dir).name).toBe('新名字')
  })

  it('沒有開著的專案：改名丟 project_not_found，狀態是 null', () => {
    const m = manager()
    expect(m.status()).toBeNull()
    try {
      m.rename('x')
      throw new Error('預期丟出錯誤')
    } catch (error) {
      expect((error as AppError).code).toBe('project_not_found')
    }
  })

  it('狀態：名字、資料夾、最後寫入時間、花費（新專案是 0）', () => {
    const m = manager()
    const dir = join(tmp(), '短片.svsproj')
    m.create(dir, '短片')
    const status = m.status()
    expect(status).toMatchObject({ name: '短片', dir, spentUsd: 0 })
    expect(Number.isNaN(Date.parse(status?.savedAt ?? ''))).toBe(false)
  })
})
