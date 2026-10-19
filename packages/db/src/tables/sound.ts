import { integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

import { projects, shots } from './core'

// 聲音：每鏡的旁白（與之後的音效）、整支的配樂，以及專案的聲音設定。
// 混音只用 adopted 的版本；成品（final_cuts）記住混音用的是哪一組（sound_key），之後才判斷得出「聲音變了、要重混」。

/** 一次生成的聲音結果（一個版本）。配樂沒有 shot_id。 */
export const soundClips = sqliteTable(
  'sound_clips',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    shotId: text('shot_id').references(() => shots.id, { onDelete: 'cascade' }),
    assetHash: text('asset_hash').notNull(),
    durationSec: real('duration_sec'),
    offsetSec: real('offset_sec').notNull().default(0),
    gainDb: real('gain_db'),
    fadeInSec: real('fade_in_sec'),
    fadeOutSec: real('fade_out_sec'),
    text: text('text').notNull().default(''),
    voiceId: text('voice_id'),
    modelId: text('model_id').notNull(),
    costUsd: real('cost_usd'),
    costEstimated: integer('cost_estimated', { mode: 'boolean' }).notNull().default(false),
    version: integer('version').notNull(),
    adopted: integer('adopted', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => [unique('sound_clips_group_version_uq').on(t.projectId, t.kind, t.shotId, t.version)],
)

/** 專案的聲音設定（每個專案一列，JSON；沒有列就用預設）。 */
export const soundSettings = sqliteTable('sound_settings', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
})
