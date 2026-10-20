import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectManager } from './project-manager'
import { createRecentStore, RECENT_LIMIT, trackRecentProjects } from './recent-projects'

const dirs: string[] = []
const managers: ProjectManager[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'svs-recent-'))
  dirs.push(dir)
  return dir
}
const log = () => ({ warn: vi.fn() })

afterEach(() => {
  for (const m of managers.splice(0)) m.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('最近的專案（只存路徑與最後開啟時間）', () => {
  it('新開的在前；同一個再開一次不重複、移到最前；存下來，重開 App 還在', () => {
    const file = join(temp(), 'recent-projects.json')
    const store = createRecentStore(file, log())
    expect(store.list()).toEqual([])
    store.add('/a.svsproj', new Date('2026-10-20T01:00:00Z'))
    store.add('/b.svsproj', new Date('2026-10-20T02:00:00Z'))
    store.add('/a.svsproj', new Date('2026-10-20T03:00:00Z'))
    expect(store.list()).toEqual([
      { dir: '/a.svsproj', lastOpenedAt: '2026-10-20T03:00:00.000Z' },
      { dir: '/b.svsproj', lastOpenedAt: '2026-10-20T02:00:00.000Z' },
    ])
    expect(createRecentStore(file, log()).list()).toEqual(store.list())
    // 檔案裡只有路徑與時間，沒有別的
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')) as object)).toEqual(['projects'])
  })

  it('最多記 10 個，最舊的掉出去', () => {
    const store = createRecentStore(join(temp(), 'r.json'), log())
    for (let i = 0; i < RECENT_LIMIT + 3; i++) {
      store.add(`/p${String(i)}.svsproj`, new Date(2026, 9, 20, 1, i))
    }
    const list = store.list()
    expect(list).toHaveLength(RECENT_LIMIT)
    expect(list[0]?.dir).toBe(`/p${String(RECENT_LIMIT + 2)}.svsproj`)
    expect(list.some((entry) => entry.dir === '/p0.svsproj')).toBe(false)
  })

  it('移除：只從清單拿掉；沒這一筆就什麼都不做', () => {
    const file = join(temp(), 'r.json')
    const store = createRecentStore(file, log())
    store.add('/a.svsproj', new Date())
    store.add('/b.svsproj', new Date())
    store.forget('/a.svsproj')
    store.forget('/沒有.svsproj')
    expect(store.list().map((entry) => entry.dir)).toEqual(['/b.svsproj'])
    expect(
      createRecentStore(file, log())
        .list()
        .map((entry) => entry.dir),
    ).toEqual(['/b.svsproj'])
  })

  it('檔案壞掉或格式不對：當作空的，不丟錯；壞掉的那幾筆跳過', () => {
    const root = temp()
    const bad = join(root, 'bad.json')
    writeFileSync(bad, '{壞掉')
    expect(createRecentStore(bad, log()).list()).toEqual([])
    const partial = join(root, 'partial.json')
    writeFileSync(
      partial,
      JSON.stringify({
        projects: [{ dir: '/ok.svsproj', lastOpenedAt: 'x' }, { dir: 5 }, 'nope', { dir: '' }],
      }),
    )
    expect(createRecentStore(partial, log()).list()).toEqual([
      { dir: '/ok.svsproj', lastOpenedAt: 'x' },
    ])
  })

  it('寫不進去（資料夾不存在）：只記警告，不丟錯、清單照常在記憶體裡', () => {
    const warn = log()
    const store = createRecentStore(join(temp(), '沒有的資料夾', 'r.json'), warn)
    store.add('/a.svsproj', new Date())
    expect(store.list()).toHaveLength(1)
    expect(warn.warn).toHaveBeenCalled()
  })

  it('跟著專案開啟：啟動時已經開著的、之後開的、關掉不記', () => {
    const root = temp()
    const store = createRecentStore(join(root, 'r.json'), log())
    const projects = new ProjectManager('test')
    managers.push(projects)
    const first = projects.create(join(root, '甲.svsproj'), '甲')
    const stop = trackRecentProjects(store, projects, () => new Date('2026-10-20T01:00:00Z'))
    expect(store.list().map((entry) => entry.dir)).toEqual([first.dir])
    const second = projects.create(join(root, '乙.svsproj'), '乙')
    projects.close()
    expect(store.list().map((entry) => entry.dir)).toEqual([second.dir, first.dir])
    stop()
    projects.open(first.dir)
    expect(store.list().map((entry) => entry.dir)).toEqual([second.dir, first.dir])
  })
})
