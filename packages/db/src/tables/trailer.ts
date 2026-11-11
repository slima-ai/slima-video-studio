import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { projects } from './core'

// 預告片設定：每個專案最多一列（JSON，比照 sound_settings）。有這一列就是「預告片專案」，沒有就是一般專案。
// 跟 sound_settings 不同的是多一個 id（值＝專案 id）：復原記錄（history.ts）靠 id 認列，這樣改設定也能復原。

export const trailerSettings = sqliteTable('trailer_settings', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
})
