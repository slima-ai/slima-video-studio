import {
  CanvasGroupColorSchema,
  ONELINER_DEFAULTS,
  OnelinerParamsSchema,
  SHOT_ANGLE_LABELS,
  SHOT_SIZE_LABELS,
  type Character,
  type CanvasEdge,
  type CanvasFinalCut,
  type CanvasGroupColor,
  type CanvasGraph,
  type CanvasNode,
  type CanvasNodeKind,
  type CanvasNodeStatus,
  type Location,
  type OnelinerParams,
  type Scene,
  type Shot,
  type Take,
} from '@svs/schema'

/** 一個自由節點（存在 canvas_nodes）。 */
export interface FreeNodeSource {
  id: string
  type: string
  params: Record<string, unknown>
  x: number
  y: number
}
/** 一條自由連線（存在 canvas_edges）。 */
export interface FreeEdgeSource {
  id: string
  sourceKey: string
  sourcePort: string
  targetKey: string
  targetPort: string
  kind: 'data' | 'reference'
}

/** 一個鏡頭現在的生成狀況。 */
export interface ShotLive {
  step?: 'prompt' | 'image' | 'video' | undefined
  error?: string | undefined
  /** 失敗在哪一步；有的話失敗掛在那一格（即使它有舊的結果）。 */
  failedStep?: 'image' | 'video' | undefined
}

/** 一鏡展開步驟時那三格的內容。 */
export interface StepInfo {
  prompt: string
  edited: boolean
  refs: { name: string; assetHash?: string }[]
  model: string
}

/** 投影需要的資料（都是從資料庫讀出來的原始列，這個檔案不碰資料庫）。 */
export interface CanvasSource {
  /** 已經依幕與場的順序排好。 */
  scenes: readonly Scene[]
  /** 已經依順序排好。 */
  shots: readonly Shot[]
  /** 各鏡頭目前採用的版本。 */
  adoptedTakes: readonly Take[]
  characters: readonly Character[]
  /** 已鎖定的角色：名字 → 目前鎖定的版本號。 */
  lockedVersions?: ReadonlyMap<string, number>
  /** 角色主圖，key 是角色 id。 */
  heroHashes: ReadonlyMap<string, string>
  locations: readonly Location[]
  freeNodes: readonly FreeNodeSource[]
  freeEdges: readonly FreeEdgeSource[]
  /** 被拖過的節點位置。 */
  positions: ReadonlyMap<string, { x: number; y: number }>
  /** 正在生成的鏡頭做到哪一步、最近一次失敗的原因（只存在記憶體裡，資料庫沒有）。 */
  live?: ReadonlyMap<string, ShotLive>
  /** 採用中的版本花了多久、多少錢（依素材雜湊）。 */
  usage?: ReadonlyMap<
    string,
    { durationMs?: number; costUsd?: number; costEstimated?: boolean; letterboxTrimmed?: boolean }
  >
  /** 模型 id → 給人看的名字（例如 mock/image →「示範圖片」）；查不到就顯示 id。 */
  modelNames?: ReadonlyMap<string, string>
  /** 圖或影片需要重跑的鏡頭（生成之後上游改過）。 */
  stale?: ReadonlyMap<string, { image: boolean; video: boolean }>
  viewport?: { x: number; y: number; zoom: number } | undefined
  /** 畫面上展開步驟的鏡頭，以及每一鏡那三格要顯示的內容（只排這一次，不存）。 */
  steps?: ReadonlyMap<string, StepInfo>
  /** 最新接好的成品（剪輯卡顯示）。 */
  final?: CanvasFinalCut | undefined
}

const STEP_TITLES = { prompt: '整理 Prompt', refs: '挑參考圖', model: '送出模型' } as const

// ── 自動排版（尺寸與間距和畫面上的節點卡片一致，見 uiux-spec §3、§12） ──
const SIZE = {
  shot: { w: 230, h: 188 },
  image: { w: 230, h: 246 },
  video: { w: 230, h: 246 },
} as const
/** 場框的內距。 */
const PAD = { x: 24, top: 44, bottom: 24 } as const
const ROW_PITCH = 256
/** 展開步驟的三格（整理 Prompt、挑參考圖、送出模型）疊在鏡頭下面，寬和鏡頭一樣。 */
const STEP_STAGES = ['prompt', 'refs', 'model'] as const
const STEP_H = { prompt: 150, refs: 104, model: 92 } as const
const STEP_GAP = 28
/** 第一格離鏡頭上緣多遠（鏡頭卡片高 160，再空一點）。 */
const STEP_TOP = 176
/** 展開的那一列多佔的高度：下面的列整體往下讓開。 */
const STEPS_EXTRA =
  STEP_TOP + STEP_H.prompt + STEP_H.refs + STEP_H.model + STEP_GAP * 2 + 26 - ROW_PITCH
/** 一列裡鏡頭、圖、影片的相對位置。 */
const COL_X = { shot: 0, image: 285, video: 570 } as const
const BASE_X = 420
const BASE_Y = 90
const SCENE_GAP = 60
/** 每一欄最多排幾個場，再往右換欄（場很多時不會變成一條超長的直列）。 */
const SCENES_PER_COLUMN = 10
const COLUMN_GAP = 140
const COLUMN_WIDTH = COL_X.video + SIZE.video.w + PAD.x * 2 + COLUMN_GAP
const LEFT_X = 60
const LEFT_PITCH = 240
const EMPTY_SCENE: { w: number; h: number } = { w: 400, h: 300 }
/** 自由方塊的大小（和畫面上的卡片一致，見 renderer canvas-model 的 NODE_SIZE）。 */
const FREE_SIZE: Readonly<Record<string, { w: number; h: number }>> = {
  oneliner: { w: 300, h: 440 },
  free_image: { w: 200, h: 170 },
  free_video: { w: 200, h: 170 },
  upload: { w: 200, h: 170 },
  note: { w: 200, h: 120 },
  group: { w: 200, h: 120 },
}

interface Point {
  x: number
  y: number
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

/** 一句話節點存下來的設定；缺的欄位補預設值。 */
function onelinerOf(params: Record<string, unknown>): OnelinerParams {
  const parsed = OnelinerParamsSchema.safeParse({ ...ONELINER_DEFAULTS, ...params })
  return parsed.success ? parsed.data : ONELINER_DEFAULTS
}

/** 不會把自動排版的場推開的自由節點。 */
const NOT_OBSTACLES: ReadonlySet<string> = new Set(['group', 'free_image', 'free_video', 'upload'])

/** 群組顏色：存的不是 6 色之一就當成灰色。 */
const groupColor = (value: unknown): CanvasGroupColor => {
  const parsed = CanvasGroupColorSchema.safeParse(value)
  return parsed.success ? parsed.data : 'slate'
}

const FREE_KINDS: ReadonlySet<string> = new Set([
  'oneliner',
  'free_image',
  'free_video',
  'upload',
  'note',
  'group',
])

/** 角色與地點在畫布上的節點鍵。 */
export const characterKey = (id: string): string => `character:${id}`
export const locationKey = (id: string): string => `location:${id}`
export const sceneKey = (id: string): string => `scene:${id}`
export const shotKey = (id: string): string => `shot:${id}`
export const freeKey = (id: string): string => `node:${id}`
export const CUT_KEY = 'cut'

function edgeId(source: string, sourcePort: string, target: string, targetPort: string): string {
  return `${source}:${sourcePort}->${target}:${targetPort}`
}

/**
 * 把資料庫裡的幕、場、鏡頭、版本、角色、地點與自由節點「投影」成畫布的節點與連線。
 * 純函式：沒存過位置的節點按場分列自動排版（場由上到下、每欄 10 場、鏡頭一列一個、
 * 一列由左到右是鏡頭→圖→影片），被拖過的節點用存下來的位置。
 */
export function projectCanvas(source: CanvasSource): CanvasGraph {
  const nodes: CanvasNode[] = []
  const edges: CanvasEdge[] = []
  const pushEdge = (
    from: string,
    fromPort: string,
    to: string,
    toPort: string,
    kind: 'data' | 'reference',
    free = false,
  ): void => {
    edges.push({
      id: edgeId(from, fromPort, to, toPort),
      source: from,
      sourcePort: fromPort,
      target: to,
      targetPort: toPort,
      kind,
      free,
    })
  }

  const takeOf = new Map<string, Take>()
  for (const take of source.adoptedTakes) takeOf.set(`${take.shotId}:${take.kind}`, take)
  const nameOf = new Map(source.characters.map((c) => [c.id, c.name]))
  const idOfName = new Map(source.characters.map((c) => [c.name, c.id]))

  const shotsByScene = new Map<string, Shot[]>()
  const loose: Shot[] = []
  const sceneIds = new Set(source.scenes.map((s) => s.id))
  for (const shot of source.shots) {
    if (shot.sceneId !== undefined && sceneIds.has(shot.sceneId)) {
      const list = shotsByScene.get(shot.sceneId)
      if (list) list.push(shot)
      else shotsByScene.set(shot.sceneId, [shot])
    } else {
      loose.push(shot)
    }
  }

  // ── 場與鏡頭（含圖、影片） ──
  /** 排一個場裡的鏡頭，回傳這一組的外框。 */
  const layoutGroup = (
    origin: Point,
    group: readonly Shot[],
    scene: Scene | undefined,
    sceneNo: number | undefined,
  ): { bottom: number } => {
    const members: { key: string; x: number; y: number; w: number; h: number; auto: boolean }[] = []
    // 展開步驟的鏡頭那一列比較高，後面的列往下讓
    let extra = 0
    group.forEach((shot, row) => {
      const slot = { x: origin.x + PAD.x, y: origin.y + PAD.top + row * ROW_PITCH + extra }
      const stepInfo = source.steps?.get(shot.id)
      if (stepInfo) extra += STEPS_EXTRA
      const key = shotKey(shot.id)
      const savedShot = source.positions.get(key)
      const at = savedShot ?? slot
      const takeImage = takeOf.get(`${shot.id}:first_frame`)
      const takeVideo = takeOf.get(`${shot.id}:video`)
      const parent = scene ? sceneKey(scene.id) : undefined
      const base = {
        ...(parent === undefined ? {} : { sceneKey: parent }),
        shotKey: key,
        entityId: shot.id,
      }
      const tags = shot.characters
        .map((c) => (c.characterId !== undefined ? nameOf.get(c.characterId) : undefined) ?? c.name)
        .filter((n): n is string => n !== undefined)
      const lockedTags = Object.fromEntries(
        tags.flatMap((name) => {
          const version = source.lockedVersions?.get(name)
          return version === undefined ? [] : [[name, version] as const]
        }),
      )
      nodes.push({
        key,
        kind: 'shot',
        ...base,
        x: at.x,
        y: at.y,
        auto: savedShot === undefined,
        title: `第 ${String(shot.number)} 鏡`,
        ...(stepInfo ? { expanded: true } : {}),
        summary: shot.description,
        ...(shot.dialogue.trim() === '' ? {} : { dialogue: shot.dialogue }),
        meta: `${SHOT_SIZE_LABELS[shot.size]}・${SHOT_ANGLE_LABELS[shot.angle]}・${String(shot.durationSec)} 秒`,
        tags,
        ...(Object.keys(lockedTags).length > 0 ? { lockedTags } : {}),
      })
      members.push({ key, ...at, ...SIZE.shot, auto: savedShot === undefined })
      const derived = (
        kind: 'image' | 'video',
        take: Take | undefined,
        title: string,
      ): CanvasNode => {
        const nodeKey = `${key}:${kind}`
        const saved = source.positions.get(nodeKey)
        const pos = saved ?? { x: at.x + COL_X[kind], y: at.y }
        const live = source.live?.get(shot.id)
        const status = derivedStatus(
          kind,
          shot.status,
          take !== undefined,
          takeImage !== undefined,
          live,
          source.stale?.get(shot.id)?.[kind] === true,
        )
        members.push({ key: nodeKey, ...pos, ...SIZE[kind], auto: saved === undefined })
        return {
          key: nodeKey,
          kind,
          ...base,
          x: pos.x,
          y: pos.y,
          auto: saved === undefined,
          title,
          summary: take ? (source.modelNames?.get(take.modelId) ?? take.modelId) : '',
          status,
          ...(status === 'failed' && live?.error !== undefined ? { error: live.error } : {}),
          ...(take
            ? {
                assetHash: take.assetHash,
                version: take.version,
                modelId: take.modelId,
                ...(source.modelNames?.has(take.modelId)
                  ? { modelName: source.modelNames.get(take.modelId) }
                  : {}),
                usage: { ...source.usage?.get(take.assetHash), createdAt: take.createdAt },
              }
            : {}),
          ...(kind === 'video' ? { inCut: shot.inCut } : {}),
        }
      }
      // 圖和影片的標題帶鏡頭號（「第 1 鏡・第一張畫面」）：一次長出十幾個節點時才分得出誰是誰
      const shotTitle = `第 ${String(shot.number)} 鏡`
      nodes.push(
        derived('image', takeImage, `${shotTitle}・第一張畫面`),
        derived('video', takeVideo, `${shotTitle}・影片`),
      )
      if (stepInfo) {
        // 鏡頭 → 整理 Prompt → 挑參考圖 → 送出模型 → 圖：鏡頭和圖之間的線改走這三格
        let y = at.y + STEP_TOP
        let from = { key, port: 'shot-steps' }
        for (const stage of STEP_STAGES) {
          const stepKey = `${key}:step:${stage}`
          nodes.push({
            key: stepKey,
            kind: 'step',
            ...base,
            x: at.x,
            y,
            auto: true,
            title: STEP_TITLES[stage],
            step:
              stage === 'prompt'
                ? { stage, prompt: stepInfo.prompt, edited: stepInfo.edited }
                : stage === 'refs'
                  ? { stage, refs: stepInfo.refs }
                  : { stage, model: stepInfo.model },
          })
          members.push({ key: stepKey, x: at.x, y, w: SIZE.shot.w, h: STEP_H[stage], auto: true })
          pushEdge(from.key, from.port, stepKey, 'step-in', 'data')
          from = { key: stepKey, port: 'step-out' }
          y += STEP_H[stage] + STEP_GAP
        }
        pushEdge(from.key, from.port, `${key}:image`, 'img-in', 'data')
      } else {
        pushEdge(key, 'shot-out', `${key}:image`, 'img-in', 'data')
      }
      pushEdge(`${key}:image`, 'img-out', `${key}:video`, 'vid-in', 'data')
      for (const c of shot.characters) {
        const id = c.characterId ?? (c.name === undefined ? undefined : idOfName.get(c.name))
        if (id !== undefined && nameOf.has(id)) {
          pushEdge(characterKey(id), 'char-out', key, 'shot-ref-char', 'reference')
        }
      }
      if (shot.locationId !== undefined) {
        pushEdge(locationKey(shot.locationId), 'loc-out', key, 'shot-ref-loc', 'reference')
      }
    })
    const placed = members.length > 0
    if (scene) {
      // 場框貼合成員（含被拖過的）；沒有鏡頭的場維持預設大小
      let box = { x: origin.x, y: origin.y, w: EMPTY_SCENE.w, h: EMPTY_SCENE.h }
      if (placed) {
        const minX = Math.min(...members.map((m) => m.x))
        const minY = Math.min(...members.map((m) => m.y))
        const maxX = Math.max(...members.map((m) => m.x + m.w))
        const maxY = Math.max(...members.map((m) => m.y + m.h))
        box = {
          x: minX - PAD.x,
          y: minY - PAD.top,
          w: maxX - minX + PAD.x * 2,
          h: maxY - minY + PAD.top + PAD.bottom,
        }
      }
      nodes.push({
        key: sceneKey(scene.id),
        kind: 'scene',
        entityId: scene.id,
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        auto: members.every((m) => m.auto),
        title: `第 ${String(sceneNo)} 場・${scene.title}`,
        ...(scene.summary === '' ? {} : { summary: scene.summary }),
        ...(sceneNo === undefined ? {} : { sceneNo }),
      })
      return { bottom: box.y + box.h }
    }
    const bottom = placed ? Math.max(...members.map((m) => m.y + m.h)) : origin.y
    return { bottom: bottom + PAD.bottom }
  }

  // 自由方塊（一句話、便條）佔住的地方：自動排版的場要避開，往下讓，不能蓋在它們上面。
  // 群組只是一個框（本來就是要框住別的格子）；放上來的圖片、影片是擺在旁邊的素材，
  // 一次放好幾個時可能落在場上，不能因此把整個場推走。這兩種都不算
  const freeRects = source.freeNodes
    .filter((free) => FREE_KINDS.has(free.type) && !NOT_OBSTACLES.has(free.type))
    .map((free) => {
      const at = source.positions.get(freeKey(free.id)) ?? { x: free.x, y: free.y }
      const size = FREE_SIZE[free.type] ?? { w: 200, h: 120 }
      return {
        x: at.x,
        y: at.y,
        w: num(free.params.width) ?? size.w,
        h: num(free.params.height) ?? size.h,
      }
    })
  /** 從 origin 往下找第一個不會壓到自由方塊的位置（場框估計的大小）。 */
  const clearOf = (origin: Point, rows: number, extra = 0): Point => {
    const w = COLUMN_WIDTH - COLUMN_GAP
    const h = rows === 0 ? EMPTY_SCENE.h : PAD.top + rows * ROW_PITCH + extra + PAD.bottom
    let y = origin.y
    for (let guard = 0; guard < 50; guard++) {
      const hit = freeRects.find(
        (r) => r.x < origin.x + w && origin.x < r.x + r.w && r.y < y + h && y < r.y + r.h,
      )
      if (!hit) break
      y = hit.y + hit.h + SCENE_GAP
    }
    return { x: origin.x, y }
  }

  const columnY = new Map<number, number>()
  source.scenes.forEach((scene, index) => {
    const column = Math.floor(index / SCENES_PER_COLUMN)
    const group = shotsByScene.get(scene.id) ?? []
    const origin = clearOf(
      { x: BASE_X + column * COLUMN_WIDTH, y: columnY.get(column) ?? BASE_Y },
      group.length,
      group.filter((shot) => source.steps?.has(shot.id) === true).length * STEPS_EXTRA,
    )
    const { bottom } = layoutGroup(origin, group, scene, index + 1)
    columnY.set(column, bottom + SCENE_GAP)
    if (scene.locationId !== undefined) {
      pushEdge(
        locationKey(scene.locationId),
        'loc-out',
        sceneKey(scene.id),
        'scene-loc',
        'reference',
      )
    }
  })
  // 還沒歸到任何場的鏡頭：排在最後一欄之後，沒有場框
  if (loose.length > 0) {
    const column = Math.ceil(source.scenes.length / SCENES_PER_COLUMN)
    layoutGroup({ x: BASE_X + column * COLUMN_WIDTH, y: BASE_Y }, loose, undefined, undefined)
  }

  // ── 角色、地點：左邊一欄 ──
  let leftY = BASE_Y
  const left = (key: string, kind: CanvasNodeKind, entityId: string, rest: Partial<CanvasNode>) => {
    const saved = source.positions.get(key)
    nodes.push({
      key,
      kind,
      entityId,
      x: saved?.x ?? LEFT_X,
      y: saved?.y ?? leftY,
      auto: saved === undefined,
      title: '',
      ...rest,
    })
    leftY += LEFT_PITCH
  }
  for (const character of source.characters) {
    const hero = source.heroHashes.get(character.id)
    left(characterKey(character.id), 'character', character.id, {
      title: character.name,
      summary: character.currentPackId === undefined ? '草稿' : '已鎖定',
      ...(hero ? { assetHash: hero } : {}),
    })
  }
  for (const location of source.locations) {
    left(locationKey(location.id), 'location', location.id, {
      title: location.name,
      summary: location.description,
      ...(location.mainAssetHash ? { assetHash: location.mainAssetHash } : {}),
    })
  }

  // ── 剪輯：每一場一個輸入槽 ──
  if (source.scenes.length > 0) {
    const columns = Math.ceil(source.scenes.length / SCENES_PER_COLUMN) + (loose.length > 0 ? 1 : 0)
    const saved = source.positions.get(CUT_KEY)
    const slots = source.scenes.map((scene, index) => {
      const group = shotsByScene.get(scene.id) ?? []
      return {
        id: `cut-slot-${String(index + 1)}`,
        sceneKey: sceneKey(scene.id),
        label: `${String(index + 1)}・第 ${String(index + 1)} 場`,
        total: group.length,
        // 只算真的會接進成品的：放進成品、而且已經有影片（還在生成的不算，免得顯示「4/4」卻少一段）
        used: group.filter((s) => s.inCut && takeOf.has(`${s.id}:video`)).length,
        excluded: group.filter((s) => !s.inCut).length,
      }
    })
    nodes.push({
      key: CUT_KEY,
      kind: 'cut',
      x: saved?.x ?? BASE_X + columns * COLUMN_WIDTH - 40,
      y: saved?.y ?? BASE_Y + 200,
      auto: saved === undefined,
      title: '剪輯',
      slots,
      ...(source.final ? { final: source.final } : {}),
    })
    for (const slot of slots) pushEdge(slot.sceneKey, 'scene-out', CUT_KEY, slot.id, 'data')
  }

  // ── 自由節點與連線 ──
  for (const free of source.freeNodes) {
    if (!FREE_KINDS.has(free.type)) continue
    const key = freeKey(free.id)
    const saved = source.positions.get(key)
    const width = num(free.params.width)
    const height = num(free.params.height)
    const summary = text(free.params.text) ?? text(free.params.summary)
    const hash = text(free.params.assetHash)
    const oneliner = free.type === 'oneliner' ? onelinerOf(free.params) : undefined
    nodes.push({
      key,
      kind: free.type as CanvasNodeKind,
      x: saved?.x ?? free.x,
      y: saved?.y ?? free.y,
      auto: false,
      title:
        text(free.params.title) ??
        (oneliner ? '一句話' : free.type === 'group' ? '群組' : free.type === 'note' ? '便條' : ''),
      ...(oneliner ? { oneliner, summary: oneliner.story } : {}),
      ...(summary === undefined || oneliner ? {} : { summary }),
      ...(hash === undefined ? {} : { assetHash: hash }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(free.type === 'group' ? { color: groupColor(free.params.color) } : {}),
    })
  }
  const present = new Set(nodes.map((n) => n.key))
  for (const edge of source.freeEdges) {
    if (present.has(edge.sourceKey) && present.has(edge.targetKey)) {
      pushEdge(edge.sourceKey, edge.sourcePort, edge.targetKey, edge.targetPort, edge.kind, true)
    }
  }

  // 同一個專案裡鍵不會重複；保險起見去重，免得畫面上同一個 key 出現兩次
  const seen = new Set<string>()
  const unique = nodes.filter((n) => (seen.has(n.key) ? false : (seen.add(n.key), true)))
  const uniqueEdges = edges.filter((e) =>
    seen.has(`e:${e.id}`) ? false : (seen.add(`e:${e.id}`), true),
  )
  return {
    nodes: unique,
    edges: uniqueEdges,
    ...(source.viewport ? { viewport: source.viewport } : {}),
  }
}

/**
 * 圖或影片節點的狀態。鏡頭正在生成時看它做到哪一步：圖在「整理 Prompt」「生圖」時執行中、
 * 影片在「生影片」時執行中，其餘時間排隊等上游；失敗掛在失敗的那一步（不知道是哪一步時，
 * 掛在第一個還沒有結果的節點上）。
 */
function derivedStatus(
  kind: 'image' | 'video',
  shot: Shot['status'],
  hasTake: boolean,
  hasImage: boolean,
  live: ShotLive | undefined,
  stale: boolean,
): CanvasNodeStatus {
  const step = live?.step
  if (step !== undefined) {
    if (kind === 'image') return step === 'video' && hasTake ? 'done' : 'running'
    return step === 'video' ? 'running' : 'queued'
  }
  if (live?.error !== undefined && live.failedStep !== undefined) {
    // 知道失敗在哪一步：那一格標失敗（重做失敗時舊的結果還在，但要讓人看到這次沒成功）；
    // 同一鏡的另一格照它自己有沒有結果
    if (live.failedStep === kind) return 'failed'
    if (!hasTake) return 'idle'
    return stale ? 'stale' : 'done'
  } else if (live?.error !== undefined && !hasTake) {
    return kind === 'image' || hasImage ? 'failed' : 'idle'
  }
  const status = statusOf(shot, hasTake)
  // 有結果但上游改過：需要重跑（生成中、排隊中、失敗優先顯示）
  return status === 'done' && stale ? 'stale' : status
}

/** 圖與影片節點的狀態：生成中、排隊中優先；有採用的版本就是完成。 */
function statusOf(shot: Shot['status'], hasTake: boolean): CanvasNodeStatus {
  if (shot === 'generating') return 'running'
  if (shot === 'queued') return 'queued'
  if (hasTake) return 'done'
  return shot === 'failed' ? 'failed' : 'idle'
}
