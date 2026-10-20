import {
  AppError,
  CANVAS_IMPORT_EXT,
  type CanvasAdd,
  type CanvasAddResult,
  type CanvasGet,
  type CanvasGraph,
  type CanvasImportBytes,
  type CanvasImportFiles,
  type CanvasImportMime,
  type CanvasImportResult,
  type CanvasLink,
  type CanvasMove,
  type CanvasPaste,
  type CanvasPasteResult,
  type CanvasRemove,
  type CanvasRemoveResult,
  type CanvasRunPlan,
  type CanvasRunRequest,
  type CanvasRunResult,
  type CanvasUpdateFree,
  type CanvasUpdateOneliner,
  type CanvasViewport,
} from '@svs/schema'

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { Readable } from 'node:stream'

import { ensureProject } from '../ensure-project'
import type { Logger } from '../logger'
import type { SoundService } from '../sound/sound-service'
import type { ProjectManager } from '../project-manager'
import type { Broadcast } from '../runtime/project-runtime'
import type { CharacterService } from '../characters/character-service'
import type { ShotService } from '../shots/shot-service'
import type { ModelRegistry } from '@svs/providers'
import { NODE_TYPES } from '@svs/workflows'
import { createCanvasAdder, type CanvasAdderDeps } from './canvas-add'
import { createCanvasRunner } from './canvas-run'
import { createRunSound } from './canvas-run-sound'
import { UPLOAD_MODEL } from '../shots/shot-service'
import { createCanvasCopier } from './canvas-copy'
import { createFreeLinker } from './canvas-free-link'
import { createCanvasLinker, type CanvasLinkerDeps } from './canvas-link'
import { projectCanvas, type StepInfo } from './projection'

export interface CanvasService {
  /** 畫布上的節點與連線（沒有開啟專案就是空的）。 */
  get: (request?: CanvasGet) => CanvasGraph
  /** 把一批節點放到新位置（鏡頭拖進別的場時一併改所屬的場）。要記進復原歷史，所以由呼叫的地方包在 history.record 裡。 */
  move: (request: CanvasMove) => void
  /** 拖過的節點回到自動排版（自由方塊不動），回傳幾個。 */
  tidy: () => { reset: number }
  /**
   * 新增場、鏡頭、角色或地點，從連接點新增時順便接上。要記進復原歷史，
   * 所以由呼叫的地方包在 history.record 裡（新增角色本身不記，角色有自己的版本管理）。
   */
  add: (request: CanvasAdd) => CanvasAddResult
  /** 拉線：角色→鏡頭、地點→場或鏡頭，寫回原本的表。要記進復原歷史（由呼叫的地方包在 history.record 裡）。 */
  link: (request: CanvasLink) => void
  /** 剪線：把上面那種關係拿掉。要記進復原歷史。 */
  unlink: (request: CanvasLink) => void
  /**
   * 刪除鏡頭（連同圖與影片）、場、角色、地點，並清掉它們存下來的位置。
   * 要記進復原歷史（角色不在歷史涵蓋的資料表裡，刪了不能復原）。
   */
  remove: (request: CanvasRemove) => CanvasRemoveResult
  /** 改一句話節點的設定（故事、畫風、鏡頭數、秒數、比例）。要記進復原歷史。 */
  updateOneliner: (request: CanvasUpdateOneliner) => void
  /** 「上傳」：跳出選檔視窗，選好的圖片、影片各放成一格。 */
  /** 貼上複製的格子：依種類各自處理（見 `CanvasPasteSchema`）。 */
  paste: (request: CanvasPaste) => CanvasPasteResult
  importFiles: (request: CanvasImportFiles) => Promise<CanvasImportResult>
  /** 拖進畫布的檔案：存進素材，放成一格。 */
  importBytes: (request: CanvasImportBytes) => Promise<CanvasImportResult>
  /** 改便條的字、群組的名字／顏色／大小；種類不對就丟白話錯誤。 */
  updateFree: (request: CanvasUpdateFree) => void
  /** 執行前的檢查：這次會跑哪些節點、預估花費、要標亮哪一串。 */
  runPlan: (request: CanvasRunRequest) => CanvasRunPlan
  /** 執行：補跑還沒有結果的節點，在背景進行（不進復原歷史）。 */
  run: (request: CanvasRunRequest) => Promise<CanvasRunResult>
  /** 記住視角；不算編輯。 */
  viewport: (view: CanvasViewport) => void
}

export interface CanvasServiceDeps extends Omit<CanvasAdderDeps, 'freeNodes'>, CanvasLinkerDeps {
  shots: Pick<
    ShotService,
    | 'list'
    | 'live'
    | 'staleness'
    | 'create'
    | 'update'
    | 'moveToScene'
    | 'remove'
    | 'planRun'
    | 'run'
    | 'whenIdle'
    | 'rejoin'
    | 'finalCut'
    | 'setUploadedFrame'
    | 'duplicate'
    | 'clearAdopted'
    | 'flowOf'
  >
  characters: Pick<CharacterService, 'list' | 'create' | 'remove'>
  /** 模型註冊表：節點上顯示模型的名字而不是 id。 */
  models?: Pick<ModelRegistry, 'get'>
  projects: ProjectManager
  broadcast: Broadcast
  /** 還沒有開啟專案時，新增一句話會自動建一個，放在這個資料夾（沒給就不自動建）。 */
  projectsDir?: string
  log: Pick<Logger, 'info' | 'warn'>
  now?: () => Date
  /** 聲音服務（「全部生成」之後照一句話卡片的勾選自動加旁白與配樂）；沒給就不加。 */
  sound?: () => Pick<SoundService, 'plan' | 'addAll' | 'state'> | undefined
  /** 「上傳」的選檔視窗：回傳選到的檔案路徑（取消就是空的）。沒給就當作取消（測試用）。 */
  pickFiles?: () => Promise<string[]>
}

/** 選檔時一次最多放幾個；同一批從放的位置往右並排（一格寬 220，中間留 20）。 */
const IMPORT_MAX_FILES = 20
const IMPORT_STEP = 240
/** 檔名當格子的名字：拿掉副檔名，太長就截斷。 */
const titleOf = (name: string): string => {
  const base = basename(name, extname(name)).trim()
  return (base === '' ? '上傳的檔案' : base).slice(0, 40)
}

const EMPTY: CanvasGraph = { nodes: [], edges: [] }

/**
 * 畫布（首頁）的資料：把幕、場、鏡頭、版本、角色、地點與自由節點投影成節點與連線，
 * 並存節點位置與視角。資料仍以原本的表為準，畫布只多存位置。
 */
export function createCanvasService(deps: CanvasServiceDeps): CanvasService {
  const { projects, broadcast } = deps
  const adder = createCanvasAdder({
    ...deps,
    freeNodes: () => {
      const handle = projects.current()
      return handle && !handle.closed ? handle.repos.canvas : undefined
    },
  })
  const linker = createCanvasLinker(deps)
  const freeLinker = createFreeLinker({ projects, shots: deps.shots })
  const copier = createCanvasCopier({
    projects,
    shots: deps.shots,
    outline: deps.outline,
    characters: deps.characters,
    graph: () => service.get(),
  })
  const runner = createCanvasRunner({
    shots: deps.shots,
    log: deps.log,
    runSound: createRunSound({
      projects,
      log: deps.log,
      ...(deps.sound ? { sound: deps.sound } : {}),
    }),
    notify: (notice) => {
      broadcast('canvas.notice', notice)
    },
  })
  let revision = 0

  /**
   * 展開步驟的鏡頭那三格要顯示什麼：送給模型的第一張畫面 Prompt（手動改過的優先）、
   * 會帶進去的參考圖（鎖定的出場角色主圖、這一鏡或這一場地點的場景卡主圖）、用哪個模型。
   */
  const stepsOf = (expanded: ReadonlySet<string>): Map<string, StepInfo> => {
    const result = new Map<string, StepInfo>()
    const handle = projects.current()
    if (expanded.size === 0 || !handle || handle.closed) return result
    const { characters, locationCards, outline } = handle.repos
    const sceneLocation = new Map(outline.listScenes().map((x) => [x.id, x.locationId]))
    const cards = new Map(locationCards.list().map((c) => [c.id, c]))
    const people = characters.list()
    for (const view of deps.shots.list().shots) {
      if (!expanded.has(view.id)) continue
      const shot = handle.repos.shots.get(view.id)
      if (!shot) continue
      const refs: StepInfo['refs'] = []
      for (const name of view.characters) {
        const person = people.find((c) => c.name === name)
        const pack = person ? characters.pack(person.id) : undefined
        if (pack?.status === 'locked') {
          refs.push({ name, ...(pack.heroAssetHash ? { assetHash: pack.heroAssetHash } : {}) })
        }
      }
      const locationId =
        shot.locationId ?? (shot.sceneId ? sceneLocation.get(shot.sceneId) : undefined)
      const card = locationId === undefined ? undefined : cards.get(locationId)
      if (card?.status === 'locked') {
        refs.push({
          name: card.name,
          ...(card.mainAssetHash ? { assetHash: card.mainAssetHash } : {}),
        })
      }
      const image = deps.shots.flowOf(view.id).nodes.find((n) => n.id === 'image')
      const model =
        image?.type === NODE_TYPES.fixedImage
          ? '用接上來的圖（不送模型）'
          : image?.modelId
            ? (deps.models?.get(image.modelId)?.displayName ?? image.modelId)
            : '還沒選圖片模型（到設定選一個）'
      result.set(view.id, {
        prompt: view.prompt ?? view.autoPrompt,
        edited: view.prompt !== undefined,
        refs,
        model,
      })
    }
    return result
  }

  /** 把一個圖片或影片存進專案的素材，放成一格獨立的格子。 */
  const placeAsset = async (
    content: Uint8Array | Readable,
    mime: CanvasImportMime,
    name: string,
    at: { x: number; y: number },
  ): Promise<CanvasAddResult> => {
    const handle = projects.current()
    if (!handle || handle.closed) {
      throw new AppError({ code: 'invalid_request', userMessage: '請先開啟或建立一個專案。' })
    }
    const stored = await handle.assets.put(content, mime)
    const video = mime.startsWith('video/')
    const title = titleOf(name)
    const row = handle.repos.canvas.addNode({
      type: video ? 'free_video' : 'free_image',
      params: { assetHash: stored.hash, mime, title, source: 'upload' },
      x: Math.round(at.x),
      y: Math.round(at.y),
    })
    revision += 1
    broadcast('canvas.changed', { revision })
    return { key: `node:${row.id}`, title }
  }

  /** 從「＋」選檔：把放上來的第一張圖接到那個連接點；接不上就說明原因（圖還是留在畫布上）。 */
  const connectFirstImage = (
    result: CanvasImportResult,
    target: { key: string; port: string },
  ): void => {
    const handle = projects.current()
    if (!handle || handle.closed) return
    const images = new Set(
      handle.repos.canvas
        .listNodes()
        .filter((n) => n.type === 'free_image')
        .map((n) => `node:${n.id}`),
    )
    const first = result.added.find((a) => images.has(a.key))
    if (!first) {
      if (result.added.length > 0) result.notice = '影片還不能接到這裡，先放在畫布上'
      return
    }
    try {
      freeLinker.link({ source: { key: first.key, port: 'free-img-out' }, target })
      result.connected = true
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      result.notice = `「${first.title}」放在畫布上了，但沒接上：${error.userMessage}`
    }
    revision += 1
    broadcast('canvas.changed', { revision })
  }

  const service: CanvasService = {
    get(request = {}) {
      const handle = projects.current()
      if (!handle || handle.closed) return EMPTY
      const { shots, outline, characters, canvas } = handle.repos
      const viewport = canvas.viewport()
      const steps = stepsOf(new Set(request.expanded ?? []))
      const graph = projectCanvas({
        scenes: outline.listScenes(),
        shots: shots.list(),
        adoptedTakes: shots.adoptedTakes(),
        characters: characters.list(),
        // 和生成時帶入固定外觀的條件一樣：鎖定、而且有固定外觀描述（見 characters/anchors.ts）
        lockedVersions: new Map(
          characters.list().flatMap((c) => {
            const pack = characters.pack(c.id)
            return pack?.status === 'locked' && pack.anchorText.trim() !== ''
              ? [[c.name, pack.version] as const]
              : []
          }),
        ),
        heroHashes: new Map(
          characters.list().flatMap((c) => {
            const hash = characters.pack(c.id)?.heroAssetHash
            return hash === undefined ? [] : [[c.id, hash] as const]
          }),
        ),
        locations: outline.listLocations(),
        freeNodes: canvas.listNodes(),
        freeEdges: canvas.listEdges(),
        positions: canvas.positions(),
        live: deps.shots.live(),
        stale: deps.shots.staleness(),
        modelNames: new Map(
          shots.adoptedTakes().flatMap((take) => {
            const name =
              take.modelId === UPLOAD_MODEL
                ? '接上來的圖'
                : deps.models?.get(take.modelId)?.displayName
            return name === undefined ? [] : [[take.modelId, name] as const]
          }),
        ),
        usage: handle.repos.jobs.usageByAsset(shots.adoptedTakes().map((take) => take.assetHash)),
        viewport,
        final: deps.shots.finalCut(),
        ...(steps.size > 0 ? { steps } : {}),
      })
      // 已花的錢：示範模式（mock）的估算不是真的花費，不算
      const spentUsd = handle.repos.costs.totalUsd(handle.projectId, { excludeProviders: ['mock'] })
      return { ...graph, spentUsd }
    },

    move({ moves, reparent }) {
      const handle = projects.current()
      if (!handle || handle.closed) return
      if (reparent) {
        const shotId = reparent.shotKey.replace(/^shot:/, '')
        const sceneId = reparent.sceneKey.replace(/^scene:/, '')
        deps.shots.moveToScene(shotId, sceneId)
      }
      handle.repos.canvas.move(moves)
      revision += 1
      broadcast('canvas.changed', { revision })
    },

    add(request) {
      if (request.kind === 'oneliner' && deps.projectsDir !== undefined) {
        ensureProject(projects, deps.projectsDir, '我的短片', deps.now?.() ?? new Date())
      }
      // 從獨立圖片的「＋」新增角色或地點：先新增，再把這張圖接成它的參考圖
      const { from, ...plain } = request
      const fromImage =
        from?.side === 'out' &&
        from.port === 'free-img-out' &&
        (request.kind === 'character' || request.kind === 'location')
          ? from
          : undefined
      const result = adder.add(fromImage ? plain : request)
      if (fromImage) {
        freeLinker.link({
          source: { key: fromImage.key, port: fromImage.port },
          target: { key: result.key, port: request.kind === 'location' ? 'loc-ref' : 'char-ref' },
        })
      }
      const handle = projects.current()
      // 角色與地點沒有自動排版的位置，放在使用者指定的地方
      if (handle && !handle.closed && request.x !== undefined && request.y !== undefined) {
        if (request.kind === 'character' || request.kind === 'location') {
          handle.repos.canvas.move([{ key: result.key, x: request.x, y: request.y }])
        }
      }
      revision += 1
      broadcast('canvas.changed', { revision })
      return result
    },

    paste(request) {
      const result = copier.paste(request)
      revision += 1
      broadcast('canvas.changed', { revision })
      return result
    },

    link(request) {
      if (!freeLinker.link(request)) linker.link(request)
      revision += 1
      broadcast('canvas.changed', { revision })
    },

    unlink(request) {
      if (!freeLinker.unlink(request)) linker.unlink(request)
      revision += 1
      broadcast('canvas.changed', { revision })
    },

    tidy() {
      const handle = projects.current()
      if (!handle || handle.closed) return { reset: 0 }
      const keys = [...handle.repos.canvas.positions().keys()].filter((k) => !k.startsWith('node:'))
      handle.repos.canvas.resetPositions(keys)
      revision += 1
      broadcast('canvas.changed', { revision })
      return { reset: keys.length }
    },

    remove(request) {
      const handle = projects.current()
      // 一句話這類自由節點存在畫布自己的表；其他的交給原本的服務
      const freeKeys = request.keys.filter((key) => key.startsWith('node:'))
      const dataKeys = request.keys.filter((key) => !key.startsWith('node:'))
      const known = new Set(handle?.repos.canvas.listNodes().map((n) => `node:${n.id}`))
      for (const key of freeKeys) {
        if (!known.has(key)) {
          throw new AppError({
            code: 'invalid_request',
            userMessage: '畫布上找不到這一格，可能已經被刪掉了。',
          })
        }
      }
      const result = dataKeys.length > 0 ? linker.remove({ keys: dataKeys }) : { removed: 0 }
      if (handle && !handle.closed) {
        // 刪掉獨立圖片：它接出去的線先解除（鏡頭回到原本的第一張畫面、拿掉加上去的參考圖）
        const edges = handle.repos.canvas.listEdges()
        const images = new Set(
          handle.repos.canvas
            .listNodes()
            .filter((n) => n.type === 'free_image')
            .map((n) => `node:${n.id}`),
        )
        for (const key of freeKeys) {
          const outgoing = images.has(key) ? edges.filter((e) => e.sourceKey === key) : []
          for (const edge of outgoing) {
            freeLinker.unlink({
              source: { key: edge.sourceKey, port: edge.sourcePort },
              target: { key: edge.targetKey, port: edge.targetPort },
            })
          }
          handle.repos.canvas.removeNode(key.slice('node:'.length))
        }
        result.removed += freeKeys.length
        // 連同鏡頭的圖與影片一起清掉存下來的位置
        const gone = request.keys.flatMap((key) =>
          key.startsWith('shot:') ? [key, `${key}:image`, `${key}:video`] : [key],
        )
        handle.repos.canvas.resetPositions(gone)
      }
      revision += 1
      broadcast('canvas.changed', { revision })
      return result
    },

    updateOneliner({ key, patch }) {
      const handle = projects.current()
      if (!handle || handle.closed) return
      const node = handle.repos.canvas.listNodes().find((n) => `node:${n.id}` === key)
      if (node?.type !== 'oneliner') {
        throw new AppError({
          code: 'invalid_request',
          userMessage: '找不到這個「一句話」，可能已經被刪掉了。',
        })
      }
      // 改了聲音勾選＝重新決定要不要自動加：之後的「全部生成」再照新的勾選加
      handle.repos.canvas.updateNodeParams(
        node.id,
        patch.sound === undefined ? patch : { ...patch, soundAutoAddedAt: undefined },
      )
      revision += 1
      broadcast('canvas.changed', { revision })
    },

    async importFiles({ x, y, connectTo }) {
      const paths = (await deps.pickFiles?.()) ?? []
      const result: CanvasImportResult = { added: [], skipped: [] }
      for (const [index, path] of paths.slice(0, IMPORT_MAX_FILES).entries()) {
        const name = basename(path)
        const mime = CANVAS_IMPORT_EXT[extname(path).slice(1).toLowerCase()]
        if (!mime) {
          result.skipped.push({
            name,
            reason: '不支援這種檔案（可以放 PNG、JPG、WebP 圖片或 MP4、WebM、MOV 影片）',
          })
          continue
        }
        try {
          const info = await stat(path)
          if (!info.isFile() || info.size === 0) {
            result.skipped.push({ name, reason: '讀不到這個檔案' })
            continue
          }
          const at = { x: (x ?? 60) + index * IMPORT_STEP, y: y ?? 60 }
          result.added.push(await placeAsset(createReadStream(path), mime, name, at))
        } catch (error) {
          if (error instanceof AppError) throw error
          result.skipped.push({ name, reason: '讀不到這個檔案' })
        }
      }
      if (connectTo) connectFirstImage(result, connectTo)
      return result
    },

    async importBytes({ name, mime, bytes, x, y }) {
      const added = await placeAsset(bytes, mime, name, { x: x ?? 60, y: y ?? 60 })
      return { added: [added], skipped: [] }
    },

    updateFree({ key, patch }) {
      const handle = projects.current()
      if (!handle || handle.closed) return
      const node = handle.repos.canvas.listNodes().find((n) => `node:${n.id}` === key)
      const invalid = (userMessage: string): AppError =>
        new AppError({ code: 'invalid_request', userMessage })
      if (!node) throw invalid('找不到這一格，可能已經被刪掉了。')
      if (node.type === 'note') {
        if (patch.title !== undefined || patch.color !== undefined)
          throw invalid('便條只能改裡面的字。')
      } else if (node.type === 'group') {
        if (patch.text !== undefined) throw invalid('群組沒有文字，只能改名字、顏色和大小。')
      } else {
        throw invalid('這一格不能改名：場、角色、地點、群組才能改名。')
      }
      handle.repos.canvas.updateNodeParams(node.id, patch)
      revision += 1
      broadcast('canvas.changed', { revision })
    },

    runPlan: (request) => runner.plan(request),
    run: (request) => runner.run(request),

    viewport(view) {
      const handle = projects.current()
      if (!handle || handle.closed) return
      handle.repos.canvas.setViewport(view)
    },
  }
  return service
}
