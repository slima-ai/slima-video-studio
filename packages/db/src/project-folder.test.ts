import { AppError } from '@svs/schema'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { env, newProject, reopen, tempDir } from './__tests__/helpers'
import { MIGRATIONS } from './migrations.generated'
import { createProject, openProject } from './project-folder'

const expectCode = (fn: () => unknown, code: string): void => {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return
  }
  throw new Error(`預期丟出 ${code}，但沒有丟出錯誤`)
}

describe('createProject', () => {
  it('建立專案資料夾、project.json、project.sqlite 與子資料夾', () => {
    const handle = newProject('我的短片')
    const files = readdirSync(handle.dir)
    expect(files).toEqual(
      expect.arrayContaining(['project.json', 'project.sqlite', 'assets', 'exports', 'backups']),
    )
    const file = JSON.parse(readFileSync(join(handle.dir, 'project.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(file).toMatchObject({
      format: 'svs-project',
      formatVersion: 1,
      name: '我的短片',
      appVersion: '0.0.0-test',
      projectId: handle.projectId,
    })
    expect(handle.repos.projects.get()).toMatchObject({
      name: '我的短片',
      aspectRatio: '16:9',
      schemaVersion: MIGRATIONS.length,
      budget: { perRunLimitUsd: 5 },
    })
  })

  it('資料庫使用 WAL 與外鍵', () => {
    const handle = newProject()
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('資料夾名稱必須以 .svsproj 結尾', () => {
    expectCode(
      () => createProject({ dir: join(tempDir(), 'x'), name: 'x' }, env),
      'invalid_request',
    )
  })

  it('目標位置已存在時拒絕建立', () => {
    const dir = tempDir()
    expectCode(() => createProject({ dir, name: 'x' }, env), 'invalid_request')
    const existing = join(dir, 'a.svsproj')
    createProject({ dir: existing, name: 'a' }, env).close()
    expectCode(() => createProject({ dir: existing, name: 'a' }, env), 'project_exists')
  })
})

describe('openProject', () => {
  it('新建 → 關閉 → 重開，資料仍在', () => {
    const first = newProject('持久化')
    const shot = first.repos.shots.create({ description: '第一鏡' })
    first.repos.projects.update({ name: '改過的名字' })
    first.close()

    const second = reopen(first)
    expect(second.projectId).toBe(first.projectId)
    expect(second.repos.projects.get().name).toBe('改過的名字')
    expect(second.repos.shots.list().map((s) => s.id)).toEqual([shot.id])
    // project.json 同步成最新名稱
    const file = JSON.parse(readFileSync(join(second.dir, 'project.json'), 'utf8')) as {
      name: string
    }
    expect(file.name).toBe('改過的名字')
  })

  it('同一個專案開兩次會出現明確的錯誤訊息', () => {
    const first = newProject()
    try {
      openProject(first.dir, env)
      expect.unreachable('不應該能開第二次')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('project_locked')
      expect((error as AppError).userMessage).toContain('已經在另一個視窗開啟')
    }
  })

  it('關閉後鎖就釋放，可以再開', () => {
    const first = newProject()
    first.close()
    expect(existsSync(join(first.dir, 'project.lock'))).toBe(false)
    reopen(first).close()
  })

  it('上次當機留下的過期鎖（行程已不存在）會被接手', () => {
    const first = newProject()
    first.close()
    // pid 超過 Linux 預設的上限，不會有這個行程
    writeFileSync(
      join(first.dir, 'project.lock'),
      JSON.stringify({ pid: 4_194_305, host: hostname(), startedAt: 'x' }),
    )
    reopen(first).close()
  })

  it('壞掉的鎖檔（內容不是 JSON）視為過期', () => {
    const first = newProject()
    first.close()
    writeFileSync(join(first.dir, 'project.lock'), 'garbage')
    reopen(first).close()
  })

  it('不存在的資料夾或沒有 project.json 時回報 project_not_found', () => {
    expectCode(() => openProject(join(tempDir(), 'nope.svsproj'), env), 'project_not_found')
    expectCode(() => openProject(tempDir(), env), 'project_not_found')
  })

  it('project.json 損壞時回報 project_invalid，並且不會留下鎖', () => {
    const first = newProject()
    first.close()
    writeFileSync(join(first.dir, 'project.json'), '{ not json')
    expectCode(() => openProject(first.dir, env), 'project_invalid')
    expect(existsSync(join(first.dir, 'project.lock'))).toBe(false)
    writeFileSync(join(first.dir, 'project.json'), JSON.stringify({ format: 'other' }))
    expectCode(() => openProject(first.dir, env), 'project_invalid')
  })

  it('project.json 是比較新的格式版本時拒絕開啟', () => {
    const first = newProject()
    first.close()
    const path = join(first.dir, 'project.json')
    const file = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    writeFileSync(path, JSON.stringify({ ...file, formatVersion: 99 }))
    expectCode(() => openProject(first.dir, env), 'project_too_new')
  })

  it('project.json 與資料庫不是同一個專案時拒絕開啟', () => {
    const a = newProject('a')
    const b = newProject('b')
    a.close()
    b.close()
    writeFileSync(join(a.dir, 'project.json'), readFileSync(join(b.dir, 'project.json')))
    expectCode(() => openProject(a.dir, env), 'project_invalid')
  })
})
