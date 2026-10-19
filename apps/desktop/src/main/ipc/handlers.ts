import type { ProjectLibrary } from '../project-library'
import { AppError, KEY_PROVIDERS, QUICK_STYLE_IDS, type McpStatus } from '@svs/schema'

import type { HistoryService } from '../history/history-service'
import { addLabel, outlineLabel, shotEditLabel } from '../history/history-service'
import type { TurnaroundService } from '../characters/turnaround-service'
import type { LocationService } from '../locations/location-service'
import type { OutlineService } from '../outline/outline-service'
import type { StoryboardService } from '../storyboard/storyboard-service'
import type { ConceptService } from '../characters/concept-service'
import type { SoundService } from '../sound/sound-service'
import type { CharacterService } from '../characters/character-service'
import type { KeyVault } from '../keys/key-vault'
import type { McpConnector } from '../mcp/connect'
import type { McpController } from '../mcp/controller'
import type { KeyTester } from '../keys/key-tester'
import type { ProjectManager } from '../project-manager'
import type { QuickStartService } from '../quickstart/quickstart-service'
import type { UpgradeService } from '../quickstart/upgrade-service'
import type { CanvasService } from '../canvas/canvas-service'
import type { GraphService } from '../graph/graph-service'
import type { FilesService } from '../files/files-service'
import type { RecordsService } from '../records/records-service'
import type { SlimaImportService } from '../slima/import-service'
import type { SlimaService } from '../slima/slima-service'
import type { ShotService } from '../shots/shot-service'
import type { QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import type { SettingsStore } from '../settings/settings-store'
import type { DemoSeeder } from '../perf/demo-seed'
import { withChangeEvents } from './change-events'
import type { IpcRegistry } from './registry'

export interface AppInfo {
  name: string
  version: string
  platform: string
  packaged: boolean
}

export interface HandlerDeps {
  info: AppInfo
  projects: ProjectManager
  keys: KeyVault
  keyTester: KeyTester
  settings: SettingsStore
  settingsService: SettingsService
  /** AI 工具連線（MCP）；測試可以不給（狀態會是「沒開」）。 */
  mcp?: McpController
  /** 一鍵連接 Claude Desktop／Claude Code；測試可以不給。 */
  mcpConnector?: McpConnector
  runtime: QueueAccess
  quickstart: QuickStartService
  upgrade: UpgradeService
  slima: SlimaService
  slimaImport: SlimaImportService
  graph: GraphService
  canvas: CanvasService
  records: RecordsService
  files: FilesService
  shots: ShotService
  characters: CharacterService
  concepts: ConceptService
  /** 聲音服務；測試可以不給（呼叫時回報服務還沒準備好）。 */
  sound?: SoundService
  turnarounds: TurnaroundService
  outline: OutlineService
  storyboard: StoryboardService
  locations: LocationService
  history: HistoryService
  library: ProjectLibrary
  /** 效能自測的示範專案；沒給（例如單元測試）就說明這裡不能用。 */
  demo?: DemoSeeder
  now?: () => number
}

/** 註冊所有 channel 的實作。新增 channel 時，合約與這裡都要補，否則啟動時會報錯。 */
export function registerAllHandlers(raw: IpcRegistry, deps: HandlerDeps): void {
  // 會動到角色、地點、大綱的 channel 做完後發變更事件（畫布與表單頁同步）
  const registry = withChangeEvents(raw)
  const {
    info,
    projects,
    keys,
    keyTester,
    settings,
    settingsService,
    mcp,
    mcpConnector,
    runtime,
    quickstart,
    upgrade,
    slima,
    slimaImport,
    graph,
    canvas,
    records,
    files,
    shots,
    characters,
    concepts,
    sound,
    turnarounds,
    outline,
    storyboard,
    locations,
    history,
    library,
  } = deps
  const now = deps.now ?? Date.now

  registry.registerHandler('app.ping', ({ message }, ctx) => {
    const receivedAt = now()
    ctx.emit('app.pinged', { message, receivedAt })
    return { pong: message, receivedAt }
  })

  registry.registerHandler('app.getInfo', () => info)

  registry.registerHandler('project.create', ({ dir, name }) => projects.create(dir, name))
  registry.registerHandler('project.open', ({ dir }) => projects.open(dir))
  registry.registerHandler('project.current', () => projects.info())
  registry.registerHandler('project.configure', ({ styleId, aspectRatio }) => {
    const handle = projects.current()
    if (!handle || handle.closed) {
      throw new AppError({
        code: 'project_not_found',
        userMessage: '請先開啟或建立一個專案。',
      })
    }
    const repo = handle.repos.projects
    const project =
      styleId === undefined && aspectRatio === undefined
        ? repo.get()
        : repo.update({
            ...(styleId === undefined ? {} : { defaultStyleId: styleId }),
            ...(aspectRatio === undefined ? {} : { aspectRatio }),
          })
    return {
      styleId: QUICK_STYLE_IDS.find((id) => id === project.defaultStyleId) ?? 'realistic',
      aspectRatio: project.aspectRatio,
    }
  })
  registry.registerHandler('project.close', () => {
    projects.close()
    return {}
  })
  registry.registerHandler('project.list', () => library.list())
  registry.registerHandler('project.createNew', ({ name }) => library.createNew(name))
  registry.registerHandler('dev.seedDemo', ({ shots: count }) => {
    if (!deps.demo) {
      throw new AppError({ code: 'invalid_request', userMessage: '這裡不能產生示範專案。' })
    }
    return deps.demo.seed(count)
  })
  registry.registerHandler('project.reveal', ({ dir }) => {
    library.reveal(dir)
    return {}
  })

  // 只回傳狀態（有沒有設定、末四碼）；明文只留在主行程
  registry.registerHandler('keys.list', () => {
    const ids = [...new Set([...KEY_PROVIDERS.map((p) => p.id), ...keys.providers()])]
    return { keys: ids.map((id) => keys.status(id)), storage: keys.storage() }
  })
  registry.registerHandler('keys.set', ({ provider, key }) => keys.set(provider, key))
  registry.registerHandler('keys.delete', ({ provider }) => keys.delete(provider))
  registry.registerHandler('keys.test', ({ provider }) =>
    keyTester(provider, AbortSignal.timeout(45_000)),
  )

  registry.registerHandler('slima.status', () => slima.status())
  registry.registerHandler('slima.connect', ({ token }) => slima.connect(token))
  registry.registerHandler('slima.disconnect', () => slima.disconnect())
  registry.registerHandler('slima.books', () => slima.books())
  registry.registerHandler('graph.shot', ({ shotId }) => graph.shot(shotId))
  registry.registerHandler('canvas.get', (request) => canvas.get(request))
  registry.registerHandler('canvas.move', (request) => {
    history.record(request.reparent ? '把鏡頭移到另一場' : '移動位置', () => {
      canvas.move(request)
    })
    return {}
  })
  // 角色也在歷史涵蓋的資料表裡：新增、刪除角色都能復原
  registry.registerHandler('canvas.add', (request) =>
    history.record(addLabel(request.kind), () => canvas.add(request)),
  )
  registry.registerHandler('canvas.tidy', () => history.record('整理', () => canvas.tidy()))
  registry.registerHandler('canvas.link', (request) => {
    history.record('接上線', () => {
      canvas.link(request)
    })
    return {}
  })
  registry.registerHandler('canvas.unlink', (request) => {
    history.record('剪掉線', () => {
      canvas.unlink(request)
    })
    return {}
  })
  registry.registerHandler('canvas.remove', (request) =>
    history.record('刪除', () => canvas.remove(request)),
  )
  registry.registerHandler('canvas.paste', (request) =>
    history.record('貼上', () => canvas.paste(request)),
  )
  registry.registerHandler('canvas.rename', ({ key, title }) => {
    const [kind, id = ''] = key.split(':')
    history.record('改名', () => {
      if (kind === 'scene') outline.edit({ op: 'updateScene', sceneId: id, patch: { title } })
      else if (kind === 'location')
        outline.edit({ op: 'updateLocation', locationId: id, patch: { name: title } })
      else if (kind === 'character') characters.update(id, { name: title })
      else if (kind === 'node') canvas.updateFree({ key, patch: { title } })
      else
        throw new AppError({
          code: 'invalid_request',
          userMessage: '這一格不能改名：場、角色、地點、群組才能改名。',
        })
    })
    return {}
  })
  // 上傳與拖進來的檔案：存檔是非同步的，整批算一步復原
  registry.registerHandler('canvas.importFiles', async (request) => {
    const finish = history.begin('放上圖片或影片')
    try {
      return await canvas.importFiles(request)
    } finally {
      finish()
    }
  })
  registry.registerHandler('canvas.importBytes', async (request) => {
    const finish = history.begin('放上圖片或影片')
    try {
      return await canvas.importBytes(request)
    } finally {
      finish()
    }
  })
  registry.registerHandler('canvas.updateFree', (request) => {
    const { patch } = request
    const label =
      patch.text !== undefined
        ? '修改便條'
        : patch.color !== undefined
          ? '換群組顏色'
          : patch.title !== undefined
            ? '改名'
            : '調整群組大小'
    history.record(label, () => {
      canvas.updateFree(request)
    })
    return {}
  })
  registry.registerHandler('canvas.updateOneliner', (request) => {
    history.record('修改一句話', () => {
      canvas.updateOneliner(request)
    })
    return {}
  })
  registry.registerHandler('canvas.runPlan', (request) => canvas.runPlan(request))
  registry.registerHandler('canvas.run', (request) => canvas.run(request))
  registry.registerHandler('canvas.viewport', (view) => {
    canvas.viewport(view)
    return {}
  })
  registry.registerHandler('records.list', (filter) => records.list(filter))
  registry.registerHandler('records.redo', (request) => records.redo(request))
  registry.registerHandler('files.list', (filter) => files.list(filter))
  registry.registerHandler('files.reveal', (request) => {
    files.reveal(request)
    return {}
  })
  registry.registerHandler('slima.tree', ({ bookToken }) => slimaImport.tree(bookToken))
  registry.registerHandler('slima.importCheck', (request) => slimaImport.check(request))
  registry.registerHandler('slima.import', async (request) => {
    try {
      return await slimaImport.import(request)
    } finally {
      // 匯入會一次建立或換掉大綱、角色、場景，舊的復原紀錄對不上了
      history.clear()
    }
  })

  registry.registerHandler('settings.get', () => settings.get())
  registry.registerHandler('settings.update', async (patch) => {
    const next = settingsService.update(patch)
    // 改了「AI 工具連線」的開關或埠，伺服器要跟著啟動／停止／換埠
    await mcp?.sync()
    return next
  })
  const mcpOff = (): McpStatus => {
    const { port, allowanceUsd } = settings.get().mcp
    return { enabled: false, running: false, port, allowanceUsd, committedUsd: 0 }
  }
  registry.registerHandler('mcp.status', () => mcp?.status() ?? mcpOff())
  registry.registerHandler('mcp.regenerateToken', () => mcp?.regenerateToken() ?? mcpOff())
  registry.registerHandler('mcp.resetCommitted', () => mcp?.resetCommitted() ?? mcpOff())
  const noConnector = (): never => {
    throw new AppError({ code: 'invalid_request', userMessage: '這個版本還不能一鍵連接。' })
  }
  registry.registerHandler('mcp.connectInfo', () => (mcpConnector ?? noConnector()).info())
  registry.registerHandler('mcp.connectClaudeDesktop', () =>
    (mcpConnector ?? noConnector()).connectClaudeDesktop(),
  )
  registry.registerHandler('mcp.connectClaudeCode', () =>
    (mcpConnector ?? noConnector()).connectClaudeCode(),
  )
  registry.registerHandler('models.list', () => settingsService.listModels())
  registry.registerHandler('models.setProject', ({ models }) => {
    settingsService.setProjectModels(models)
    return {}
  })
  registry.registerHandler('models.notices', () => ({ notices: settingsService.takeNotices() }))

  const requireQueue = () => {
    const queue = runtime.queue()
    if (!queue) {
      throw new AppError({
        code: 'project_not_found',
        userMessage: '請先開啟或建立一個專案。',
      })
    }
    return queue
  }
  /** 清單只給最近 100 筆，避免專案用久了之後一次傳太多。 */
  const RECENT_JOBS = 100
  registry.registerHandler('queue.list', () => ({
    jobs: (runtime.queue()?.list() ?? []).slice(-RECENT_JOBS).map((job) => runtime.summarize(job)),
  }))
  registry.registerHandler('queue.cancel', ({ jobId }) =>
    runtime.summarize(requireQueue().cancel(jobId)),
  )
  registry.registerHandler('queue.retry', ({ jobId }) =>
    runtime.summarize(requireQueue().retry(jobId)),
  )

  registry.registerHandler('quickstart.check', (request) => quickstart.check(request))
  registry.registerHandler('quickstart.run', async (request) => {
    // 整次生成（含「取代全部」先刪掉的舊內容）記成一筆，生成結束（成功、失敗或停止）時寫進歷史
    const finish = history.begin('一句話生成')
    try {
      return await quickstart.run(request, { onSettled: finish })
    } catch (error) {
      finish()
      throw error
    }
  })
  registry.registerHandler('quickstart.cancel', () => {
    quickstart.cancel()
    return {}
  })
  registry.registerHandler('quickstart.state', () => quickstart.state())
  registry.registerHandler('quickstart.upgradeCheck', () => upgrade.check())
  registry.registerHandler('quickstart.upgrade', () => {
    const result = upgrade.upgrade()
    history.clear()
    return result
  })
  registry.registerHandler('quickstart.export', () => quickstart.export())
  registry.registerHandler('shots.list', () => shots.list())
  registry.registerHandler('shots.update', ({ shotId, patch }) =>
    history.record(shotEditLabel(patch), () => shots.update(shotId, patch)),
  )
  registry.registerHandler('shots.regenerate', async ({ shotId, mode }) => {
    await shots.regenerate(shotId, mode)
    return {}
  })
  registry.registerHandler('shots.batchCheck', (request) => shots.batchCheck(request))
  registry.registerHandler('shots.generateBatch', (request) => shots.generateBatch(request))
  registry.registerHandler('shots.cancel', ({ shotId }) => {
    shots.cancel(shotId)
    return {}
  })
  registry.registerHandler('shots.adopt', ({ takeId }) => shots.adopt(takeId))
  registry.registerHandler('shots.rejoin', () => shots.rejoin())

  registry.registerHandler('history.state', () => history.state())
  registry.registerHandler('history.undo', () => history.undo())
  registry.registerHandler('history.redo', () => history.redo())
  registry.registerHandler('characters.list', () => ({ characters: characters.list() }))
  registry.registerHandler('characters.create', ({ name }) => characters.create(name))
  registry.registerHandler('characters.update', ({ characterId, patch }) =>
    characters.update(characterId, patch),
  )
  registry.registerHandler('characters.delete', ({ characterId }) => {
    characters.remove(characterId)
    return {}
  })
  registry.registerHandler('characters.suggestAnchor', async ({ characterId }) => ({
    text: await characters.suggestAnchor(characterId),
  }))
  registry.registerHandler('characters.setAnchor', ({ characterId, text }) =>
    characters.setAnchor(characterId, text),
  )
  const needSound = (): SoundService => {
    if (!sound) {
      throw new AppError({
        code: 'internal_error',
        userMessage: '聲音服務還沒準備好，請重新啟動 App。',
      })
    }
    return sound
  }
  registry.registerHandler('sound.get', () => needSound().state())
  registry.registerHandler('sound.plan', (request) => needSound().plan(request))
  registry.registerHandler('sound.generateNarration', async (request) => ({
    clip: await needSound().generateNarration(request),
  }))
  registry.registerHandler('sound.generateMusic', async (request) => ({
    clip: await needSound().generateMusic(request),
  }))
  registry.registerHandler('sound.updateClip', ({ clipId, patch }) => ({
    clip: needSound().updateClip(clipId, patch),
  }))
  registry.registerHandler('sound.adoptClip', ({ clipId }) => ({
    clip: needSound().adoptClip(clipId),
  }))
  registry.registerHandler('sound.removeClip', ({ clipId }) => {
    needSound().removeClip(clipId)
    return {}
  })
  registry.registerHandler('sound.updateSettings', (patch) => needSound().updateSettings(patch))
  registry.registerHandler('characters.concepts', ({ characterId }) => concepts.state(characterId))
  registry.registerHandler('characters.conceptCheck', ({ characterId }) =>
    concepts.check(characterId),
  )
  registry.registerHandler('characters.generateConcepts', ({ characterId }) => {
    concepts.generate(characterId)
    return {}
  })
  registry.registerHandler('characters.cancelConcepts', ({ characterId }) => {
    concepts.cancel(characterId)
    return {}
  })
  registry.registerHandler('characters.pickHero', ({ characterId, conceptId }) =>
    characters.pickHero(characterId, conceptId),
  )
  registry.registerHandler('characters.turnarounds', ({ characterId }) =>
    turnarounds.state(characterId),
  )
  registry.registerHandler('characters.turnaroundCheck', ({ characterId }) =>
    turnarounds.check(characterId),
  )
  registry.registerHandler('characters.generateTurnarounds', ({ characterId }) => {
    turnarounds.generate(characterId)
    return {}
  })
  registry.registerHandler('characters.cancelTurnarounds', ({ characterId }) => {
    turnarounds.cancel(characterId)
    return {}
  })
  registry.registerHandler('characters.reslice', ({ characterId, turnaroundId, cuts }) =>
    turnarounds.reslice(characterId, turnaroundId, cuts),
  )
  registry.registerHandler('characters.adoptTurnaround', ({ characterId, turnaroundId }) =>
    characters.adoptTurnaround(characterId, turnaroundId),
  )
  registry.registerHandler('shots.create', (input) =>
    history.record('新增鏡頭', () => shots.create(input)),
  )
  registry.registerHandler('shots.delete', ({ shotIds }) =>
    history.record(shotIds.length > 1 ? `刪除 ${String(shotIds.length)} 個鏡頭` : '刪除鏡頭', () =>
      shots.remove(shotIds),
    ),
  )
  registry.registerHandler('shots.reorder', ({ orderedIds }) =>
    history.record('調整鏡頭順序', () => shots.reorder(orderedIds)),
  )
  registry.registerHandler('storyboard.splitCheck', ({ sceneId }) => storyboard.splitCheck(sceneId))
  registry.registerHandler('storyboard.splitScene', async ({ sceneId }) => {
    try {
      return await storyboard.splitScene(sceneId)
    } finally {
      // AI 重拆會把這個場的鏡頭整批換掉
      history.clear()
    }
  })
  registry.registerHandler('outline.get', () => outline.get())
  registry.registerHandler('outline.edit', (op) =>
    history.record(outlineLabel(op), () => outline.edit(op)),
  )
  registry.registerHandler('outline.splitCheck', ({ text }) => outline.splitCheck(text))
  registry.registerHandler('outline.split', async ({ text }) => {
    try {
      return await outline.split(text)
    } finally {
      // AI 重新拆整份大綱
      history.clear()
    }
  })
  registry.registerHandler('characters.versions', ({ characterId }) => ({
    versions: characters.versions(characterId),
  }))
  registry.registerHandler('characters.restoreVersion', ({ characterId, versionId }) =>
    characters.restoreVersion(characterId, versionId),
  )
  registry.registerHandler('characters.lock', ({ characterId }) => characters.lock(characterId))

  registry.registerHandler('locations.list', () => ({ locations: locations.list() }))
  registry.registerHandler('locations.setAnchor', ({ locationId, text }) =>
    locations.setAnchor(locationId, text),
  )
  registry.registerHandler('locations.images', ({ locationId }) => locations.images(locationId))
  registry.registerHandler('locations.check', ({ locationId, kind }) =>
    locations.check(locationId, kind),
  )
  registry.registerHandler('locations.generate', ({ locationId, kind }) => {
    locations.generate(locationId, kind)
    return {}
  })
  registry.registerHandler('locations.cancel', ({ locationId }) => {
    locations.cancel(locationId)
    return {}
  })
  registry.registerHandler('locations.pickMain', ({ locationId, conceptId }) =>
    locations.pickMain(locationId, conceptId),
  )
  registry.registerHandler('locations.lock', ({ locationId }) => locations.lock(locationId))
  registry.registerHandler('locations.unlock', ({ locationId }) => locations.unlock(locationId))

  const missing = registry.missingHandlers()
  if (missing.length > 0) {
    throw new Error(`合約內的 channel 沒有實作：${missing.join(', ')}`)
  }
}
