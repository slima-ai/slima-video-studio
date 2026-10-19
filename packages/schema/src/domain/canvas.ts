import { z } from 'zod'

import { ContentHashSchema } from './common'
import { ModelTierSchema } from './models'
import { QUICK_START_LIMITS, QuickStartSoundSchema, QuickStyleIdSchema } from './quickstart'

/**
 * 畫布（首頁）上的節點種類。幕、場、鏡頭、角色、地點與版本仍存在原本的表，畫布把它們「投影」成節點；
 * `oneliner`、`free_image`、`free_video`、`upload`、`note`、`group` 是自由節點，存在 `canvas_nodes`。
 * `image`／`video` 是鏡頭的兩個版本群組虛擬出來的節點，節點鍵是 `shot:<id>:image`、`shot:<id>:video`。
 */
export const CanvasNodeKindSchema = z.enum([
  'oneliner',
  'scene',
  'shot',
  'image',
  'video',
  'cut',
  'character',
  'location',
  'free_image',
  'free_video',
  'upload',
  'note',
  'group',
  'step',
])
export type CanvasNodeKind = z.infer<typeof CanvasNodeKindSchema>

/**
 * 鏡頭「展開步驟」時插在鏡頭和圖之間的三格（uiux-spec §12.8）：整理 Prompt、挑參考圖、送出模型。
 * 只在畫面上展開時才有，不寫進資料；節點鍵是 `shot:<id>:step:<stage>`。
 */
export const CanvasStepSchema = z.object({
  stage: z.enum(['prompt', 'refs', 'model']),
  /** 整理 Prompt：送給模型的第一張畫面 Prompt；手動改過的話 `edited` 是 true。 */
  prompt: z.string().optional(),
  edited: z.boolean().optional(),
  /** 挑參考圖：會帶進去的參考圖（鎖定的角色主圖、場景卡主圖）。 */
  refs: z.array(z.object({ name: z.string(), assetHash: ContentHashSchema.optional() })).optional(),
  /** 送出模型：用哪個模型（接上來的圖就不送模型）。 */
  model: z.string().optional(),
})
export type CanvasStep = z.infer<typeof CanvasStepSchema>

/** 讀畫布：`expanded` 是畫面上展開步驟的鏡頭 id（只影響這一次的排版，不存）。 */
export const CanvasGetSchema = z.object({
  expanded: z.array(z.string().min(1)).max(500).optional(),
})
export type CanvasGet = z.infer<typeof CanvasGetSchema>

/** 自由節點（存在 `canvas_nodes`）的種類。 */
export const FreeNodeTypeSchema = z.enum([
  'oneliner',
  'free_image',
  'free_video',
  'upload',
  'note',
  'group',
])
export type FreeNodeType = z.infer<typeof FreeNodeTypeSchema>

/** 圖與影片節點的狀態。`stale` 是上游改過、要重跑；`queued`／`running`／`failed` 之後由執行狀態填入。 */
export const CanvasNodeStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'done',
  'stale',
  'failed',
])
export type CanvasNodeStatus = z.infer<typeof CanvasNodeStatusSchema>

/** 剪輯節點的一個輸入槽：每一場一個。 */
export const CanvasCutSlotSchema = z.object({
  /** 輸入點 id，例如 `cut-slot-1`。 */
  id: z.string(),
  /** 接上來的場節點鍵。 */
  sceneKey: z.string(),
  label: z.string(),
  /** 這一場有幾個鏡頭；其中幾個已經有影片而且放進成品（真的會接進成品的）。 */
  total: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  /** 其中幾個被使用者關掉「放進成品」。 */
  excluded: z.number().int().nonnegative().default(0),
})
export type CanvasCutSlot = z.infer<typeof CanvasCutSlotSchema>

/** 剪輯卡上的成品：最新接好的版本；`stale` 表示跟現在要接進成品的影片對不上（換了版本、開關改了、多了鏡頭）。 */
export const CanvasFinalCutSchema = z.object({
  version: z.number().int().positive(),
  assetHash: ContentHashSchema,
  durationSec: z.number().nonnegative().optional(),
  createdAt: z.string(),
  stale: z.boolean(),
})
export type CanvasFinalCut = z.infer<typeof CanvasFinalCutSchema>

/** 一句話節點的設定：故事（或一句話）、畫風、鏡頭數、每鏡秒數、畫面比例。 */
export const OnelinerParamsSchema = z.object({
  story: z.string().max(QUICK_START_LIMITS.maxStoryChars),
  style: QuickStyleIdSchema,
  shotCount: z.number().int().min(1).max(QUICK_START_LIMITS.maxShots),
  durationSec: z
    .number()
    .int()
    .min(QUICK_START_LIMITS.minDurationSec)
    .max(QUICK_START_LIMITS.maxDurationSec),
  aspectRatio: z.enum(['16:9', '9:16']),
  /** 聲音三個勾選；舊的節點沒有這個欄位，畫面上當成全開。 */
  sound: QuickStartSoundSchema.optional(),
})
export type OnelinerParams = z.infer<typeof OnelinerParamsSchema>

/** 新增的一句話節點預設的設定。 */
export const ONELINER_DEFAULTS: OnelinerParams = {
  story: '',
  style: 'realistic',
  shotCount: 4,
  durationSec: 5,
  aspectRatio: '16:9',
}

/** 自訂群組的 6 種顏色。 */
export const CanvasGroupColorSchema = z.enum(['slate', 'blue', 'green', 'amber', 'rose', 'violet'])
export type CanvasGroupColor = z.infer<typeof CanvasGroupColorSchema>

export const CanvasNodeSchema = z.object({
  /** 節點鍵：畫布上唯一，位置也用它存。 */
  key: z.string().min(1),
  kind: CanvasNodeKindSchema,
  /** 這個節點背後的資料 id（鏡頭 id、場 id…）；剪輯節點與虛擬的圖、影片節點沒有或指向鏡頭。 */
  entityId: z.string().optional(),
  x: z.number(),
  y: z.number(),
  /** 場框的大小（貼合成員）；其他節點由畫面自己決定。 */
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  /** 位置是自動排版算出來的（還沒被拖過）。 */
  auto: z.boolean(),
  title: z.string(),
  summary: z.string().optional(),
  /** 卡片上的一行小字，例如「中景・平視・5 秒」。 */
  meta: z.string().optional(),
  /** 鏡頭上顯示的出場角色名字。 */
  tags: z.array(z.string()).optional(),
  /** 出場角色裡已經鎖定的：名字 → 目前鎖定的版本號（卡片上標「阿鐵 v1」，生成時會帶入參考圖）。 */
  lockedTags: z.record(z.string(), z.number().int().positive()).optional(),
  status: CanvasNodeStatusSchema.optional(),
  /** 失敗的圖與影片節點：白話的失敗原因。 */
  error: z.string().optional(),
  /** 一句話節點的設定。 */
  oneliner: OnelinerParamsSchema.optional(),
  /** 自訂群組的顏色。 */
  color: CanvasGroupColorSchema.optional(),
  /** 縮圖：目前採用的版本，或角色／地點的主圖。 */
  assetHash: ContentHashSchema.optional(),
  /** 目前採用的版本花了多久、多少錢、什麼時候生成的（圖與影片節點，卡片底部一行）。 */
  usage: z
    .object({
      durationMs: z.number().nonnegative().optional(),
      costUsd: z.number().nonnegative().optional(),
      costEstimated: z.boolean().optional(),
      createdAt: z.string(),
    })
    .optional(),
  /** 目前採用的版本號與用的模型（圖與影片節點）。 */
  version: z.number().int().positive().optional(),
  modelId: z.string().optional(),
  /** 模型給人看的名字（例如「示範圖片」）。 */
  modelName: z.string().optional(),
  /** 影片節點的「放進成品」。 */
  inCut: z.boolean().optional(),
  /** 這個節點屬於哪個場（場框裡的鏡頭、圖、影片）。 */
  sceneKey: z.string().optional(),
  /** 同一個鏡頭的那一串（鏡頭、圖、影片）共用的鏡頭節點鍵。 */
  shotKey: z.string().optional(),
  sceneNo: z.number().int().positive().optional(),
  slots: z.array(CanvasCutSlotSchema).optional(),
  /** 剪輯：最新接好的成品。 */
  final: CanvasFinalCutSchema.optional(),
  /** 展開步驟的那三格。 */
  step: CanvasStepSchema.optional(),
  /** 鏡頭：步驟展開著。 */
  expanded: z.boolean().optional(),
})
export type CanvasNode = z.infer<typeof CanvasNodeSchema>

export const CanvasEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourcePort: z.string(),
  target: z.string(),
  targetPort: z.string(),
  /** 參考連線（角色、地點的參考圖）畫成灰色虛線。 */
  kind: z.enum(['data', 'reference']),
  /** 存在 `canvas_edges` 的自由連線（可以被剪掉）；false 是由資料關係推出來的。 */
  free: z.boolean(),
})
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>

export const CanvasViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().min(0.05).max(4),
})
export type CanvasViewport = z.infer<typeof CanvasViewportSchema>

export const CanvasGraphSchema = z.object({
  nodes: z.array(CanvasNodeSchema),
  edges: z.array(CanvasEdgeSchema),
  /** 上次的視角；沒存過就沒有（畫面自己決定，例如「全部顯示」）。 */
  viewport: CanvasViewportSchema.optional(),
  /** 這個專案到目前為止花了多少（美元，上方列顯示）；沒有開專案就沒有。 */
  spentUsd: z.number().nonnegative().optional(),
})
export type CanvasGraph = z.infer<typeof CanvasGraphSchema>

/** 一次移動：哪些節點被放到哪裡（整串一起拖就是一串）。 */
export const CanvasMoveSchema = z.object({
  moves: z
    .array(z.object({ key: z.string().min(1), x: z.number(), y: z.number() }))
    .min(1)
    .max(2000),
  /** 鏡頭拖進了另一個場：連同位置一起改它所屬的場（鏡號跟著重排）。 */
  reparent: z.object({ shotKey: z.string().min(1), sceneKey: z.string().min(1) }).optional(),
})
export type CanvasMove = z.infer<typeof CanvasMoveSchema>

/** 改便條的字、群組的名字／顏色／大小。 */
export const CanvasUpdateFreeSchema = z.object({
  key: z.string().min(1),
  patch: z
    .object({
      text: z.string().max(2000).optional(),
      title: z.string().trim().min(1, '名字不能是空的').max(100).optional(),
      color: CanvasGroupColorSchema.optional(),
      width: z.number().positive().max(100_000).optional(),
      height: z.number().positive().max(100_000).optional(),
    })
    .refine((p) => Object.keys(p).length > 0, '沒有要改的東西'),
})
export type CanvasUpdateFree = z.infer<typeof CanvasUpdateFreeSchema>

/** 在畫布上改名（F2）：場的標題、角色或地點的名字、群組的名字。 */
export const CanvasRenameSchema = z.object({
  key: z.string().min(1),
  title: z.string().trim().min(1, '名字不能是空的').max(100, '名字不要超過 100 個字'),
})
export type CanvasRename = z.infer<typeof CanvasRenameSchema>

/** 畫布資料有變動（移動、復原、重做…）：畫面看到 revision 變了就重新載入。 */
export const CanvasChangedSchema = z.object({ revision: z.number().int().nonnegative() })
export type CanvasChanged = z.infer<typeof CanvasChangedSchema>

/**
 * 從畫布新增的節點種類：場、鏡頭、角色、地點存在原本的表；一句話、便條、群組是自由節點
 * （只在畫布上，表單頁看不到）。
 */
export const CanvasAddKindSchema = z.enum([
  'scene',
  'shot',
  'character',
  'location',
  'oneliner',
  'note',
  'group',
])
export type CanvasAddKind = z.infer<typeof CanvasAddKindSchema>

/** 新增節點：放在哪裡、要接到哪個連接點（從輸出點的「＋」或拉線放開在空白處新增時才有）。 */
export const CanvasAddSchema = z.object({
  kind: CanvasAddKindSchema,
  /** 角色、地點與一句話的位置（畫布座標）；場與鏡頭由所屬的場排版。 */
  x: z.number().optional(),
  y: z.number().optional(),
  /** 鏡頭放進哪一場（場節點鍵）；沒給就放在最後一場，還沒有場就不分場。 */
  sceneKey: z.string().optional(),
  /** 群組的大小（框住選取的格子時由畫面算好）。 */
  width: z.number().positive().max(100_000).optional(),
  height: z.number().positive().max(100_000).optional(),
  /** 新節點要接到哪個既有節點的哪個連接點。 */
  from: z
    .object({
      key: z.string().min(1),
      port: z.string().min(1),
      /** 這個既有的連接點是輸出（out）還是輸入（in）。 */
      side: z.enum(['in', 'out']),
    })
    .optional(),
})
export type CanvasAdd = z.infer<typeof CanvasAddSchema>

export const CanvasAddResultSchema = z.object({
  /** 新節點的節點鍵。 */
  key: z.string(),
  /** 新節點的名字（給提示用，例如「已新增角色『新角色』」）。 */
  title: z.string(),
})
export type CanvasAddResult = z.infer<typeof CanvasAddResultSchema>

/** 可以放到畫布上的圖片與影片格式（上傳成獨立的圖片／影片格子）。 */
export const CanvasImportMimeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
])
export type CanvasImportMime = z.infer<typeof CanvasImportMimeSchema>
/** 副檔名 → 格式（從檔案總管選檔、拖進來時用）。 */
export const CANVAS_IMPORT_EXT: Readonly<Record<string, CanvasImportMime>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}
/** 拖進畫布的檔案經過 IPC 傳內容，大小有上限（從「上傳」選檔不受這個限制）。 */
export const CANVAS_IMPORT_MAX_BYTES = 200 * 1024 * 1024

/** 拖進畫布的一個檔案。 */
export const CanvasImportBytesSchema = z.object({
  name: z.string().min(1).max(260),
  mime: CanvasImportMimeSchema,
  bytes: z
    .instanceof(Uint8Array)
    .refine((b) => b.byteLength > 0, '檔案是空的')
    .refine(
      (b) => b.byteLength <= CANVAS_IMPORT_MAX_BYTES,
      '檔案太大（超過 200 MB），請改用「上傳」選檔',
    ),
  x: z.number().optional(),
  y: z.number().optional(),
})
export type CanvasImportBytes = z.infer<typeof CanvasImportBytesSchema>

/** 「上傳」：跳出選檔視窗，選好的圖片與影片各放成一格（從這個位置往右下排）。 */
export const CanvasImportFilesSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  /** 從「第一張畫面」或「參考圖」的「＋」選檔：放上第一張圖之後直接接到這裡（同一筆復原）。 */
  connectTo: z.object({ key: z.string().min(1), port: z.string().min(1) }).optional(),
})
export type CanvasImportFiles = z.infer<typeof CanvasImportFilesSchema>

export const CanvasImportResultSchema = z.object({
  added: z.array(CanvasAddResultSchema),
  /** 沒放上去的檔案與原因（格式不支援、讀不到…）。 */
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
  /** 從「＋」選檔時：接上去了（connected），或放上了但接不上的原因（notice）。 */
  connected: z.boolean().optional(),
  notice: z.string().optional(),
})
export type CanvasImportResult = z.infer<typeof CanvasImportResultSchema>

/** 一條線的兩端：節點鍵與連接點。 */
export const CanvasLinkSchema = z.object({
  source: z.object({ key: z.string().min(1), port: z.string().min(1) }),
  target: z.object({ key: z.string().min(1), port: z.string().min(1) }),
})
export type CanvasLink = z.infer<typeof CanvasLinkSchema>

/** 刪除節點：鏡頭（連同它的圖與影片）、場、角色、地點；單獨的圖或影片是清掉採用中的版本。 */
export const CanvasRemoveSchema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(500),
})
export type CanvasRemove = z.infer<typeof CanvasRemoveSchema>

export const CanvasRemoveResultSchema = z.object({ removed: z.number().int().nonnegative() })
export type CanvasRemoveResult = z.infer<typeof CanvasRemoveResultSchema>

/**
 * 貼上複製的格子（uiux-spec §12.10）：
 * - 鏡頭：在原鏡頭後面新增一鏡，帶描述、台詞、出場角色等欄位，不帶版本。
 * - 圖、影片：貼成獨立的圖片或影片（用這一鏡採用中的版本）。
 * - 角色、地點：複製一份新的（名字加「副本」），不帶定稿圖。
 * - 場：連同裡面的鏡頭（不帶版本）整場複製到最後。
 * - 自由格子（一句話、便條、群組、圖片、影片）：原樣複製。
 */
export const CanvasPasteSchema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(500),
  /** 自由格子、角色、地點要往哪裡挪（畫布座標）；場與鏡頭由自動排版放。 */
  dx: z.number().default(40),
  dy: z.number().default(40),
})
export type CanvasPaste = z.input<typeof CanvasPasteSchema>

export const CanvasPasteResultSchema = z.object({
  added: z.array(CanvasAddResultSchema),
  /** 沒辦法貼的（例如還沒有版本的圖、已經被刪掉的格子）：名字與原因。 */
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
})
export type CanvasPasteResult = z.infer<typeof CanvasPasteResultSchema>

/** 修改一句話節點的設定（只改有給的欄位）。 */
export const CanvasUpdateOnelinerSchema = z.object({
  key: z.string().min(1),
  patch: OnelinerParamsSchema.partial(),
})
export type CanvasUpdateOneliner = z.infer<typeof CanvasUpdateOnelinerSchema>

/**
 * 執行畫布上的節點：`keys` 是按了 ▶ 或選取的節點（圖、影片、鏡頭、場、剪輯）；
 * `all` 是上方列的「全部生成」（只補沒生成的，不接片）。
 */
export const CanvasRunRequestSchema = z.object({
  keys: z.array(z.string().min(1)).max(500),
  all: z.boolean().optional(),
  /**
   * 這次用哪個等級的模型（生成鈕旁的「高品質／平衡／經濟」，M2-8）；沒給就用設定裡選的。
   * 「經濟」就是「先出草稿」：滿意的鏡頭再用高品質重做。
   */
  quality: ModelTierSchema.optional(),
})
export type CanvasRunRequest = z.infer<typeof CanvasRunRequestSchema>

/** 執行計畫裡的一步：哪個節點、做什麼、是補跑還是重做。 */
export const CanvasRunStepSchema = z.object({
  /** 圖、影片或剪輯節點的節點鍵。 */
  key: z.string(),
  kind: z.enum(['image', 'video', 'cut']),
  /** 白話說明，例如「第 2 鏡：第一張畫面」。 */
  label: z.string(),
  /** true：這個節點已經有結果，這次要重做（只有直接按在已完成的圖或影片上才會這樣）。 */
  redo: z.boolean(),
  /** 重做時：現在用的是第幾版、這次會產生第幾版（舊的保留）。 */
  versions: z
    .object({ current: z.number().int().positive(), next: z.number().int().positive() })
    .optional(),
})
export type CanvasRunStep = z.infer<typeof CanvasRunStepSchema>

/** 執行之前的檢查：會跑哪些步驟、預估花費、哪些節點要標亮（「執行到這裡」）。 */
export const CanvasRunPlanSchema = z.object({
  ok: z.boolean(),
  issue: z.string().optional(),
  steps: z.array(CanvasRunStepSchema),
  /** 要標亮的那一串節點（鏡頭、圖、影片，剪輯還包括場與剪輯本身）。 */
  highlightKeys: z.array(z.string()),
  /** 會生成幾個鏡頭。 */
  shotCount: z.number().int().nonnegative(),
  /** 因為正在生成而略過的鏡頭數。 */
  skippedBusy: z.number().int().nonnegative(),
  estimatedUsd: z.number().nonnegative(),
  estimateIsLowerBound: z.boolean(),
  demoMode: z.boolean(),
  models: z.object({ image: z.string().optional(), video: z.string().optional() }),
  /** 生成完之後會自動接片（按在剪輯節點上，或「全部生成」時成品還沒接或對不上）。 */
  rejoin: z.boolean(),
  /** 接片時會接幾段（放進成品的鏡頭數）。 */
  segments: z.number().int().nonnegative().default(0),
})
export type CanvasRunPlan = z.infer<typeof CanvasRunPlanSchema>

export const CanvasRunResultSchema = z.object({
  started: z.number().int().nonnegative(),
  failed: z.array(z.object({ number: z.number().int().positive(), error: z.string() })),
})
export type CanvasRunResult = z.infer<typeof CanvasRunResultSchema>

/** 主行程在背景做完事（例如生成完自動接片）時的一行通知。 */
export const CanvasNoticeSchema = z.object({
  tone: z.enum(['success', 'danger']),
  message: z.string(),
})
export type CanvasNotice = z.infer<typeof CanvasNoticeSchema>
