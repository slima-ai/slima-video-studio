import { ipcContract, type IpcChannel } from '@svs/schema'
import { describe, expect, it, vi } from 'vitest'

import { registerAllHandlers } from '../ipc/handlers'
import { createIpcRegistry } from '../ipc/registry'
import { ProjectManager } from '../project-manager'
import { testSettingsDeps } from '../settings/test-deps'
import { MemoryVault } from './key-vault'

const SECRET = 'sk-live-TOPSECRET-9f8e7d6c'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

/** 每個 channel 一組合法的呼叫參數。新增 channel 時這裡一定要補，否則下面的測試會失敗。 */
const SAMPLE_PAYLOADS: Record<IpcChannel, unknown[]> = {
  'app.ping': [{ message: 'hi' }],
  'app.locale': [{}],
  'app.getInfo': [{}],
  'project.create': [{ dir: '/nonexistent/dir/x.svsproj', name: 'x' }],
  'project.open': [{ dir: '/nonexistent/dir/y.svsproj' }],
  'project.current': [{}],
  'project.configure': [{}, { styleId: 'anime' }],
  'project.close': [{}],
  'project.list': [{}],
  'dev.seedDemo': [{ shots: 1 }],
  'project.createNew': [{}],
  'project.reveal': [{}],
  'project.createAt': [{ name: 'x', parentDir: '/nonexistent/dir' }],
  'project.pickFolder': [{}],
  'project.saveAs': [{ name: 'x', parentDir: '/nonexistent/dir' }],
  'project.recent': [{}],
  'project.openRecent': [{ dir: '/nonexistent/dir/z.svsproj' }],
  'project.forgetRecent': [{ dir: '/nonexistent/dir/z.svsproj' }],
  'project.pickAndOpen': [{}],
  'app.startView': [{}],
  'project.status': [{}],
  'project.rename': [{ name: '新名字' }],
  'keys.list': [{}],
  'keys.set': [
    { provider: 'fal', key: SECRET },
    { provider: 'openrouter', key: 'bad key with spaces TOPSECRET' },
  ],
  'keys.delete': [{ provider: 'ghost' }],
  'keys.test': [{ provider: 'fal' }, { provider: 'ghost' }],
  'slima.status': [{}],
  'slima.connect': [{ token: SECRET }],
  'slima.disconnect': [{}],
  'slima.books': [{}],
  'graph.shot': [{ shotId: 'nope' }],
  'canvas.get': [{}],
  'canvas.move': [{ moves: [{ key: 'shot:nope', x: 1, y: 2 }] }],
  'canvas.add': [{ kind: 'shot', sceneKey: 'scene:nope' }],
  'canvas.link': [
    {
      source: { key: 'character:nope', port: 'char-out' },
      target: { key: 'shot:nope', port: 'shot-ref-char' },
    },
  ],
  'canvas.relink': [
    {
      from: {
        source: { key: 'character:nope', port: 'char-out' },
        target: { key: 'shot:nope', port: 'shot-ref-char' },
      },
      to: {
        source: { key: 'character:nope', port: 'char-out' },
        target: { key: 'shot:nope2', port: 'shot-ref-char' },
      },
    },
  ],
  'canvas.unlink': [
    {
      source: { key: 'character:nope', port: 'char-out' },
      target: { key: 'shot:nope', port: 'shot-ref-char' },
    },
  ],
  'canvas.remove': [{ keys: ['shot:nope'] }],
  'canvas.paste': [{ keys: ['shot:nope'] }],
  'canvas.updateOneliner': [{ key: 'node:nope', patch: { story: 'x' } }],
  'canvas.runPlan': [{ keys: [] }],
  'canvas.runChoices': [{}],
  'canvas.run': [{ keys: [] }],
  'canvas.viewport': [{ x: 0, y: 0, zoom: 1 }],
  'canvas.tidy': [{}],
  'canvas.rename': [{ key: 'scene:nope', title: 'x' }],
  'canvas.updateFree': [{ key: 'node:nope', patch: { text: 'x' } }],
  'canvas.importFiles': [{}],
  'canvas.importBytes': [{ name: 'a.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
  'records.list': [{}],
  'files.list': [{}],
  'files.reveal': [{ exportName: 'nope.mp4' }],
  'records.redo': [{ jobId: 'nope' }],
  'slima.tree': [{ bookToken: 'bk_1' }],
  'slima.importCheck': [{ bookToken: 'bk_1', items: [{ path: 'a.md', use: 'story' }] }],
  'slima.import': [{ bookToken: 'bk_1', items: [{ path: 'a.md', use: 'story' }] }],
  'settings.get': [{}],
  'settings.update': [{ demoMode: true }, { models: { llm: 'no/such-model' } }],
  'mcp.status': [{}],
  'mcp.regenerateToken': [{}],
  'mcp.resetCommitted': [{}],
  'mcp.connectInfo': [{}],
  'mcp.connectClaudeDesktop': [{}],
  'mcp.connectClaudeCode': [{}],
  'models.list': [{}],
  'models.notices': [{}],
  'models.setProject': [{ models: { t2i: 'no/such-model' } }, { models: { t2i: null } }],
  'queue.list': [{}],
  'queue.cancel': [{ jobId: 'nope' }],
  'queue.retry': [{ jobId: 'nope' }],
  'quickstart.check': [{ story: '一隻貓', style: 'anime', shotCount: 3, durationSec: 5 }],
  'quickstart.run': [{ story: '一隻貓', style: 'anime', shotCount: 3, durationSec: 5 }],
  'quickstart.cancel': [{}],
  'quickstart.state': [{}],
  'quickstart.export': [{}],
  'quickstart.upgradeCheck': [{}],
  'quickstart.upgrade': [{}],
  'shots.list': [{}],
  'shots.update': [{ shotId: 's1', patch: { description: '新的描述' } }],
  'shots.references': [{ shotId: 's1' }],
  'shots.setReferences': [{ shotId: 's1', assetHashes: ['a'.repeat(64)] }],
  'shots.endFrameCheck': [{ shotId: 's1' }],
  'shots.generateEndFrame': [{ shotId: 's1' }],
  'shots.setEndFrame': [
    { shotId: 's1', assetHash: 'a'.repeat(64) },
    { shotId: 's1', assetHash: null },
  ],
  'shots.regenerate': [{ shotId: 's1', mode: 'video' }],
  'shots.cancel': [{ shotId: 's1' }],
  'shots.adopt': [{ takeId: 't1' }],
  'shots.rejoin': [{}],
  'characters.list': [{}],
  'characters.create': [{ name: '阿鐵' }],
  'characters.update': [{ characterId: 'c1', patch: { appearance: '短黑髮' } }],
  'characters.delete': [{ characterId: 'c1' }],
  'characters.suggestAnchor': [{ characterId: 'c1' }],
  'characters.setAnchor': [{ characterId: 'c1', text: '短黑髮' }],
  'characters.lock': [{ characterId: 'c1' }],
  'shots.create': [{}],
  'shots.delete': [{ shotIds: ['s1'] }],
  'shots.reorder': [{ orderedIds: ['s1'] }],
  'shots.assignScene': [{ shotIds: ['s1'] }],
  'shots.batchCheck': [{ shotIds: ['s1'], skipGenerated: true }],
  'shots.generateBatch': [{ shotIds: ['s1'], skipGenerated: true }],
  'storyboard.splitCheck': [{ sceneId: 'sc1' }],
  'storyboard.splitScene': [{ sceneId: 'sc1' }],
  'locations.list': [{}],
  'locations.setAnchor': [{ locationId: 'l1', text: '磚牆倉庫' }],
  'locations.images': [{ locationId: 'l1' }],
  'locations.check': [{ locationId: 'l1', kind: 'concepts' }],
  'locations.generate': [{ locationId: 'l1', kind: 'angles' }],
  'locations.cancel': [{ locationId: 'l1' }],
  'locations.pickMain': [{ locationId: 'l1', conceptId: 'c1' }],
  'locations.lock': [{ locationId: 'l1' }],
  'locations.unlock': [{ locationId: 'l1' }],
  'locations.references': [{ locationId: 'l1' }],
  'locations.addReference': [{ locationId: 'l1', assetHash: 'a'.repeat(64), purpose: 'top_down' }],
  'locations.removeReference': [{ locationId: 'l1', referenceId: 'r1' }],
  'chat.status': [{}],
  'chat.list': [{}],
  'chat.create': [{}],
  'chat.rename': [{ conversationId: '11111111-1111-4111-8111-111111111111', title: 't' }],
  'chat.messages': [{ conversationId: '11111111-1111-4111-8111-111111111111' }],
  'chat.send': [{ conversationId: '11111111-1111-4111-8111-111111111111', text: 'hi' }],
  'chat.stop': [{ conversationId: '11111111-1111-4111-8111-111111111111' }],
  'history.state': [{}],
  'history.undo': [{}],
  'history.redo': [{}],
  'sound.get': [{}],
  'sound.plan': [{ narration: {} }],
  'sound.generateNarration': [{ shotId: 'nope' }],
  'sound.generateMusic': [{}],
  'sound.updateClip': [{ clipId: 'nope', patch: { gainDb: -3 } }],
  'sound.adoptClip': [{ clipId: 'nope' }],
  'sound.removeClip': [{ clipId: 'nope' }],
  'sound.remove': [{ kind: 'music' }],
  'sound.mix': [{}],
  'sound.analyze': [{}],
  'sound.updateSettings': [{ duck: false }],
  'outline.get': [{}],
  'outline.edit': [{ op: 'addAct' }],
  'outline.splitCheck': [{ text: '故事' }],
  'outline.split': [{ text: '故事' }],
  'characters.versions': [{ characterId: 'c1' }],
  'characters.restoreVersion': [{ characterId: 'c1', versionId: 'p1' }],
  'characters.concepts': [{ characterId: 'c1' }],
  'characters.conceptCheck': [{ characterId: 'c1' }],
  'characters.references': [{ characterId: 'c1' }],
  'characters.addReference': [{ characterId: 'c1', assetHash: 'a'.repeat(64), purpose: 'face' }],
  'characters.removeReference': [{ characterId: 'c1', referenceId: 'r1' }],
  'characters.generateConcepts': [{ characterId: 'c1' }],
  'characters.cancelConcepts': [{ characterId: 'c1' }],
  'characters.pickHero': [{ characterId: 'c1', conceptId: 'k1' }],
  'characters.turnarounds': [{ characterId: 'c1' }],
  'characters.turnaroundCheck': [{ characterId: 'c1' }],
  'characters.generateTurnarounds': [{ characterId: 'c1' }],
  'characters.cancelTurnarounds': [{ characterId: 'c1' }],
  'characters.reslice': [{ characterId: 'c1', turnaroundId: 't1', cuts: { a: 0.3, b: 0.6 } }],
  'characters.adoptTurnaround': [{ characterId: 'c1', turnaroundId: 't1' }],
}

describe('renderer 透過任何 IPC 都拿不到明文 Key', () => {
  it('合約裡的每個 channel 都有測試參數', () => {
    expect(Object.keys(SAMPLE_PAYLOADS).sort()).toEqual(Object.keys(ipcContract).sort())
  })

  it('逐一呼叫所有 channel（含錯誤路徑），回傳值與事件都不含明文', async () => {
    const keys = new MemoryVault()
    keys.set('fal', SECRET)
    const registry = createIpcRegistry(log)
    registerAllHandlers(registry, {
      info: { name: 'n', version: '1', platform: 'linux', packaged: false },
      projects: new ProjectManager('test'),
      keys,
      ...testSettingsDeps(keys),
    })

    const seen: string[] = []
    const ctx = {
      emit: (name: string, payload: unknown) => seen.push(JSON.stringify({ name, payload })),
    }
    for (const channel of Object.keys(ipcContract) as IpcChannel[]) {
      for (const payload of SAMPLE_PAYLOADS[channel]) {
        const result = await registry.dispatch({ channel, payload }, ctx as never)
        seen.push(JSON.stringify(result))
      }
    }
    // 儲存的 Key 與剛剛 keys.set 傳進來的字串，都不能出現在任何回傳裡
    const all = seen.join('\n')
    expect(all).not.toContain('TOPSECRET')
    expect(all).not.toContain(SECRET)
    expect(all).toContain('7d6c') // 末四碼可以出現
    // log 也不能有
    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls])
    expect(logged).not.toContain('TOPSECRET')
  })

  it('keys.list 列出已知供應商，已設定的只有狀態', async () => {
    const keys = new MemoryVault()
    keys.set('fal', SECRET)
    keys.set('custom-provider', 'abcdefgh12345678')
    const registry = createIpcRegistry(log)
    registerAllHandlers(registry, {
      info: { name: 'n', version: '1', platform: 'linux', packaged: false },
      projects: new ProjectManager('test'),
      keys,
      ...testSettingsDeps(keys),
    })
    const result = await registry.dispatch({ channel: 'keys.list', payload: {} }, { emit: vi.fn() })
    expect(result).toEqual({
      ok: true,
      data: {
        keys: [
          { provider: 'fal', configured: true, last4: '7d6c' },
          { provider: 'openrouter', configured: false },
          { provider: 'custom-provider', configured: true, last4: '5678' },
        ],
        storage: { available: true, kind: 'memory' },
      },
    })
  })
})
