import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ProjectManager } from '../project-manager'
import { createCharacterService } from './character-service'

const dirs: string[] = []
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'svs-char-'))
  dirs.push(root)
  const projects = new ProjectManager('test')
  const service = createCharacterService({ projects, projectsDir: join(root, 'projects') })
  return { projects, service, root }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('CharacterService', () => {
  it('還沒有專案時是空清單；新增第一個角色會自動建立專案', () => {
    const { projects, service } = setup()
    expect(service.list()).toEqual([])
    expect(projects.current()).toBeUndefined()

    const hero = service.create('阿鐵')
    expect(projects.current()).toBeDefined()
    expect(service.list()).toEqual([hero])
    projects.close()
  })

  it('修改欄位並在畫面用的格式回傳（服裝是單一欄位）', () => {
    const { projects, service } = setup()
    const hero = service.create('阿鐵')
    const edited = service.update(hero.id, {
      appearance: '短黑髮、琥珀色眼睛',
      personality: '嘴硬心軟',
      outfit: '深藍工作服',
      age: '28',
    })
    expect(edited).toMatchObject({
      name: '阿鐵',
      appearance: '短黑髮、琥珀色眼睛',
      personality: '嘴硬心軟',
      outfit: '深藍工作服',
      age: '28',
    })
    expect(service.update(hero.id, { age: null }).age).toBeUndefined()
    projects.close()
  })

  it('名字不能是空的；沒有專案時修改回報白話錯誤', () => {
    const { projects, service } = setup()
    expect(() => service.create('   ')).toThrow()
    expect(() => service.update('x', { name: '甲' })).toThrow('還沒有開啟專案')
    service.create('阿鐵')
    expect(() => service.update('x', { name: '' })).toThrow()
    projects.close()
  })

  it('刪除角色', () => {
    const { projects, service } = setup()
    const hero = service.create('阿鐵')
    service.remove(hero.id)
    expect(service.list()).toEqual([])
    projects.close()
  })

  it('版本清單：新的在前，標出目前使用中的那一版；還原舊版會開新草稿', () => {
    const { projects, service } = setup()
    const hero = service.create('阿鐵')
    expect(service.versions(hero.id)).toEqual([])

    service.setAnchor(hero.id, '短黑髮')
    service.lock(hero.id)
    service.setAnchor(hero.id, '長白髮')
    const [v2, v1] = service.versions(hero.id)
    expect(v1).toMatchObject({ version: 1, status: 'locked', anchorText: '短黑髮', current: false })
    expect(v2).toMatchObject({ version: 2, status: 'draft', anchorText: '長白髮', current: true })

    const restored = service.restoreVersion(hero.id, v1?.id ?? '')
    expect(restored).toMatchObject({ version: 2, anchorStatus: 'draft', anchorText: '短黑髮' })
    expect(service.versions(hero.id).map((v) => v.version)).toEqual([2, 1])
    projects.close()
  })
})
