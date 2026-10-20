import { AppError } from '@svs/schema'
import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

import { env, newProject, tempDir } from './__tests__/helpers'
import { copyProject } from './project-copy'
import { openProject } from './project-folder'

const PNG = Buffer.from('89504e470d0a1a0a-不是真的圖-但內容固定', 'utf8')

describe('copyProject（另存為）', () => {
  it('開著的專案、資料還在 WAL 裡：複本拿得到（不是複製 project.sqlite 主檔）；原本的不受影響', async () => {
    const source = newProject('原本的')
    source.repos.characters.create('阿鐵')
    source.repos.characters.create('小花')
    const root = tempDir()

    // 對照：只複製主檔會漏掉還在 WAL 裡的內容——這就是不能直接複製 .sqlite 的原因
    const naive = join(root, 'naive.sqlite')
    copyFileSync(join(source.dir, 'project.sqlite'), naive)
    expect(existsSync(join(source.dir, 'project.sqlite-wal'))).toBe(true)
    const naiveDb = new Database(naive, { readonly: true })
    let naiveCount = 0
    try {
      naiveCount = (naiveDb.prepare('select count(*) as n from characters').get() as { n: number })
        .n
    } catch {
      // 連資料表都還沒寫進主檔：一樣是漏掉了
    } finally {
      naiveDb.close()
    }
    expect(naiveCount).toBe(0)

    const dest = join(root, '複本.svsproj')
    await copyProject(source, dest, { name: '複本', env })

    const copy = openProject(dest, env)
    try {
      expect(copy.repos.characters.list().map((c) => c.name)).toEqual(['阿鐵', '小花'])
      expect(copy.repos.projects.get().name).toBe('複本')
      expect(JSON.parse(readFileSync(join(dest, 'project.json'), 'utf8'))).toMatchObject({
        name: '複本',
        projectId: source.projectId,
      })
    } finally {
      copy.close()
    }
    // 原本的名字、資料都沒動，而且還開著、還能寫
    expect(source.repos.projects.get().name).toBe('原本的')
    source.repos.characters.create('新來的')
    expect(source.repos.characters.list()).toHaveLength(3)
  })

  it('素材照內容雜湊的位置原樣複製；寫到一半的 .tmp 與鎖檔不帶；匯出的成品帶過去', async () => {
    const source = newProject('有素材')
    const put = await source.assets.put(PNG, 'image/png')
    writeFileSync(join(source.dir, 'assets', '.tmp', '半截'), 'x')
    mkdirSync(join(source.dir, 'exports'), { recursive: true })
    writeFileSync(join(source.dir, 'exports', '成品.mp4'), 'video')
    const root = tempDir()
    const dest = join(root, '複本.svsproj')
    await copyProject(source, dest, { name: '複本', env })

    const relativePath = relative(source.dir, put.path)
    expect(readFileSync(join(dest, relativePath))).toEqual(PNG)
    expect(readFileSync(join(dest, 'exports', '成品.mp4'), 'utf8')).toBe('video')
    expect(existsSync(join(dest, 'assets', '.tmp', '半截'))).toBe(false)
    expect(existsSync(join(dest, 'project.lock'))).toBe(false)

    const copy = openProject(dest, env)
    try {
      expect(copy.assets.has(put.hash)).toBe(true)
      expect(copy.assets.list().map((a) => a.hash)).toEqual([put.hash])
    } finally {
      copy.close()
    }
  })

  it('目標位置已經有東西：拒絕，而且不動那個資料夾', async () => {
    const source = newProject()
    const root = tempDir()
    const dest = join(root, '已存在.svsproj')
    mkdirSync(dest)
    writeFileSync(join(dest, '別人的檔案.txt'), '不能被刪')
    await expect(copyProject(source, dest, { name: 'x', env })).rejects.toMatchObject({
      code: 'project_exists',
    })
    expect(readFileSync(join(dest, '別人的檔案.txt'), 'utf8')).toBe('不能被刪')
    await expect(
      copyProject(source, join(root, '不是專案資料夾'), { name: 'x', env }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    })
  })

  it('複製到一半失敗：做到一半的資料夾整個刪掉，原本的專案不受影響', async () => {
    const source = newProject('原本的')
    const broken = {
      ...source,
      sqlite: { backup: () => Promise.reject(new Error('磁碟滿了')) },
    } as unknown as typeof source
    const dest = join(tempDir(), '複本.svsproj')
    const error = await copyProject(broken, dest, { name: 'x', env }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).userMessage).toContain('另存失敗')
    expect(existsSync(dest)).toBe(false)
    expect(source.repos.projects.get().name).toBe('原本的')
  })
})
