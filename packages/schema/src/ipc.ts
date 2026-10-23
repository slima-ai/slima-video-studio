import { z } from 'zod'

import { LocaleSchema } from './i18n/locale'
import {
  CHARACTER_REFERENCE_LABEL_MAX,
  CharacterEditSchema,
  CharacterNameSchema,
  CharacterReferencePurposeSchema,
  CharacterVersionSchema,
  CharacterViewSchema,
  ConceptCheckSchema,
  ConceptsStateSchema,
  ReferencesStateSchema,
  TurnaroundCutsSchema,
  TurnaroundViewSchema,
  TurnaroundsStateSchema,
} from './domain/characters'
import {
  CHAT_TEXT_MAX,
  ChatConversationSchema,
  ChatEventSchema,
  ChatPanelMessageSchema,
  ChatPrereqSchema,
  ChatTitleSchema,
} from './domain/chat'
import { AspectRatioSchema, ContentHashSchema, IdSchema } from './domain/common'
import {
  OUTLINE_TEXT_MAX,
  OutlineOpSchema,
  OutlineSplitCheckSchema,
  OutlineSplitResultSchema,
  OutlineTextSchema,
  OutlineViewSchema,
} from './domain/outline'
import {
  CanvasAddResultSchema,
  CanvasAddSchema,
  CanvasLinkSchema,
  CanvasRelinkSchema,
  CanvasRemoveResultSchema,
  CanvasRemoveSchema,
  CanvasGetSchema,
  CanvasPasteSchema,
  CanvasPasteResultSchema,
  CanvasAiChangedSchema,
  CanvasNoticeSchema,
  CanvasRunChoicesRequestSchema,
  CanvasRunChoicesSchema,
  CanvasRunPlanSchema,
  CanvasRunRequestSchema,
  CanvasRunResultSchema,
  CanvasRenameSchema,
  CanvasUpdateFreeSchema,
  CanvasImportBytesSchema,
  CanvasImportFilesSchema,
  CanvasImportResultSchema,
  CanvasUpdateOnelinerSchema,
  CanvasChangedSchema,
  CanvasGraphSchema,
  CanvasMoveSchema,
  CanvasViewportSchema,
} from './domain/canvas'
import { HistoryChangedSchema, HistoryResultSchema, HistoryStateSchema } from './domain/history'
import { JobSummarySchema } from './domain/queue'
import { ShotGraphSchema } from './domain/graph'
import {
  SlimaBooksSchema,
  SlimaImportCheckSchema,
  SlimaImportRequestSchema,
  SlimaImportResultSchema,
  SlimaStatusSchema,
  SlimaTreeSchema,
} from './domain/slima'
import {
  QuickStartCheckSchema,
  QuickStyleIdSchema,
  QuickStartProgressSchema,
  QuickStartRequestSchema,
  UpgradeCheckSchema,
  UpgradeResultSchema,
} from './domain/quickstart'
import {
  LOCATION_REFERENCE_LABEL_MAX,
  LocationCardViewSchema,
  LocationReferencePurposeSchema,
  LocationReferencesStateSchema,
  LocationGenerateKindSchema,
  LocationImagesStateSchema,
} from './domain/location-cards'
import { FileRevealRequestSchema, FilesFilterSchema, FilesSnapshotSchema } from './domain/files'
import {
  RecordRedoRequestSchema,
  RecordsFilterSchema,
  RecordsSnapshotSchema,
} from './domain/records'
import {
  AppSettingsPatchSchema,
  AppSettingsSchema,
  KeyTestResultSchema,
  ModelOptionSchema,
  PickableCapabilitySchema,
} from './domain/settings'
import { SHOT_PIN_MAX, ShotReferencesStateSchema } from './domain/shot-references'
import {
  RegenerateModeSchema,
  EndFrameCheckSchema,
  ShotBatchCheckSchema,
  ShotBatchRequestSchema,
  ShotBatchResultSchema,
  ShotEditSchema,
  ShotViewSchema,
  ShotsSnapshotSchema,
  StoryboardSplitCheckSchema,
} from './domain/shots'
import {
  NARRATION_MAX_CHARS,
  SoundClipPatchSchema,
  SoundClipSchema,
  SoundPlanRequestSchema,
  SoundAnalysisSchema,
  SoundPlanSchema,
  SoundSettingsPatchSchema,
  SoundSettingsSchema,
  SoundStateSchema,
} from './domain/sound'
import { AppErrorShapeSchema, type AppErrorShape } from './errors'
import { t } from './i18n'

/** renderer 看得到的專案摘要（不包含資料庫、路徑以外的內部細節）。 */
/** AI 工具連線（MCP）的狀態（見 `mcp.status`）。 */
export const McpStatusSchema = z.object({
  enabled: z.boolean(),
  /** 伺服器真的在聽（開了、而且埠沒被佔用）。 */
  running: z.boolean(),
  port: z.number().int(),
  /** 在聽的時候才有：`http://127.0.0.1:<埠>/mcp`。 */
  url: z.string().optional(),
  /** 連線用的 token（只給設定頁顯示與複製）。 */
  token: z.string().optional(),
  /** 開了卻沒在聽的原因（例如埠被佔用）。 */
  error: z.string().optional(),
  /** AI 工具可以花的額度（美金），由人在設定頁設定。 */
  allowanceUsd: z.number().nonnegative(),
  /** 已經預留給 AI 工具的金額（美金）；額度減掉它就是還能花的。 */
  committedUsd: z.number().nonnegative(),
  /** 目前專案的帳本實收（美金，示範模式的假結果不算）；沒開專案就沒有。跟 committedUsd 不同：預留是估計，這是實際花的。 */
  spentUsd: z.number().nonnegative().optional(),
  /** 最近一次有 AI 工具帶著正確的 token 連進來（重開 App 之後清空）；畫面用它說「剛剛有人連過」。 */
  lastSeen: z
    .object({
      at: z.string(),
      /** 對方自己報的名字（MCP 的 initialize 才有，例如 claude-code）；沒帶就沒有。 */
      client: z.string().optional(),
    })
    .optional(),
})
export type McpStatus = z.infer<typeof McpStatusSchema>

/** 「連接 Claude」要用的資訊（只給設定頁；MCP 工具看不到）。 */
export const McpConnectInfoSchema = z.object({
  claudeDesktop: z.object({
    /** 這個作業系統有沒有 Claude Desktop（目前只有 macOS 與 Windows）。 */
    supported: z.boolean(),
    configPath: z.string().optional(),
    /** 看起來有裝 Claude Desktop（它的設定資料夾存在）。 */
    installed: z.boolean(),
    /** 設定檔裡已經有一項指到這個 App（而且路徑沒變）。 */
    connected: z.boolean(),
  }),
  claudeCode: z.object({
    /** 看起來有裝 Claude Code（它的設定檔或資料夾在使用者的家目錄裡）。 */
    installed: z.boolean(),
    /** 它的使用者層級設定裡已經有一項指到這個 App（而且路徑沒變）。 */
    connected: z.boolean(),
  }),
  /** 貼進 Claude Desktop 設定檔的片段（手動連線用）。 */
  desktopSnippet: z.string(),
  /** 貼進終端機的 Claude Code 指令（手動連線用）。 */
  claudeCodeCommand: z.string(),
})
export type McpConnectInfo = z.infer<typeof McpConnectInfoSchema>

export const ProjectInfoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** 專案資料夾（名稱.svsproj）的絕對路徑。 */
  dir: z.string(),
  aspectRatio: AspectRatioSchema,
})
export type ProjectInfo = z.infer<typeof ProjectInfoSchema>

/** 效能自測：產生一個 N 鏡的示範專案（uiux-spec §12.13）。 */
export const DemoSeedRequestSchema = z.object({
  shots: z.number().int().min(1).max(500).default(250),
})
export const DemoSeedResultSchema = z.object({
  project: ProjectInfoSchema,
  shots: z.number().int().nonnegative(),
  /** 建好花了幾毫秒。 */
  ms: z.number().int().nonnegative(),
})
export type DemoSeedResult = z.infer<typeof DemoSeedResultSchema>

/** 專案資料夾裡的一個專案（專案頁的清單）。 */
export const ProjectSummarySchema = z.object({
  dir: z.string(),
  name: z.string(),
  createdAt: z.string(),
  /** 最後一次修改（資料庫檔案的修改時間）。 */
  updatedAt: z.string(),
  /** 現在開著的就是它。 */
  current: z.boolean(),
})
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>

/** 「最近的專案」清單的一列：記住的是路徑與最後開啟時間，名字與修改時間是現在從資料夾讀的。 */
export const RecentProjectSchema = z.object({
  dir: z.string(),
  name: z.string(),
  /** 最後一次開啟的時間；只在預設資料夾裡、從沒在這裡開過的專案是 null。 */
  lastOpenedAt: z.string().nullable(),
  /** 最後一次寫入的時間；資料夾不見了是 null。 */
  updatedAt: z.string().nullable(),
  /** 現在開著的就是它。 */
  current: z.boolean(),
  /** 路徑已經不在（被搬走或刪掉）；清單上標「找不到」，可以從清單移除。 */
  missing: z.boolean(),
})
export type RecentProject = z.infer<typeof RecentProjectSchema>

/** 上方專案列要的：現在開著的專案，與它最後一次寫入的時間、花了多少。 */
export const ProjectStatusSchema = z.object({
  name: z.string(),
  dir: z.string(),
  /** 最後一次寫進專案的時間（資料庫與它的 -wal 檔，較新的那個）。 */
  savedAt: z.string(),
  /** 這個專案到目前為止花的錢（示範模式的假結果不算）。 */
  spentUsd: z.number().nonnegative(),
})
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>

/** 供應商 ID（小寫英數與 - _），也是 ModelCard.provider。 */
export const KeyProviderIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{1,31}$/, { error: () => t('errors.theProviderIdIsnT') })

/**
 * Key 的狀態。**這是 renderer 唯一看得到的 Key 資訊**：有沒有設定、末四碼，
 * 明文只存在主行程，任何 channel 都不會回傳。
 */
export const KeyStatusSchema = z.object({
  provider: KeyProviderIdSchema,
  configured: z.boolean(),
  /** 末四碼，只有 Key 夠長（12 碼以上）時才提供。 */
  last4: z.string().length(4).optional(),
})
export type KeyStatus = z.infer<typeof KeyStatusSchema>

export const KeyStorageInfoSchema = z.object({
  /** false 時無法儲存 Key，reason 說明原因與解法。 */
  available: z.boolean(),
  /** os：作業系統金鑰圈加密；memory：只有測試模式。 */
  kind: z.enum(['os', 'memory']),
  reason: z.string().optional(),
})
export type KeyStorageInfo = z.infer<typeof KeyStorageInfoSchema>

/**
 * IPC 合約：renderer 與主行程之間所有 channel 的 request / response / event。
 * 沒有在這裡定義的 channel 無法呼叫（preload 與主行程都會擋）。
 */
export const ipcContract = {
  'app.ping': {
    request: z.object({ message: z.string().max(200) }),
    response: z.object({ pong: z.string(), receivedAt: z.number().int() }),
  },
  /** 現在的介面語言（畫面啟動時先問一次；之後語言變了會收到 `locale.changed`）。 */
  'app.locale': {
    request: z.object({}),
    response: z.object({ locale: LocaleSchema }),
  },
  'app.getInfo': {
    request: z.object({}),
    response: z.object({
      name: z.string(),
      version: z.string(),
      platform: z.string(),
      packaged: z.boolean(),
    }),
  },
  'project.create': {
    request: z.object({ dir: z.string().min(1), name: z.string().min(1).max(200) }),
    response: ProjectInfoSchema,
  },
  'project.open': {
    request: z.object({ dir: z.string().min(1) }),
    response: ProjectInfoSchema,
  },
  'project.current': {
    request: z.object({}),
    response: ProjectInfoSchema.nullable(),
  },
  /** 目前專案的畫風與畫面比例：沒給欄位就是只讀；給了就改（之後生成的畫面會用新的設定）。 */
  'project.configure': {
    request: z.object({
      styleId: QuickStyleIdSchema.optional(),
      aspectRatio: AspectRatioSchema.optional(),
    }),
    response: z.object({ styleId: QuickStyleIdSchema, aspectRatio: AspectRatioSchema }),
  },
  'project.close': {
    request: z.object({}),
    response: z.object({}),
  },
  /** 專案資料夾裡的專案，最近修改的在前。 */
  'project.list': {
    request: z.object({}),
    response: z.object({ folder: z.string(), projects: z.array(ProjectSummarySchema) }),
  },
  /** 在專案資料夾開一個新的空專案（會先關掉目前的）。 */
  /**
   * 效能自測：開一個新的示範專案，放進 N 個鏡頭（每場 10 鏡）、5 個角色、5 個地點，每鏡都有圖和影片
   * （幾張示範素材輪流用，不呼叫模型、不花錢）。原本的專案留著。
   */
  'dev.seedDemo': {
    request: DemoSeedRequestSchema,
    response: DemoSeedResultSchema,
  },
  'project.createNew': {
    request: z.object({ name: z.string().trim().min(1).max(60).optional() }),
    response: ProjectInfoSchema,
  },
  /** 在檔案總管（Finder）顯示專案資料夾；沒給 dir 就是目前的專案。只接受清單裡的專案。 */
  'project.reveal': {
    request: z.object({ dir: z.string().min(1).optional() }),
    response: z.object({}),
  },
  /** 上方專案列：目前專案的名字、最後存檔時間、花費；沒開專案是 null。只給畫面用，不開放給 MCP。 */
  'project.status': {
    request: z.object({}),
    response: ProjectStatusSchema.nullable(),
  },
  /**
   * 新專案：名字，加上（可選）放在哪個資料夾；沒給就放在預設的專案資料夾。會先關掉目前的。
   * 只給畫面用，不開放給 MCP：`project.createNew` 在 MCP 白名單裡，不能讓 AI 把專案建在硬碟任何地方。
   */
  'project.createAt': {
    request: z.object({
      name: z.string().trim().min(1).max(60),
      parentDir: z.string().min(1).optional(),
    }),
    response: ProjectInfoSchema,
  },
  /** 跳出選資料夾的視窗（給「新專案」的「更改…」）；取消回 null。只給畫面用，不開放給 MCP。 */
  'project.pickFolder': {
    request: z.object({}),
    response: z.object({ dir: z.string().nullable() }),
  },
  /**
   * 另存為：把目前的專案（含素材）複製成另一份，名字與（可選的）存放資料夾照給的，然後切過去開那一份；
   * 原本的留在原處。只給畫面用，不開放給 MCP。
   */
  'project.saveAs': {
    request: z.object({
      name: z.string().trim().min(1).max(60),
      parentDir: z.string().min(1).optional(),
    }),
    response: ProjectInfoSchema,
  },
  /** 最近的專案（最多 10 個，包含放在預設資料夾以外的）。只給畫面用，不開放給 MCP。 */
  'project.recent': {
    request: z.object({}),
    response: z.object({ projects: z.array(RecentProjectSchema) }),
  },
  /** 打開「最近的專案」清單裡的一個（只接受清單裡的路徑）。只給畫面用，不開放給 MCP。 */
  'project.openRecent': {
    request: z.object({ dir: z.string().min(1) }),
    response: ProjectInfoSchema,
  },
  /** 把一個（找不到的）專案從「最近的專案」清單移掉；不動硬碟上的東西。只給畫面用，不開放給 MCP。 */
  'project.forgetRecent': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({}),
  },
  /** 跳出選資料夾的視窗，選一個舊專案打開；取消回 null，選的不是專案就說明。只給畫面用，不開放給 MCP。 */
  'project.pickAndOpen': {
    request: z.object({}),
    response: ProjectInfoSchema.nullable(),
  },
  /** 開 App 時先到哪一頁：沒有專案可以接就到首頁，否則畫布。只給畫面用，不開放給 MCP。 */
  'app.startView': {
    request: z.object({}),
    response: z.object({ view: z.enum(['home', 'canvas']) }),
  },
  /** 改目前專案的名字（專案資料夾的名字不變）。只給畫面用，不開放給 MCP。 */
  'project.rename': {
    request: z.object({ name: z.string().trim().min(1).max(60) }),
    response: ProjectInfoSchema,
  },
  'keys.list': {
    request: z.object({}),
    response: z.object({ keys: z.array(KeyStatusSchema), storage: KeyStorageInfoSchema }),
  },
  'keys.set': {
    request: z.object({
      provider: KeyProviderIdSchema,
      key: z.string().min(1).max(600),
    }),
    response: KeyStatusSchema,
  },
  'keys.delete': {
    request: z.object({ provider: KeyProviderIdSchema }),
    response: KeyStatusSchema,
  },
  /** 用已儲存的 Key 向供應商確認是否有效（會送出一次網路請求）。 */
  'keys.test': {
    request: z.object({ provider: KeyProviderIdSchema }),
    response: KeyTestResultSchema,
  },
  /** Slima 連線狀態（不含 Token 本身）。 */
  'slima.status': {
    request: z.object({}),
    response: SlimaStatusSchema,
  },
  /** 存下 Slima API Token 並連線。Token 只會存進金鑰庫，不會回傳。 */
  'slima.connect': {
    request: z.object({ token: z.string().min(1).max(600) }),
    response: SlimaStatusSchema,
  },
  /** 清除 Token 並中斷連線。 */
  'slima.disconnect': {
    request: z.object({}),
    response: SlimaStatusSchema,
  },
  /** 列出 Slima 資料庫裡的書（唯讀）。 */
  'slima.books': {
    request: z.object({}),
    response: SlimaBooksSchema,
  },
  /** 一個鏡頭的生成流程圖與最近一次生成的結果（節點圖，唯讀）。 */
  'graph.shot': {
    request: z.object({ shotId: z.string().min(1) }),
    response: ShotGraphSchema,
  },
  /** 畫布（首頁）：把幕、場、鏡頭、版本、角色、地點與自由節點投影成節點與連線，沒存過位置的自動排版。 */
  'canvas.get': {
    request: CanvasGetSchema,
    response: CanvasGraphSchema,
  },
  /** 把一批節點移到新位置（整串一起拖就是一串）。可以復原。 */
  'canvas.move': {
    request: CanvasMoveSchema,
    response: z.object({}),
  },
  /**
   * 從畫布新增場、鏡頭、角色或地點（寫進原本的表）；從連接點新增時順便接上。
   * 可以復原（新增角色本身不記進歷史，因為角色有自己的版本管理）。
   */
  'canvas.add': {
    request: CanvasAddSchema,
    response: CanvasAddResultSchema,
  },
  /**
   * 拉線：角色→鏡頭的出場角色、地點→場或鏡頭的地點，寫回原本的表。
   * 接不起來、已經接了或這裡已經有地點時丟白話錯誤。可以復原。
   */
  'canvas.link': {
    request: CanvasLinkSchema,
    response: z.object({}),
  },
  /**
   * 改接：把一條線換成另一條（拖線的一端接到別處，或新線取代原本的線），算同一筆復原。
   * 新的接不上就把原本的接回去，什麼都不會變（丟白話錯誤）。
   */
  'canvas.relink': {
    request: CanvasRelinkSchema,
    response: z.object({}),
  },
  /** 剪線：反過來把關係拿掉（鏡頭少一個出場角色、場或鏡頭不再指到地點）。可以復原。 */
  'canvas.unlink': {
    request: CanvasLinkSchema,
    response: z.object({}),
  },
  /**
   * 刪除節點：鏡頭連同它的圖與影片、場（鏡頭留著只是不分場）、角色、地點；
   * 單獨刪圖或影片是清掉這一鏡採用中的版本（版本還在生成紀錄裡）。
   * 鏡頭、場、地點可以復原；角色不在復原歷史裡，刪了就沒了（畫面要先確認）。
   */
  'canvas.remove': {
    request: CanvasRemoveSchema,
    response: CanvasRemoveResultSchema,
  },
  /** 貼上複製的格子（依種類各自處理，見 `CanvasPasteSchema`）。整批算一步復原。 */
  'canvas.paste': {
    request: CanvasPasteSchema,
    response: CanvasPasteResultSchema,
  },
  /** 「上傳」：跳出選檔視窗，選好的圖片、影片各放成一格獨立的格子（取消就什麼都不加）。可以復原。 */
  'canvas.importFiles': {
    request: CanvasImportFilesSchema,
    response: CanvasImportResultSchema,
  },
  /** 拖進畫布的圖片或影片：存進專案的素材，放成一格獨立的格子。可以復原。 */
  'canvas.importBytes': {
    request: CanvasImportBytesSchema,
    response: CanvasImportResultSchema,
  },
  /** 改便條的字、群組的名字／顏色／大小（自由節點）。可以復原。 */
  'canvas.updateFree': {
    request: CanvasUpdateFreeSchema,
    response: z.object({}),
  },
  /** 改名（F2）：場的標題、角色或地點的名字、群組的名字；其他格子不能改名（丟白話錯誤）。可以復原。 */
  'canvas.rename': {
    request: CanvasRenameSchema,
    response: z.object({}),
  },
  /** 改一句話節點的設定（故事、畫風、鏡頭數…）。可以復原。 */
  'canvas.updateOneliner': {
    request: CanvasUpdateOnelinerSchema,
    response: z.object({}),
  },
  /** 執行之前的檢查：這次會跑哪些節點、預估花費、要標亮哪一串。 */
  'canvas.runPlan': {
    request: CanvasRunRequestSchema,
    response: CanvasRunPlanSchema,
  },
  /** 「全部生成」旁邊三種做法（只補空的／重跑需要重跑的／全部重新生成）各自動幾鏡、多少錢。 */
  'canvas.runChoices': {
    request: CanvasRunChoicesRequestSchema,
    response: CanvasRunChoicesSchema,
  },
  /** 執行：補跑還沒有結果的節點（已經有結果的不重跑），在背景進行。 */
  'canvas.run': {
    request: CanvasRunRequestSchema,
    response: CanvasRunResultSchema,
  },
  /** 記住視角（平移、縮放之後）。不算編輯，不進復原歷史。 */
  /** 整理：拖過的場、鏡頭、角色、地點、剪輯回到自動排版（一句話這類自由方塊不動）。可以復原。 */
  'canvas.tidy': {
    request: z.object({}),
    response: z.object({ reset: z.number().int().nonnegative() }),
  },
  'canvas.viewport': {
    request: CanvasViewportSchema,
    response: z.object({}),
  },
  /** 生成紀錄：最近的生成，每筆有 prompt、模型、耗時、花費與結果（唯讀）。 */
  'records.list': {
    request: RecordsFilterSchema,
    response: RecordsSnapshotSchema,
  },
  /** 用某一筆紀錄的 prompt（或改過的）重新生成它所屬的鏡頭；在背景進行，進度用 shots.changed 推送。 */
  'records.redo': {
    request: RecordRedoRequestSchema,
    response: z.object({ shotId: z.string() }),
  },
  /** 專案裡的所有檔案（圖片、影片）、各自用在哪裡，以及匯出的成品（唯讀）。 */
  'files.list': {
    request: FilesFilterSchema,
    response: FilesSnapshotSchema,
  },
  /** 在檔案總管（Finder）中顯示某個檔案。 */
  'files.reveal': {
    request: FileRevealRequestSchema,
    response: z.object({}),
  },
  /** 一本書裡可以匯入的檔案（唯讀）。 */
  'slima.tree': {
    request: z.object({ bookToken: z.string().min(1) }),
    response: SlimaTreeSchema,
  },
  /** 匯入前的檢查：會建立什麼、預估花費、會不會換掉大綱。 */
  'slima.importCheck': {
    request: SlimaImportRequestSchema,
    response: SlimaImportCheckSchema,
  },
  /** 把選好的檔案匯入成大綱、角色與場景。 */
  'slima.import': {
    request: SlimaImportRequestSchema,
    response: SlimaImportResultSchema,
  },
  'settings.get': {
    request: z.object({}),
    response: AppSettingsSchema,
  },
  'settings.update': {
    request: AppSettingsPatchSchema,
    response: AppSettingsSchema,
  },
  /**
   * AI 工具連線（MCP）的狀態：有沒有在聽、網址、連線用的 token、額度與已預留的金額。
   * 只給 App 自己的畫面用（設定頁要顯示可複製的連線指令）；MCP 的工具看不到也改不了這幾項。
   */
  'mcp.status': {
    request: z.object({}),
    response: McpStatusSchema,
  },
  /** 換一組新的連線 token（舊的立刻失效）。 */
  'mcp.regenerateToken': {
    request: z.object({}),
    response: McpStatusSchema,
  },
  /** 把「已預留」的金額歸零（人決定重新開始算額度）。 */
  'mcp.resetCommitted': {
    request: z.object({}),
    response: McpStatusSchema,
  },
  /** 「連接 Claude」要用的資訊：設定檔位置、已連接與否、可複製的片段與指令。 */
  'mcp.connectInfo': {
    request: z.object({}),
    response: McpConnectInfoSchema,
  },
  /**
   * 一鍵連接 Claude Desktop：把這個 App 的轉接加進它的設定檔（只加我們這一項，改之前先備份）。
   * 要重開 Claude Desktop 才生效。
   */
  'mcp.connectClaudeDesktop': {
    request: z.object({}),
    response: z.object({ configPath: z.string(), backupPath: z.string().optional() }),
  },
  /** 一鍵連接 Claude Code：在使用者的終端機環境裡執行 `claude mcp add`；跑不起來就丟白話錯誤。 */
  'mcp.connectClaudeCode': {
    request: z.object({}),
    response: z.object({ command: z.string() }),
  },
  /**
   * 目前可以選的模型：已填 Key 的供應商（示範模式再加上示範模型）。
   * `selected` 是每種用途實際會用的模型（使用者選的，沒選就是推薦的；沒有可用的模型就沒有）。
   */
  'models.list': {
    request: z.object({}),
    response: z.object({
      models: z.array(ModelOptionSchema),
      selected: z.partialRecord(PickableCapabilitySchema, z.string()),
      /** 每個旁白模型（管道 id）目前用的聲音；沒選的是卡上的第一個。 */
      voices: z.record(z.string(), z.string()).default({}),
      /** 還沒填金鑰、不能用的模型（選單上灰色，寫要填哪家的金鑰）；示範模式沒有。 */
      locked: z.array(ModelOptionSchema).default([]),
      /**
       * 開著的專案自己指定的模型（每種用途實際會走的管道 id）；沒指定、或指定的現在不能用，
       * 就跟著 App 設定（selected）。沒開專案時是 null。
       */
      project: z
        .object({
          name: z.string(),
          models: z.partialRecord(PickableCapabilitySchema, z.string()),
        })
        .nullable()
        .default(null),
    }),
  },
  /** 設定這個專案預設用的模型（逐項合併，null 表示改回跟著 App 設定）。要先開專案。 */
  'models.setProject': {
    request: z.object({
      models: z.partialRecord(PickableCapabilitySchema, z.string().min(1).nullable()),
    }),
    response: z.object({}),
  },
  /** 取走還沒說過的模型通知（例如選的模型下架、自動換成別的）；取完就清掉。 */
  'models.notices': {
    request: z.object({}),
    response: z.object({ notices: z.array(z.string()) }),
  },
  /** 目前專案最近的生成任務（由舊到新）。沒有開啟專案時是空的。 */
  'queue.list': {
    request: z.object({}),
    response: z.object({ jobs: z.array(JobSummarySchema) }),
  },
  'queue.cancel': {
    request: z.object({ jobId: z.string().min(1) }),
    response: JobSummarySchema,
  },
  /** 重新送出失敗或已取消的任務。 */
  'queue.retry': {
    request: z.object({ jobId: z.string().min(1) }),
    response: JobSummarySchema,
  },
  /** 按「生成」前的檢查：缺什麼設定、預估花費、會用哪些模型。不會花錢。 */
  'quickstart.check': {
    request: QuickStartRequestSchema,
    response: QuickStartCheckSchema,
  },
  /** 開始生成（在背景執行，進度用 quickstart.progress 事件推送）。沒有開啟專案時會自動建立一個。 */
  'quickstart.run': {
    request: QuickStartRequestSchema,
    response: z.object({ runId: z.string() }),
  },
  'quickstart.cancel': {
    request: z.object({}),
    response: z.object({}),
  },
  /** 最近一次生成的進度（重新整理畫面時用）；還沒生成過就是 null。 */
  'quickstart.state': {
    request: z.object({}),
    response: QuickStartProgressSchema.nullable(),
  },
  /** 把快速開始的結果升級成專案之前：會建立大綱、分鏡表和哪些草稿角色卡。 */
  'quickstart.upgradeCheck': {
    request: z.object({}),
    response: UpgradeCheckSchema,
  },
  /** 升級成專案：建立大綱（一幕一場）、把鏡頭放進去、替出場的角色建草稿角色卡並從畫面挑主圖。已生成的內容全部保留。 */
  'quickstart.upgrade': {
    request: z.object({}),
    response: UpgradeResultSchema,
  },

  /** 把接好的影片複製到專案的 exports 資料夾。 */
  'quickstart.export': {
    /** credits（預設 true）：片尾接一張「用了哪些 AI 服務」的字卡，只加在匯出的檔案上。 */
    request: z.object({ credits: z.boolean().optional() }),
    response: z.object({ path: z.string(), credits: z.boolean() }),
  },
  /** 目前專案的所有鏡頭，連同每個鏡頭的各個版本。 */
  'shots.list': {
    request: z.object({}),
    response: ShotsSnapshotSchema,
  },
  /** 修改鏡頭的描述、運鏡、秒數或 Prompt（只存起來，不會自動重新生成）。 */
  'shots.update': {
    request: z.object({ shotId: IdSchema, patch: ShotEditSchema }),
    response: ShotViewSchema,
  },
  /** 這一鏡的參考圖現況：實際會帶進去的、可以挑的、最多幾張。 */
  'shots.references': {
    request: z.object({ shotId: IdSchema }),
    response: ShotReferencesStateSchema,
  },
  /**
   * 手動指定這一鏡要帶哪幾張參考圖（依序；只能挑 shots.references 的 candidates，張數不超過 limit）。
   * 傳空陣列＝恢復自動挑。指定了就只帶這幾張，第一張畫面會變成需要重新生成。可以復原。
   */
  'shots.setReferences': {
    request: z.object({
      shotId: IdSchema,
      assetHashes: z.array(ContentHashSchema).max(SHOT_PIN_MAX),
    }),
    response: ShotReferencesStateSchema,
  },
  /**
   * 指定這一鏡的尾幀（影片最後一格要長成這張圖；只能是專案裡已有的圖）。assetHash 傳 null＝拿掉尾幀。
   * 只有接受尾幀的影片模型才會送；影片會變成需要重新生成。可以復原。
   */
  'shots.setEndFrame': {
    request: z.object({ shotId: IdSchema, assetHash: ContentHashSchema.nullable() }),
    response: ShotViewSchema,
  },
  /** 用首幀改圖生尾幀之前的檢查：能不能開始、預估花費、用哪個模型、會帶哪些參考圖。不花錢。 */
  'shots.endFrameCheck': {
    request: z.object({ shotId: IdSchema }),
    response: EndFrameCheckSchema,
  },
  /**
   * 用這一鏡採用中的首幀（加出場角色的主圖）改圖，生成「同一個鏡位、幾秒後」的尾幀，存成這一鏡的尾幀。
   * 在背景做；預估超過上限、沒有首幀、沒有寫尾幀描述等問題會直接丟出白話錯誤。可以復原。
   */
  'shots.generateEndFrame': {
    request: z.object({ shotId: IdSchema }),
    response: z.object({ started: z.literal(true) }),
  },
  /** 重新生成一個鏡頭（在背景執行，進度用 shots.changed 事件推送）。 */
  'shots.regenerate': {
    request: z.object({ shotId: IdSchema, mode: RegenerateModeSchema }),
    response: z.object({}),
  },
  /** 批次生成之前：略過哪些、整批預估花費、能不能開始。 */
  'shots.batchCheck': {
    request: ShotBatchRequestSchema,
    response: ShotBatchCheckSchema,
  },
  /** 一次生成多個鏡頭（每個鏡頭各自在背景跑，某一鏡沒辦法開始不影響其他鏡）。 */
  'shots.generateBatch': {
    request: ShotBatchRequestSchema,
    response: ShotBatchResultSchema,
  },
  /** 取消這個鏡頭正在進行的重新生成。 */
  'shots.cancel': {
    request: z.object({ shotId: IdSchema }),
    response: z.object({}),
  },
  /** 改用另一個版本（首幀圖或影片）。 */
  'shots.adopt': {
    request: z.object({ takeId: IdSchema }),
    response: ShotViewSchema,
  },
  /** 新增一個空的鏡頭；有指定 afterShotId 就放在它後面，否則放最後。 */
  'shots.create': {
    request: z.object({
      sceneId: IdSchema.optional(),
      afterShotId: IdSchema.optional(),
    }),
    response: ShotViewSchema,
  },
  /** 刪除鏡頭（連同它們生成過的版本），剩下的鏡頭重新編號。 */
  'shots.delete': {
    request: z.object({ shotIds: z.array(IdSchema).min(1) }),
    response: ShotsSnapshotSchema,
  },
  /** 依傳入的順序重新排列所有鏡頭（必須包含全部鏡頭）。 */
  'shots.reorder': {
    request: z.object({ orderedIds: z.array(IdSchema) }),
    response: ShotsSnapshotSchema,
  },
  /** 把幾個鏡頭歸進一個場（沒給場就放最後一個場，一個場都沒有就先建一個）。畫布上「沒歸場的鏡頭」用。 */
  'shots.assignScene': {
    request: z.object({ shotIds: z.array(IdSchema).min(1), sceneId: IdSchema.optional() }),
    response: ShotsSnapshotSchema,
  },
  /** 讓 AI 替某個場拆鏡頭之前的檢查與預估花費。 */
  'storyboard.splitCheck': {
    request: z.object({ sceneId: IdSchema }),
    response: StoryboardSplitCheckSchema,
  },
  /** 讓 AI 把某個場拆成鏡頭（這個場原本的鏡頭會被換掉）。回傳新的鏡頭清單。 */
  'storyboard.splitScene': {
    request: z.object({ sceneId: IdSchema }),
    response: ShotsSnapshotSchema,
  },
  /** 用各鏡頭目前採用的影片重新接成一支完整影片。 */
  'shots.rejoin': {
    request: z.object({}),
    response: z.object({ videoHash: z.string() }),
  },
  // ---- 聲音（sound.*）：studio 2 負責，新增的通道都加在這一段 ----
  /** 目前專案的聲音：每鏡的時間位置、旁白、配樂、設定與警示。 */
  'sound.get': {
    request: z.object({}),
    response: SoundStateSchema,
  },
  /** 生成之前的預估花費與檢查（不花錢）。 */
  'sound.plan': {
    request: SoundPlanRequestSchema,
    response: SoundPlanSchema,
  },
  /** 為一鏡生旁白（沒給文字就念鏡頭的台詞，沒給聲音就用設定裡選的）。會花錢。 */
  'sound.generateNarration': {
    request: z.object({
      shotId: IdSchema,
      text: z.string().max(NARRATION_MAX_CHARS).optional(),
      voiceId: z.string().min(1).optional(),
    }),
    response: z.object({ clip: SoundClipSchema }),
  },
  /** 生一首配樂（沒給描述就依風格與場景情緒組一段，永遠是純音樂）。會花錢。 */
  'sound.generateMusic': {
    request: z.object({
      prompt: z.string().min(1).max(2000).optional(),
      durationSec: z.number().positive().optional(),
    }),
    response: z.object({ clip: SoundClipSchema }),
  },
  /** 調整一個片段的起點、增益、淡入淡出（不花錢）；給 null 改回預設。 */
  'sound.updateClip': {
    request: z.object({ clipId: IdSchema, patch: SoundClipPatchSchema }),
    response: z.object({ clip: SoundClipSchema }),
  },
  /** 把某個版本設為採用中。 */
  'sound.adoptClip': {
    request: z.object({ clipId: IdSchema }),
    response: z.object({ clip: SoundClipSchema }),
  },
  'sound.removeClip': {
    request: z.object({ clipId: IdSchema }),
    response: z.object({}),
  },
  /**
   * 刪掉旁白或配樂（畫面上的刪除鈕）：這一類的全部版本一起刪（畫面上只看得到採用中的那一個）。
   * 旁白不給 shotId 是全部鏡頭的旁白；鏡頭的台詞不受影響。記進復原歷史，一步就能整個找回來。
   */
  'sound.remove': {
    request: z.object({ kind: z.enum(['narration', 'music']), shotId: IdSchema.optional() }),
    response: z.object({ removed: z.number().int().min(0) }),
  },
  /** 量最新成品的聲音：響度、峰值、每鏡音量、安靜的段落與白話警示（不花錢）。 */
  'sound.analyze': {
    request: z.object({}),
    response: SoundAnalysisSchema,
  },
  /** 把聲音混進最新的成品（不花錢、不用重新接片），存成新的成品版本。 */
  'sound.mix': {
    request: z.object({}),
    response: z.object({ videoHash: z.string(), version: z.number().int().positive() }),
  },
  /** 聲音設定（逐項合併）：原聲開關與增益、哪幾鏡靜音原聲、旁白壓低、配樂增益。 */
  'sound.updateSettings': {
    request: SoundSettingsPatchSchema,
    response: SoundSettingsSchema,
  },
  /** 目前專案的大綱（沒有開啟專案就是空的）。 */
  'outline.get': {
    request: z.object({}),
    response: OutlineViewSchema,
  },
  /** 修改大綱（新增、編輯、刪除、調整順序），回傳修改後的整份大綱。 */
  'outline.edit': {
    request: OutlineOpSchema,
    response: OutlineViewSchema,
  },
  /** 讓 AI 把貼上的文字拆成分場之前的檢查與預估花費。 */
  'outline.splitCheck': {
    request: z.object({ text: z.string().max(OUTLINE_TEXT_MAX * 2) }),
    response: OutlineSplitCheckSchema,
  },
  /** 讓 AI 把文字拆成「幕 → 場」，並抽出角色（草稿）與地點。已有大綱會整份換掉。 */
  'outline.split': {
    request: z.object({ text: OutlineTextSchema }),
    response: OutlineSplitResultSchema,
  },
  /** 大綱與分鏡表目前能不能復原／重做。 */
  'history.state': {
    request: z.object({}),
    response: HistoryStateSchema,
  },
  /** 復原最近一個大綱或分鏡表的編輯（新增、修改、排序、刪除）。 */
  'history.undo': {
    request: z.object({}),
    response: HistoryResultSchema,
  },
  'history.redo': {
    request: z.object({}),
    response: HistoryResultSchema,
  },
  /** 目前專案的角色（沒有開啟專案就是空的）。 */
  'characters.list': {
    request: z.object({}),
    response: z.object({ characters: z.array(CharacterViewSchema) }),
  },
  /** 新增角色；沒有開啟專案時會自動建立一個。 */
  'characters.create': {
    request: z.object({ name: CharacterNameSchema }),
    response: CharacterViewSchema,
  },
  'characters.update': {
    request: z.object({ characterId: IdSchema, patch: CharacterEditSchema }),
    response: CharacterViewSchema,
  },
  'characters.delete': {
    request: z.object({ characterId: IdSchema }),
    response: z.object({}),
  },
  /** 請 AI 把長相和服裝整理成一段固定、精簡的外觀描述（只回傳建議，不會存起來）。 */
  'characters.suggestAnchor': {
    request: z.object({ characterId: IdSchema }),
    response: z.object({ text: z.string() }),
  },
  /** 存固定外觀描述。已鎖定的角色改了就變成下一版的草稿。 */
  'characters.setAnchor': {
    request: z.object({ characterId: IdSchema, text: z.string().max(1000) }),
    response: CharacterViewSchema,
  },
  /** 這個角色的概念圖與生成進度。 */
  'characters.concepts': {
    request: z.object({ characterId: IdSchema }),
    response: ConceptsStateSchema,
  },
  /** 生成概念圖之前的檢查與預估花費。 */
  'characters.conceptCheck': {
    request: z.object({ characterId: IdSchema }),
    response: ConceptCheckSchema,
  },
  /** 這個角色的參考圖清單（每張有用途標記）。 */
  'characters.references': {
    request: z.object({ characterId: IdSchema }),
    response: ReferencesStateSchema,
  },
  /**
   * 把專案裡已有的一張圖片加成這個角色的參考圖，並標上用途（臉、身體、三視圖……）；
   * 之後生成概念圖會照它們畫。同一張圖同一個用途只會有一筆。回傳更新後的清單。可以復原。
   */
  'characters.addReference': {
    request: z.object({
      characterId: IdSchema,
      assetHash: ContentHashSchema,
      purpose: CharacterReferencePurposeSchema.default('general'),
      label: z.string().max(CHARACTER_REFERENCE_LABEL_MAX).default(''),
    }),
    response: ReferencesStateSchema,
  },
  /** 移除一張用「加參考圖」存的參考圖（圖本身留在專案裡）。回傳更新後的清單。可以復原。 */
  'characters.removeReference': {
    request: z.object({ characterId: IdSchema, referenceId: IdSchema }),
    response: ReferencesStateSchema,
  },
  /** 生成新的一輪概念圖（在背景執行，進度用 characters.conceptsChanged 事件推送）。 */
  'characters.generateConcepts': {
    request: z.object({ characterId: IdSchema }),
    response: z.object({}),
  },
  'characters.cancelConcepts': {
    request: z.object({ characterId: IdSchema }),
    response: z.object({}),
  },
  /** 這個角色的三視圖候選與生成進度。 */
  'characters.turnarounds': {
    request: z.object({ characterId: IdSchema }),
    response: TurnaroundsStateSchema,
  },
  /** 生成三視圖之前的檢查與預估花費（要先挑好主圖）。 */
  'characters.turnaroundCheck': {
    request: z.object({ characterId: IdSchema }),
    response: ConceptCheckSchema,
  },
  /** 生成新的一輪三視圖（背景執行，進度用 characters.turnaroundsChanged 事件推送）。 */
  'characters.generateTurnarounds': {
    request: z.object({ characterId: IdSchema }),
    response: z.object({}),
  },
  'characters.cancelTurnarounds': {
    request: z.object({ characterId: IdSchema }),
    response: z.object({}),
  },
  /** 調整切線位置，用同一張設定稿重新切。 */
  'characters.reslice': {
    request: z.object({
      characterId: IdSchema,
      turnaroundId: IdSchema,
      cuts: TurnaroundCutsSchema,
    }),
    response: TurnaroundViewSchema,
  },
  /** 採用一組三視圖。 */
  'characters.adoptTurnaround': {
    request: z.object({ characterId: IdSchema, turnaroundId: IdSchema }),
    response: CharacterViewSchema,
  },
  /** 把一張概念圖挑成主圖。 */
  'characters.pickHero': {
    request: z.object({ characterId: IdSchema, conceptId: IdSchema }),
    response: CharacterViewSchema,
  },
  /** 所有版本（新的在前），含各版的固定外觀描述、主圖與三視圖。 */
  'characters.versions': {
    request: z.object({ characterId: IdSchema }),
    response: z.object({ versions: z.array(CharacterVersionSchema) }),
  },
  /** 以某個舊版本的內容開一個新的草稿版本（舊版本都保留）。 */
  'characters.restoreVersion': {
    request: z.object({ characterId: IdSchema, versionId: IdSchema }),
    response: CharacterViewSchema,
  },
  /** 鎖定固定外觀描述（不能是空的）。 */
  'characters.lock': {
    request: z.object({ characterId: IdSchema }),
    response: CharacterViewSchema,
  },

  // ── 場景卡 ──

  /** 所有場景卡（每個地點一張）。 */
  'locations.list': {
    request: z.object({}),
    response: z.object({ locations: z.array(LocationCardViewSchema) }),
  },
  /** 寫下（或修改）固定的場景描述；已鎖定的場景卡不能改。 */
  'locations.setAnchor': {
    request: z.object({ locationId: IdSchema, text: z.string() }),
    response: LocationCardViewSchema,
  },
  /** 某張場景卡的概念圖與目前的生成進度。 */
  'locations.images': {
    request: z.object({ locationId: IdSchema }),
    response: LocationImagesStateSchema,
  },
  /** 生成之前的檢查與預估花費（概念圖 4 張，或另外兩個角度）。 */
  'locations.check': {
    request: z.object({ locationId: IdSchema, kind: LocationGenerateKindSchema }),
    response: ConceptCheckSchema,
  },
  /** 開始生成（背景執行，進度用 locations.imagesChanged 事件推送）。 */
  'locations.generate': {
    request: z.object({ locationId: IdSchema, kind: LocationGenerateKindSchema }),
    response: z.object({}),
  },
  'locations.cancel': {
    request: z.object({ locationId: IdSchema }),
    response: z.object({}),
  },
  /** 把一張概念圖挑成主場景圖（原本的另外兩個角度會清掉）。 */
  'locations.pickMain': {
    request: z.object({ locationId: IdSchema, conceptId: IdSchema }),
    response: LocationCardViewSchema,
  },
  /** 鎖定場景卡：要有固定描述和主場景圖，之後用到這個地點的鏡頭會自動帶入。 */
  'locations.lock': {
    request: z.object({ locationId: IdSchema }),
    response: LocationCardViewSchema,
  },
  'locations.unlock': {
    request: z.object({ locationId: IdSchema }),
    response: LocationCardViewSchema,
  },
  /** 這張場景卡的參考圖清單（每張有用途標記：主景、反方向、拉遠全景、俯視、縱深感、一般）。 */
  'locations.references': {
    request: z.object({ locationId: IdSchema }),
    response: LocationReferencesStateSchema,
  },
  /**
   * 把專案裡已有的一張圖片加成這張場景卡的參考圖，並標上用途；同一張圖同一個用途只會有一筆。
   * 已鎖定的場景卡要先解除鎖定。回傳更新後的清單。可以復原。
   */
  'locations.addReference': {
    request: z.object({
      locationId: IdSchema,
      assetHash: ContentHashSchema,
      purpose: LocationReferencePurposeSchema.default('general'),
      label: z.string().max(LOCATION_REFERENCE_LABEL_MAX).default(''),
    }),
    response: LocationReferencesStateSchema,
  },
  /** 移除一張另外加的參考圖（圖本身留在專案裡）。回傳更新後的清單。可以復原。 */
  'locations.removeReference': {
    request: z.object({ locationId: IdSchema, referenceId: z.string().min(1) }),
    response: LocationReferencesStateSchema,
  },
  /**
   * 右下角 Claude 對話（實驗功能）。以下 `chat.*` 都只給畫面用，不開放給 MCP：
   * Claude 自己是透過 MCP 在改專案，不能再叫它去開別的對話。
   * 現在能不能開始：功能開關、AI 工具連線、有沒有裝 Claude Code、版本、有沒有登入。
   */
  'chat.status': {
    // fresh 預設 true（重新檢查）；第一次打開面板傳 false，用預熱好的結果
    request: z.object({ fresh: z.boolean().optional() }),
    response: ChatPrereqSchema,
  },
  'chat.list': {
    request: z.object({}),
    response: z.object({ conversations: z.array(ChatConversationSchema) }),
  },
  'chat.create': {
    request: z.object({}),
    response: ChatConversationSchema,
  },
  'chat.rename': {
    request: z.object({ conversationId: z.uuid(), title: ChatTitleSchema }),
    response: ChatConversationSchema,
  },
  'chat.messages': {
    request: z.object({ conversationId: z.uuid() }),
    response: z.object({ messages: z.array(ChatPanelMessageSchema) }),
  },
  /** 送一則訊息；Claude 的回覆用 `chat.event` 一路推過來。這個對話已經有一輪在進行就說明稍等。 */
  'chat.send': {
    request: z.object({
      conversationId: z.uuid(),
      text: z.string().trim().min(1).max(CHAT_TEXT_MAX),
    }),
    response: z.object({}),
  },
  /** 停止這一輪（停止鈕、Esc）：已經送出去的生成任務不會跟著取消。 */
  'chat.stop': {
    request: z.object({ conversationId: z.uuid() }),
    response: z.object({}),
  },
} as const

/** 視窗上方選單（macOS）選了哪一項：畫面收到就做同一件事（跟專案列的選單、快捷鍵是同一批動作）。 */
export const MenuActionSchema = z.object({
  action: z.enum(['new', 'open', 'openRecent', 'save', 'saveAs', 'rename', 'reveal', 'home']),
  /** 只有 openRecent 有：要打開的專案資料夾（畫面會用 project.openRecent，只接受最近清單裡的）。 */
  dir: z.string().optional(),
})
export type MenuAction = z.infer<typeof MenuActionSchema>

/** 主行程主動推給 renderer 的事件。 */
export const ipcEvents = {
  'app.pinged': z.object({ message: z.string(), receivedAt: z.number().int() }),
  /** 介面語言變了（設定改了、或跟著系統的結果變了）：畫面換語言並重畫。 */
  'locale.changed': z.object({ locale: LocaleSchema }),
  /** 某個任務的狀態改變了（新增、進度、完成、失敗…）。 */
  'queue.changed': JobSummarySchema,
  /** 換了專案（或關閉專案）：任務清單要重新載入。 */
  'queue.reset': z.object({}),
  /** 快速開始的進度有變動（完整快照）。 */
  'quickstart.progress': QuickStartProgressSchema,
  /** 鏡頭或版本有變動（完整快照）。 */
  'shots.changed': ShotsSnapshotSchema,
  /** 聲音有變動（新的旁白、配樂、調整或設定；完整快照）。 */
  'sound.changed': SoundStateSchema,
  /** 某個角色的概念圖有變動（完整快照）。 */
  'characters.conceptsChanged': ConceptsStateSchema,
  /** 某個角色的三視圖候選有變動（完整快照）。 */
  'characters.turnaroundsChanged': TurnaroundsStateSchema,
  /** 某張場景卡的概念圖有變動（完整快照）。 */
  'locations.imagesChanged': LocationImagesStateSchema,
  /** 角色有變動（新增、改名、外觀、鎖定、主圖、刪除，或復原／重做）：角色頁與畫布重新讀。 */
  'characters.changed': z.object({}),
  /** 地點或場景卡有變動：地點頁與畫布重新讀。 */
  'locations.changed': z.object({}),
  /** 大綱（幕、場、地點名稱）有變動：大綱頁、分鏡表與畫布重新讀。 */
  'outline.changed': z.object({}),
  /** 畫布資料有變動（移動節點）；revision 變了就重新載入。 */
  'canvas.changed': CanvasChangedSchema,
  /** 背景做完事的一行通知（例如生成完自動接片）。 */
  'canvas.notice': CanvasNoticeSchema,
  /** AI 工具（MCP）剛改了畫布上的哪些節點：畫面亮一下、標「AI 剛改」、提示刪了什麼。 */
  'canvas.aiChanged': CanvasAiChangedSchema,
  /**
   * 使用者復原或重做之後，畫布上哪些節點因此變了（內容、新出現、不見了）：畫面把這些節點的「AI 剛改」拿掉
   * （內容已經退回去，標記就不對了；重做也不再標，那是使用者自己要的）。
   */
  'canvas.marksReverted': z.object({
    direction: z.enum(['undo', 'redo']),
    keys: z.array(z.string()),
  }),
  /** 復原／重做的狀態有變動（編輯、復原、重做、換專案）。 */
  'history.changed': HistoryChangedSchema,
  /** Slima 連線狀態改變了。 */
  'slima.status': SlimaStatusSchema,
  /** 使用者選了視窗上方選單的「檔案」項目（新專案、開啟、儲存…）。 */
  'menu.action': MenuActionSchema,
  /** 有新的模型通知（例如選的模型下架、自動換掉）：畫面用 `models.notices` 取走。 */
  'models.noticed': z.object({}),
  /** Claude 對話有新的內容（整則訊息或整個對話的最新樣子）。 */
  'chat.event': ChatEventSchema,
} as const

export type IpcContract = typeof ipcContract
export type IpcChannel = keyof IpcContract
export type IpcEventName = keyof typeof ipcEvents

/** renderer 呼叫時要傳的型別（套用 default 前）。 */
export type IpcRequest<C extends IpcChannel> = z.input<IpcContract[C]['request']>
/** handler 收到、驗證過的 request（套用 default 後）。 */
export type IpcParsedRequest<C extends IpcChannel> = z.output<IpcContract[C]['request']>
export type IpcResponse<C extends IpcChannel> = z.output<IpcContract[C]['response']>
export type IpcEventPayload<E extends IpcEventName> = z.output<(typeof ipcEvents)[E]>

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape }

/** 傳給 ipcRenderer 的實際訊息格式（只有兩個真正的 Electron channel）。 */
export const IPC_INVOKE_CHANNEL = 'svs:invoke'
export const IPC_EVENT_CHANNEL = 'svs:event'

export const IpcEnvelopeSchema = z.object({ channel: z.string(), payload: z.unknown() })
export const IpcEventEnvelopeSchema = z.object({ name: z.string(), payload: z.unknown() })

export const IpcResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: AppErrorShapeSchema }),
])

export function isIpcChannel(value: string): value is IpcChannel {
  return Object.hasOwn(ipcContract, value)
}

export function isIpcEventName(value: string): value is IpcEventName {
  return Object.hasOwn(ipcEvents, value)
}

/** preload 暴露給 renderer 的 `window.svs`。 */
export interface SvsApi {
  invoke: <C extends IpcChannel>(
    channel: C,
    payload: IpcRequest<C>,
  ) => Promise<IpcResult<IpcResponse<C>>>
  on: <E extends IpcEventName>(
    event: E,
    listener: (payload: IpcEventPayload<E>) => void,
  ) => () => void
}
