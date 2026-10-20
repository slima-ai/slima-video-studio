import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProjectLibrary } from './project-library'
import { ProjectManager } from './project-manager'
import { createRecentStore } from './recent-projects'

const dirs: string[] = []
const managers: ProjectManager[] = []
afterEach(() => {
  for (const m of managers.splice(0)) m.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'svs-library-'))
  dirs.push(root)
  const projects = new ProjectManager('test')
  managers.push(projects)
  const reveal = vi.fn()
  let clock = Date.parse('2026-10-13T08:00:00Z')
  const library = createProjectLibrary({
    projects,
    projectsDir: join(root, 'projects'),
    reveal,
    now: () => new Date((clock += 1000)),
  })
  return { root, projects, library, reveal }
}

describe('專案清單', () => {
  it('資料夾還不存在：清單是空的', () => {
    const { library } = setup()
    expect(library.list().projects).toEqual([])
  })

  it('開新專案：放在專案資料夾、名字照給的；清單標出目前開著的，最近修改的在前；壞掉的資料夾跳過', () => {
    const { library, root } = setup()
    const first = library.createNew('貓的故事')
    const second = library.createNew()
    expect(first.name).toBe('貓的故事')
    expect(second.name).toBe('我的短片')
    mkdirSync(join(root, 'projects', '不是專案'))
    writeFileSync(join(root, 'projects', '不是專案', 'project.json'), '{壞掉')
    const { projects, folder } = library.list()
    expect(folder).toBe(join(root, 'projects'))
    expect(projects.map((p) => [p.name, p.current])).toEqual([
      ['我的短片', true],
      ['貓的故事', false],
    ])
  })

  it('目前開著的專案放在別處：也列出來', () => {
    const { library, projects, root } = setup()
    projects.create(join(root, 'elsewhere.svsproj'), '別處的')
    expect(library.list().projects).toEqual([
      expect.objectContaining({ name: '別處的', current: true }),
    ])
  })

  it('指定存放位置：專案建在那個資料夾，名字照給的；位置不存在或不是絕對路徑就拒絕、不建任何東西', () => {
    const { library, projects, root } = setup()
    const elsewhere = join(root, '別處')
    mkdirSync(elsewhere)
    const info = library.createNew('貓的故事', elsewhere)
    expect(info.name).toBe('貓的故事')
    expect(info.dir.startsWith(`${elsewhere}/`)).toBe(true)
    expect(projects.info()?.dir).toBe(info.dir)

    for (const bad of [join(root, '沒有這個資料夾'), '相對/路徑']) {
      expect(() => library.createNew('壞的', bad)).toThrow('找不到這個資料夾')
    }
    // 失敗不會把目前開著的專案關掉
    expect(projects.info()?.dir).toBe(info.dir)
  })

  it('選資料夾：把視窗選到的路徑交出去；沒給視窗或取消就是 undefined', async () => {
    const root = mkdtempSync(join(tmpdir(), 'svs-library-pick-'))
    dirs.push(root)
    const projects = new ProjectManager('test')
    managers.push(projects)
    const make = (pick?: () => Promise<string | undefined>) =>
      createProjectLibrary({
        projects,
        projectsDir: join(root, 'projects'),
        reveal: vi.fn(),
        ...(pick ? { pickFolder: pick } : {}),
      })
    expect(await make(() => Promise.resolve('/某處')).pickFolder()).toBe('/某處')
    expect(await make(() => Promise.resolve(undefined)).pickFolder()).toBeUndefined()
    expect(await make().pickFolder()).toBeUndefined()
  })

  it('在檔案總管顯示：只接受清單裡的專案；沒給就是目前的', () => {
    const { library, reveal } = setup()
    const info = library.createNew('甲')
    library.reveal()
    expect(reveal).toHaveBeenLastCalledWith(info.dir)
    expect(() => {
      library.reveal('/etc')
    }).toThrow('找不到這個專案')
  })

  describe('另存為', () => {
    it('放在預設資料夾或指定的位置：複本開著、原本留著；名字空白、位置不存在就拒絕，原本的專案照開', async () => {
      const { library, projects, root } = setup()
      const original = library.createNew('原本')
      projects.current()?.repos.characters.create('阿鐵')
      const saved = await library.saveAs('  副本  ')
      expect(saved.name).toBe('副本')
      expect(saved.dir.startsWith(join(root, 'projects'))).toBe(true)
      expect(projects.info()?.dir).toBe(saved.dir)
      expect(projects.current()?.repos.characters.list()).toHaveLength(1)

      const elsewhere = join(root, '別處')
      mkdirSync(elsewhere)
      const away = await library.saveAs('別處的副本', elsewhere)
      expect(away.dir.startsWith(`${elsewhere}/`)).toBe(true)

      await expect(library.saveAs('   ')).rejects.toThrow('請給這一份一個名字')
      await expect(library.saveAs('x', join(root, '沒有這個資料夾'))).rejects.toThrow(
        '找不到這個資料夾',
      )
      expect(projects.info()?.dir).toBe(away.dir)
      expect(library.list().projects.map((p) => p.dir)).toEqual(
        expect.arrayContaining([original.dir, saved.dir, away.dir]),
      )
    })
  })

  describe('最近的專案', () => {
    const withRecent = (picked?: string) => {
      const root = mkdtempSync(join(tmpdir(), 'svs-library-recent-'))
      dirs.push(root)
      const projects = new ProjectManager('test')
      managers.push(projects)
      let clock = Date.parse('2026-10-13T08:00:00Z')
      const recent = createRecentStore(join(root, 'recent.json'), { warn: vi.fn() })
      const library = createProjectLibrary({
        projects,
        projectsDir: join(root, 'projects'),
        reveal: vi.fn(),
        pickFolder: () => Promise.resolve(picked),
        recent,
        now: () => new Date((clock += 1000)),
      })
      return { root, projects, library, recent }
    }

    it('記住的（含放在別處的）加上專案資料夾裡的；最近開的在前；現在開著的標出來', () => {
      const { library, projects, root, recent } = withRecent()
      const inFolder = library.createNew('資料夾裡的')
      const elsewhere = join(root, '別處')
      mkdirSync(elsewhere)
      const away = library.createNew('別處的', elsewhere)
      recent.add(away.dir, new Date('2099-01-01T00:00:00Z'))
      const rows = library.recent()
      expect(rows.map((r) => [r.name, r.current, r.missing])).toEqual([
        ['別處的', true, false],
        ['資料夾裡的', false, false],
      ])
      expect(rows[0]?.lastOpenedAt).toBe('2099-01-01T00:00:00.000Z')
      expect(rows[1]?.lastOpenedAt).toBeNull()
      expect(projects.info()?.dir).toBe(away.dir)
      expect(inFolder.name).toBe('資料夾裡的')
    })

    it('路徑不在了：標「找不到」、名字用資料夾名；不能打開；可以從清單移除；不影響其他', () => {
      const { library, projects, root, recent } = withRecent()
      const keep = library.createNew('還在的')
      const gone = join(root, '搬走了.svsproj')
      recent.add(gone, new Date('2099-01-01T00:00:00Z'))
      const missing = library.recent().find((r) => r.dir === gone)
      expect(missing).toMatchObject({ name: '搬走了', missing: true, updatedAt: null })
      expect(() => library.openRecent(gone)).toThrow('找不到了')
      expect(projects.info()?.dir).toBe(keep.dir)
      library.forgetRecent(gone)
      expect(library.recent().map((r) => r.dir)).toEqual([keep.dir])
    })

    it('打開最近的專案：只接受清單裡的路徑', () => {
      const { library, projects, root } = withRecent()
      const a = library.createNew('甲')
      library.createNew('乙')
      expect(library.openRecent(a.dir).name).toBe('甲')
      expect(projects.info()?.name).toBe('甲')
      expect(() => library.openRecent(join(root, '清單外'))).toThrow('找不到這個專案')
      expect(() => library.openRecent('/etc')).toThrow('找不到這個專案')
    })

    it('開啟舊專案：選到專案資料夾就打開；取消回 null；選到不是專案的資料夾說明原因', async () => {
      const first = withRecent()
      const made = first.library.createNew('舊的')
      first.projects.close()
      const choose = (dir: string | undefined) => {
        const root = mkdtempSync(join(tmpdir(), 'svs-library-pick2-'))
        dirs.push(root)
        const projects = new ProjectManager('test')
        managers.push(projects)
        return {
          projects,
          library: createProjectLibrary({
            projects,
            projectsDir: join(root, 'projects'),
            reveal: vi.fn(),
            pickFolder: () => Promise.resolve(dir),
          }),
        }
      }
      const ok = choose(made.dir)
      expect((await ok.library.pickAndOpen())?.name).toBe('舊的')
      expect(ok.projects.info()?.dir).toBe(made.dir)
      expect(await choose(undefined).library.pickAndOpen()).toBeNull()
      const notProject = mkdtempSync(join(tmpdir(), 'svs-library-notproj-'))
      dirs.push(notProject)
      await expect(choose(notProject).library.pickAndOpen()).rejects.toThrow(
        '不是 Slima Video Studio 的專案',
      )
    })
  })
})
