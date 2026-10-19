import { integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

import { projects } from './core'

// 畫布（首頁）的資料：幕、場、鏡頭、角色、地點仍在原本的表，畫布只是把它們投影成節點；
// 這裡存「節點放在哪裡」，以及不屬於任何原本資料的自由節點與連線。

/** 節點被拖過之後的位置；沒有列就代表用自動排版。節點鍵例如 `shot:<id>`、`shot:<id>:image`、`cut`。 */
export const canvasLayout = sqliteTable('canvas_layout', {
  /** 節點鍵（同一個專案內唯一；視角用特殊鍵 `viewport`，另外存在 zoom）。 */
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  x: real('x').notNull(),
  y: real('y').notNull(),
  zoom: real('zoom'),
})

/** 自由節點：一句話、獨立圖片／影片、上傳素材、便條、自訂群組。 */
export const canvasNodes = sqliteTable('canvas_nodes', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  params: text('params', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
  createdAt: text('created_at').notNull(),
})

/** 自由節點之間、或自由節點與原本資料之間的連線（原本資料之間的關係不存在這裡）。 */
export const canvasEdges = sqliteTable('canvas_edges', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  sourceKey: text('source_key').notNull(),
  sourcePort: text('source_port').notNull(),
  targetKey: text('target_key').notNull(),
  targetPort: text('target_port').notNull(),
  kind: text('kind').notNull().default('data'),
})

/**
 * 接好的成品：每接一次存一個版本（剪輯卡顯示「成品 v2 · 0:15」，關掉 App 再開也還在）。
 * `takeIds` 是依順序用了哪些影片版本，拿來判斷成品是不是跟現在的鏡頭對不上（需要重新接）。
 */
export const finalCuts = sqliteTable(
  'final_cuts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    assetHash: text('asset_hash').notNull(),
    durationSec: real('duration_sec'),
    takeIds: text('take_ids', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [unique('final_cuts_project_version_uq').on(t.projectId, t.version)],
)
