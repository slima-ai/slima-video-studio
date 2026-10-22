import { type AppError } from '@svs/schema'
import BetterSqlite3 from 'better-sqlite3'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { newProject, reopen } from './__tests__/helpers'
import { getSchemaVersion, runMigrations } from './migrate'
import { MIGRATIONS, type Migration } from './migrations.generated'

describe('runMigrations', () => {
  it('全新資料庫套用全部 migration，版本等於 migration 數量', () => {
    const sqlite = new BetterSqlite3(':memory:')
    const result = runMigrations(sqlite, MIGRATIONS)
    expect(result).toEqual({ from: 0, to: MIGRATIONS.length })
    expect(getSchemaVersion(sqlite)).toBe(MIGRATIONS.length)
    const tables = sqlite.prepare("select name from sqlite_master where type='table'").pluck().all()
    expect(tables).toEqual(
      expect.arrayContaining([
        'projects',
        'shots',
        'takes',
        'characters',
        'jobs',
        'cost_ledger',
        'assets',
      ]),
    )
  })

  it('已經是最新版時什麼都不做，也不會呼叫 beforeMigrate', () => {
    const sqlite = new BetterSqlite3(':memory:')
    runMigrations(sqlite, MIGRATIONS)
    let called = false
    const result = runMigrations(sqlite, MIGRATIONS, {
      beforeMigrate: () => {
        called = true
      },
    })
    expect(result.from).toBe(result.to)
    expect(called).toBe(false)
  })

  it('舊版資料庫能升到新版，原有資料保留', () => {
    const sqlite = new BetterSqlite3(':memory:')
    // 先只套用第一個 migration（模擬舊版 App 建立的資料庫）
    runMigrations(sqlite, MIGRATIONS.slice(0, 1))
    sqlite
      .prepare(
        "insert into projects (id, name, schema_version, aspect_ratio, budget, created_at, updated_at) values ('p', '舊專案', 1, '16:9', '{\"perRunLimitUsd\":5}', 'x', 'x')",
      )
      .run()
    expect(getSchemaVersion(sqlite)).toBe(1)

    const result = runMigrations(sqlite, MIGRATIONS)
    expect(result).toEqual({ from: 1, to: MIGRATIONS.length })
    expect(sqlite.prepare('select name from projects').pluck().get()).toBe('舊專案')
    // 新 migration 建立的表存在
    expect(
      sqlite.prepare("select count(*) from sqlite_master where name='jobs'").pluck().get(),
    ).toBe(1)
  })

  it('migration 失敗時整個 rollback，版本不變，並回報 project_invalid', () => {
    const sqlite = new BetterSqlite3(':memory:')
    const broken: Migration[] = [
      ...MIGRATIONS,
      { tag: '9999_broken', statements: ['CREATE TABLE ok_table (id text)', 'THIS IS NOT SQL'] },
    ]
    runMigrations(sqlite, MIGRATIONS)
    try {
      runMigrations(sqlite, broken)
      expect.unreachable()
    } catch (error) {
      expect((error as AppError).code).toBe('project_invalid')
    }
    expect(getSchemaVersion(sqlite)).toBe(MIGRATIONS.length)
    expect(
      sqlite.prepare("select count(*) from sqlite_master where name='ok_table'").pluck().get(),
    ).toBe(0)
  })

  it('資料庫比 App 新時拒絕（避免舊版 App 弄壞資料）', () => {
    const sqlite = new BetterSqlite3(':memory:')
    runMigrations(sqlite, MIGRATIONS)
    try {
      runMigrations(sqlite, MIGRATIONS.slice(0, 1))
      expect.unreachable()
    } catch (error) {
      expect((error as AppError).code).toBe('project_too_new')
    }
  })
})

describe('開啟專案時升級', () => {
  it('升級前先備份舊的 sqlite 檔，並更新 schemaVersion', () => {
    // 模擬舊版 App 留下的專案：資料夾照現在的方式建，資料庫換成只跑第一個 migration、
    // 直接用 SQL 寫的舊資料（舊版 schema 少了後來新增的欄位，現在的 repository 讀寫不了）
    const old = newProject('舊專案')
    old.close()
    const file = join(old.dir, 'project.sqlite')
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true })
    const legacy = new BetterSqlite3(file)
    runMigrations(legacy, MIGRATIONS.slice(0, 1))
    const stamp = new Date().toISOString()
    legacy
      .prepare(
        `insert into projects (id, name, schema_version, aspect_ratio, budget, created_at, updated_at)
         values (?, '舊專案', 1, '16:9', '{"perRunLimitUsd":5}', ?, ?)`,
      )
      .run(old.projectId, stamp, stamp)
    legacy
      .prepare(
        `insert into shots (id, project_id, number, position, size, angle, duration_sec, description, dialogue, characters, status)
         values ('s-old', ?, 1, 0, 'medium', 'eye_level', 3, '舊資料', '', '[]', 'draft')`,
      )
      .run(old.projectId)
    expect(getSchemaVersion(legacy)).toBe(1)
    legacy.close()

    const upgraded = reopen(old)
    expect(upgraded.migration.from).toBe(1)
    expect(upgraded.migration.to).toBe(MIGRATIONS.length)
    expect(upgraded.migration.backupPath).toBeDefined()
    expect(readdirSync(join(old.dir, 'backups')).some((f) => f.startsWith('project-v1-'))).toBe(
      true,
    )
    expect(upgraded.repos.projects.get().schemaVersion).toBe(MIGRATIONS.length)
    expect(upgraded.repos.shots.list().map((s) => s.description)).toEqual(['舊資料'])
    // 舊鏡頭沒有動作欄：升級後是空字串（影片 Prompt 照舊）
    expect(upgraded.repos.shots.list().map((s) => s.action)).toEqual([''])

    // 備份檔還是舊版 schema，且保有舊資料
    const backup = new BetterSqlite3(upgraded.migration.backupPath ?? '', { readonly: true })
    expect(getSchemaVersion(backup)).toBe(1)
    expect(backup.prepare('select description from shots').pluck().get()).toBe('舊資料')
    backup.close()
  })

  it('不需要升級時不產生備份', () => {
    const handle = newProject()
    handle.close()
    const again = reopen(handle)
    expect(again.migration.backupPath).toBeUndefined()
    expect(readdirSync(join(handle.dir, 'backups'))).toEqual([])
  })
})

describe('0008 畫布首頁：takes 改成依擁有者', () => {
  const index = MIGRATIONS.findIndex((m) => m.tag.startsWith('0008'))

  it('舊專案升級後版本資料完整：擁有者就是原本的鏡頭，內容雜湊為空，鏡頭預設放進成品', () => {
    const sqlite = new BetterSqlite3(':memory:')
    runMigrations(sqlite, MIGRATIONS.slice(0, index))
    sqlite
      .prepare(
        "insert into projects (id, name, schema_version, aspect_ratio, budget, created_at, updated_at) values ('p', '舊專案', 1, '16:9', '{}', 'x', 'x')",
      )
      .run()
    sqlite
      .prepare(
        `insert into shots (id, project_id, number, position, size, angle, duration_sec, description, dialogue, characters, status)
         values ('s1', 'p', 1, 0, 'medium', 'eye_level', 3, '甲', '', '[]', 'draft')`,
      )
      .run()
    const insertTake = sqlite.prepare(
      `insert into takes (id, shot_id, kind, version, asset_hash, adopted, model_id, created_at)
       values (?, 's1', ?, ?, 'h', ?, 'm', 'x')`,
    )
    insertTake.run('t1', 'video', 1, 0)
    insertTake.run('t2', 'video', 2, 1)
    insertTake.run('t3', 'first_frame', 1, 1)

    runMigrations(sqlite, MIGRATIONS)

    const rows = sqlite
      .prepare(
        'select id, shot_id, owner_type, owner_id, kind, version, adopted, input_hash from takes order by id',
      )
      .all()
    expect(rows).toEqual([
      {
        id: 't1',
        shot_id: 's1',
        owner_type: 'shot',
        owner_id: 's1',
        kind: 'video',
        version: 1,
        adopted: 0,
        input_hash: null,
      },
      {
        id: 't2',
        shot_id: 's1',
        owner_type: 'shot',
        owner_id: 's1',
        kind: 'video',
        version: 2,
        adopted: 1,
        input_hash: null,
      },
      {
        id: 't3',
        shot_id: 's1',
        owner_type: 'shot',
        owner_id: 's1',
        kind: 'first_frame',
        version: 1,
        adopted: 1,
        input_hash: null,
      },
    ])
    expect(sqlite.prepare('select in_cut from shots').pluck().get()).toBe(1)
    // 0010：舊專案沒有自己指定的模型，跟著 App 設定
    expect(sqlite.prepare('select models from projects').pluck().get()).toBe('{}')

    // 唯一鍵改成擁有者＋種類＋版本；鏡頭刪除時版本連帶刪除；shot_id 可以是空的（自由節點的版本）
    const insertOwned = sqlite.prepare(
      `insert into takes (id, shot_id, owner_type, owner_id, kind, version, asset_hash, model_id, created_at)
       values (?, 's1', 'shot', 's1', 'video', 2, 'h', 'm', 'x')`,
    )
    expect(() => insertOwned.run('t4')).toThrow(/UNIQUE/)
    sqlite
      .prepare(
        `insert into takes (id, shot_id, owner_type, owner_id, kind, version, asset_hash, model_id, created_at)
         values ('t5', null, 'node', 'n1', 'video', 1, 'h', 'm', 'x')`,
      )
      .run()
    sqlite.pragma('foreign_keys = ON')
    sqlite.prepare("delete from shots where id = 's1'").run()
    expect(sqlite.prepare('select id from takes').pluck().all()).toEqual(['t5'])
    // 畫布三張表都建好了
    for (const table of ['canvas_layout', 'canvas_nodes', 'canvas_edges']) {
      expect(
        sqlite.prepare('select count(*) from sqlite_master where name = ?').pluck().get(table),
      ).toBe(1)
    }
  })
})
