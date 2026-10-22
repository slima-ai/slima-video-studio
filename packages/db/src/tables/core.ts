import { index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import type {
  Budget,
  CharacterAppearance,
  Costume,
  PickableCapability,
  Turnaround,
} from '@svs/schema'

// 時間一律存 ISO 8601 字串；巢狀結構（出場角色、服裝…）存 JSON。
// 欄位名稱用 snake_case；排序欄位叫 position（order 是 SQL 保留字）。

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  aspectRatio: text('aspect_ratio').notNull().default('16:9'),
  defaultStyleId: text('default_style_id'),
  budget: text('budget', { mode: 'json' }).$type<Budget>().notNull(),
  /** 這個專案預設用的模型（用途 → 模型 id）；空的就跟著 App 設定。 */
  models: text('models', { mode: 'json' })
    .$type<Partial<Record<PickableCapability, string>>>()
    .notNull()
    .default({}),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const acts = sqliteTable('acts', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  position: integer('position').notNull(),
})

export const scenes = sqliteTable(
  'scenes',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    actId: text('act_id').references(() => acts.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    locationId: text('location_id'),
    timeOfDay: text('time_of_day'),
    mood: text('mood'),
    estimatedSeconds: real('estimated_seconds'),
    position: integer('position').notNull(),
  },
  (t) => [index('scenes_project_idx').on(t.projectId, t.position)],
)

export const shots = sqliteTable(
  'shots',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sceneId: text('scene_id').references(() => scenes.id, { onDelete: 'set null' }),
    number: integer('number').notNull(),
    position: integer('position').notNull(),
    size: text('size').notNull(),
    angle: text('angle').notNull(),
    cameraMove: text('camera_move'),
    durationSec: real('duration_sec').notNull(),
    description: text('description').notNull().default(''),
    prompt: text('prompt'),
    dialogue: text('dialogue').notNull().default(''),
    characters: text('characters', { mode: 'json' }).$type<CharacterAppearance[]>().notNull(),
    locationId: text('location_id'),
    lighting: text('lighting'),
    timeOfDay: text('time_of_day'),
    mood: text('mood'),
    status: text('status').notNull(),
    // 不加外鍵：shots 與 takes 互相參照會形成循環
    activeTakeId: text('active_take_id'),
    // 畫布上影片節點的「放進成品」開關
    inCut: integer('in_cut', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('shots_project_idx').on(t.projectId, t.position)],
)

/**
 * 生成結果版本。擁有者可以是鏡頭（`owner_type = 'shot'`，`shot_id` 一併填上，刪鏡頭時連帶刪除），
 * 也可以是畫布上的自由節點（`owner_type = 'node'`，`shot_id` 是空的，由應用程式在刪節點時清理）。
 */
export const takes = sqliteTable(
  'takes',
  {
    id: text('id').primaryKey(),
    shotId: text('shot_id').references(() => shots.id, { onDelete: 'cascade' }),
    ownerType: text('owner_type').notNull().default('shot'),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').notNull(),
    version: integer('version').notNull(),
    assetHash: text('asset_hash').notNull(),
    adopted: integer('adopted', { mode: 'boolean' }).notNull().default(false),
    modelId: text('model_id').notNull(),
    seed: integer('seed'),
    runId: text('run_id'),
    nodeRunId: text('node_run_id'),
    // 生成當下的內容雜湊；舊資料是空的
    inputHash: text('input_hash'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    unique('takes_owner_kind_version_uq').on(t.ownerType, t.ownerId, t.kind, t.version),
    index('takes_shot_idx').on(t.shotId),
  ],
)

export const characters = sqliteTable(
  'characters',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    age: text('age'),
    personality: text('personality').notNull().default(''),
    appearance: text('appearance').notNull().default(''),
    costumes: text('costumes', { mode: 'json' }).$type<Costume[]>().notNull(),
    styleId: text('style_id'),
    voices: text('voices', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    currentPackId: text('current_pack_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('characters_project_idx').on(t.projectId)],
)

export const characterPacks = sqliteTable(
  'character_packs',
  {
    id: text('id').primaryKey(),
    characterId: text('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    anchorText: text('anchor_text').notNull().default(''),
    heroAssetHash: text('hero_asset_hash'),
    turnaround: text('turnaround', { mode: 'json' }).$type<Turnaround>(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [unique('character_packs_version_uq').on(t.characterId, t.version)],
)

/** 角色概念圖的候選：每按一次「生成」是新的一輪（round），每輪 4 張。 */
export const characterConcepts = sqliteTable(
  'character_concepts',
  {
    id: text('id').primaryKey(),
    characterId: text('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    slot: integer('slot').notNull(),
    assetHash: text('asset_hash').notNull(),
    modelId: text('model_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [unique('character_concepts_slot_uq').on(t.characterId, t.round, t.slot)],
)

/**
 * 角色的參考圖：一份「有用途標記的清單」（臉、身體、三視圖、表情、服裝、道具……）。
 * 用途存成文字（不是資料庫的列舉），之後多一種用途不需要遷移；同一張圖可以有不同的用途。
 */
export const characterReferences = sqliteTable(
  'character_references',
  {
    id: text('id').primaryKey(),
    characterId: text('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    assetHash: text('asset_hash').notNull(),
    purpose: text('purpose').notNull(),
    /** 一句白話備註（例如「原版設定圖」）；沒有就是空字串。 */
    label: text('label').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [unique('character_references_uq').on(t.characterId, t.assetHash, t.purpose)],
)

/** 三視圖候選：一張橫式的設定稿（sheet）切成正面／側面／背面三張；切線位置可以調整。 */
export const characterTurnarounds = sqliteTable(
  'character_turnarounds',
  {
    id: text('id').primaryKey(),
    characterId: text('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    slot: integer('slot').notNull(),
    sheetHash: text('sheet_hash').notNull(),
    frontHash: text('front_hash').notNull(),
    sideHash: text('side_hash').notNull(),
    backHash: text('back_hash').notNull(),
    /** 兩條切線在設定稿寬度上的位置（0～1）。 */
    cutA: real('cut_a').notNull(),
    cutB: real('cut_b').notNull(),
    /** 生成時用的主圖。 */
    heroHash: text('hero_hash').notNull(),
    modelId: text('model_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [unique('character_turnarounds_slot_uq').on(t.characterId, t.round, t.slot)],
)

export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  anchorText: text('anchor_text').notNull().default(''),
  mainAssetHash: text('main_asset_hash'),
  angleAssetHashes: text('angle_asset_hashes', { mode: 'json' }).$type<string[]>().notNull(),
  status: text('status').notNull(),
})

/** 場景卡的概念圖候選：每按一次「生成」是新的一輪（round），每輪 4 張。 */
export const locationConcepts = sqliteTable(
  'location_concepts',
  {
    id: text('id').primaryKey(),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    slot: integer('slot').notNull(),
    assetHash: text('asset_hash').notNull(),
    modelId: text('model_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [unique('location_concepts_slot_uq').on(t.locationId, t.round, t.slot)],
)

/**
 * 場景卡的參考圖：一份「有用途標記的清單」（主景、反方向、拉遠全景、俯視、縱深感……），跟角色的參考圖同一個形狀。
 * 用途存成文字（不是資料庫的列舉），之後多一種用途不需要遷移；同一張圖可以有不同的用途。
 * 場景卡本來的主圖與兩個角度仍存在 locations 裡，不搬過來；這張表只放「另外加的」。
 */
export const locationReferences = sqliteTable(
  'location_references',
  {
    id: text('id').primaryKey(),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    assetHash: text('asset_hash').notNull(),
    purpose: text('purpose').notNull(),
    /** 一句白話備註（例如「從上面看的格局」）；沒有就是空字串。 */
    label: text('label').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [unique('location_references_uq').on(t.locationId, t.assetHash, t.purpose)],
)

export const styles = sqliteTable('styles', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  promptFragment: text('prompt_fragment').notNull().default(''),
  palette: text('palette', { mode: 'json' }).$type<string[]>().notNull(),
})

export const slimaLinks = sqliteTable('slima_links', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  bookToken: text('book_token').notNull(),
  path: text('path').notNull(),
  remoteVersion: text('remote_version'),
  importedAt: text('imported_at').notNull(),
})
