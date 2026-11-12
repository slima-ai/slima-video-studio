import { AppError, CARRIED_OVER_RUN_ID } from '@svs/schema'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createAppLedger } from './costs/app-ledger'
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

  it('App 層帳本裡的錢（專案不在了、錢還是花了）：下一個建出來的專案移進自己的帳本，算一次；再下一個是 0', () => {
    const ledger = createAppLedger({})
    const m = new ProjectManager('test', ledger)
    managers.push(m)
    ledger.record({
      provider: 'openrouter',
      modelId: 'x/llm',
      amountUsd: 0.37,
      jobId: 'j1',
      reason: 'test',
    })
    ledger.record({ provider: 'mock', modelId: 'mock/llm', amountUsd: 9, reason: 'test' })

    // 第一個建出來的專案：含這筆（示範用的 mock 不算進「已花」，但整個加總與以前一樣不排除）
    m.create(join(tmp(), '第一個.svsproj'), '第一個')
    const first = m.current()
    if (!first) throw new Error('專案應該開著')
    expect(m.status()).toMatchObject({ spentUsd: 0.37, discardedSpentUsd: 0.37 })
    expect(first.repos.costs.totalUsd(first.projectId)).toBeCloseTo(9.37, 9)
    // 移進它的帳本：一筆一筆的紀錄都在，標明是之前沒做成的
    expect(first.repos.costs.list(first.projectId)).toHaveLength(2)
    expect(
      first.repos.costs.list(first.projectId, { runId: CARRIED_OVER_RUN_ID }).map((e) => e.jobId),
    ).toContain('j1')
    // 帳本裡那幾筆標成已移，留著當紀錄，不再算進別的專案
    expect(ledger.totalUsd()).toBe(0)
    expect(ledger.list()).toHaveLength(2)
    expect(ledger.list().every((e) => e.movedToProjectId === first.projectId)).toBe(true)

    // 第二個專案：沒有這筆
    m.create(join(tmp(), '第二個.svsproj'), '第二個')
    const second = m.current()
    if (!second) throw new Error('專案應該開著')
    expect(m.status()).toMatchObject({ spentUsd: 0 })
    expect(m.status()).not.toHaveProperty('discardedSpentUsd')
    expect(second.repos.costs.totalUsd(second.projectId)).toBe(0)
    // 回去開第一個：還是含那一筆（錢在它的帳本裡）
    m.open(first.dir)
    expect(m.status()).toMatchObject({ spentUsd: 0.37, discardedSpentUsd: 0.37 })
  })

  it('開舊專案、另存為都不領 App 層的錢（只有「建出來」的新專案才領）', async () => {
    const ledger = createAppLedger({})
    const m = new ProjectManager('test', ledger)
    managers.push(m)
    const dir = join(tmp(), '舊的.svsproj')
    m.create(dir, '舊的')
    ledger.record({ provider: 'openrouter', modelId: 'x/llm', amountUsd: 0.5, reason: 'test' })
    m.open(dir)
    expect(m.status()?.spentUsd).toBe(0)
    await m.saveAs(join(tmp(), '複本.svsproj'), '複本')
    expect(m.status()?.spentUsd).toBe(0)
    expect(ledger.totalUsd()).toBe(0.5)
  })

  it('另存為：複本有一樣的資料、換成新名字並開著；原本的資料夾沒動，還能再打開', async () => {
    const m = manager()
    const dir = join(tmp(), '原本.svsproj')
    m.create(dir, '原本')
    m.current()?.repos.characters.create('阿鐵')
    const copyDir = join(tmp(), '複本.svsproj')
    const info = await m.saveAs(copyDir, '複本')
    expect(info).toMatchObject({ name: '複本', dir: copyDir })
    expect(m.info()).toEqual(info)
    expect(
      m
        .current()
        ?.repos.characters.list()
        .map((c) => c.name),
    ).toEqual(['阿鐵'])
    // 原本的：名字沒變、資料還在
    expect(m.open(dir).name).toBe('原本')
    expect(
      m
        .current()
        ?.repos.characters.list()
        .map((c) => c.name),
    ).toEqual(['阿鐵'])
  })

  it('另存失敗：目前的專案照開、沒留下半個資料夾；沒有專案時丟 project_not_found', async () => {
    const m = manager()
    await expect(m.saveAs(join(tmp(), 'x.svsproj'), 'x')).rejects.toMatchObject({
      code: 'project_not_found',
    })
    const dir = join(tmp(), '原本.svsproj')
    m.create(dir, '原本')
    const root = tmp()
    mkdirSync(join(root, '已有的.svsproj'))
    await expect(m.saveAs(join(root, '已有的.svsproj'), 'x')).rejects.toMatchObject({
      code: 'project_exists',
    })
    expect(m.info()?.dir).toBe(dir)
  })
})
