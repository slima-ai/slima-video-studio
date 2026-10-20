import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryVault } from '../keys/key-vault'
import { ProjectManager } from '../project-manager'
import { testSettingsDeps } from '../settings/test-deps'
import { registerAllHandlers } from './handlers'
import { createIpcRegistry } from './registry'

const dirs: string[] = []
const managers: ProjectManager[] = []
afterEach(() => {
  for (const m of managers.splice(0)) m.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function startView(options: { project: boolean; startOnHome?: boolean }) {
  const projects = new ProjectManager('test')
  managers.push(projects)
  if (options.project) {
    const root = mkdtempSync(join(tmpdir(), 'svs-startview-'))
    dirs.push(root)
    projects.create(join(root, '短片.svsproj'), '短片')
  }
  const registry = createIpcRegistry({ warn: vi.fn(), error: vi.fn() })
  registerAllHandlers(registry, {
    info: { name: 'n', version: '1', platform: 'linux', packaged: false },
    projects,
    keys: new MemoryVault(),
    ...testSettingsDeps(new MemoryVault()),
    ...(options.startOnHome === undefined ? {} : { startOnHome: options.startOnHome }),
  })
  return registry.dispatch({ channel: 'app.startView', payload: {} }, { emit: () => undefined })
}

describe('app.startView：開 App 先到哪一頁', () => {
  it('沒有專案可以接：首頁', async () => {
    expect(await startView({ project: false })).toEqual({ ok: true, data: { view: 'home' } })
  })

  it('已經有專案（接著上次的）：直接畫布', async () => {
    expect(await startView({ project: true })).toEqual({ ok: true, data: { view: 'canvas' } })
  })

  it('測試用的 startOnHome=false：沒有專案也直接畫布', async () => {
    expect(await startView({ project: false, startOnHome: false })).toEqual({
      ok: true,
      data: { view: 'canvas' },
    })
  })
})
