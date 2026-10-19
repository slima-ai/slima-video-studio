import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { restoreLastProject } from './last-project'
import { ProjectManager } from './project-manager'

const dirs: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'svs-last-'))
  dirs.push(dir)
  return dir
}
const log = () => ({ info: vi.fn(), warn: vi.fn() })

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('restoreLastProject', () => {
  it('第一次啟動沒有記錄：什麼都不開；之後開啟的專案會被記住，下次啟動接著用', () => {
    const root = temp()
    const file = join(root, 'last-project.json')
    const first = new ProjectManager('test')
    restoreLastProject(file, first, log())
    expect(first.current()).toBeUndefined()

    const created = first.create(join(root, '短片.svsproj'), '短片')
    first.current()?.repos.characters.create('阿鐵')
    first.close() // 結束 App 時的關閉不會清掉記錄

    const second = new ProjectManager('test')
    restoreLastProject(file, second, log())
    expect(second.info()?.id).toBe(created.id)
    expect(
      second
        .current()
        ?.repos.characters.list()
        .map((c) => c.name),
    ).toEqual(['阿鐵'])
    second.close()
  })

  it('上次的專案不見了或記錄壞掉：只留一行警告或直接略過，不丟錯誤', () => {
    const root = temp()
    const file = join(root, 'last-project.json')
    writeFileSync(file, JSON.stringify({ dir: join(root, '不存在.svsproj') }))
    const missing = new ProjectManager('test')
    restoreLastProject(file, missing, log())
    expect(missing.current()).toBeUndefined()

    writeFileSync(file, '{壞掉')
    const broken = new ProjectManager('test')
    restoreLastProject(file, broken, log())
    expect(broken.current()).toBeUndefined()
  })

  it('專案開不起來（例如被別的視窗開著）：記警告、照常啟動', () => {
    const root = temp()
    const file = join(root, 'last-project.json')
    const holder = new ProjectManager('test')
    holder.create(join(root, '短片.svsproj'), '短片')
    writeFileSync(file, JSON.stringify({ dir: join(root, '短片.svsproj') }))

    const other = new ProjectManager('test')
    const messages = log()
    restoreLastProject(file, other, messages)
    expect(other.current()).toBeUndefined()
    expect(messages.warn).toHaveBeenCalled()
    holder.close()
  })
})
