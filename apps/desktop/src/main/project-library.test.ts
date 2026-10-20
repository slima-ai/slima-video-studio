import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProjectLibrary } from './project-library'
import { ProjectManager } from './project-manager'

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
})
