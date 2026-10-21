import { AppError } from '@svs/schema'
import { and, eq, ne } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { isDeepStrictEqual } from 'node:util'

import type { AppDb } from './database'
import { canvasEdges, canvasLayout, canvasNodes } from './tables/canvas'
import { soundClips } from './tables/sound'
import {
  acts,
  characterConcepts,
  characterPacks,
  characterTurnarounds,
  characters,
  locationConcepts,
  locations,
  scenes,
  shots,
  takes,
} from './tables/core'

type Row = Record<string, unknown>
/** 資料庫本身或交易裡的連線，兩者都有這四個方法。 */
type Conn = Pick<AppDb, 'select' | 'insert' | 'update' | 'delete'>

/** 一張會被記錄的資料表：怎麼讀、寫、刪。 */
interface TrackedTable {
  key: string
  read: (db: Conn, projectId: string) => Row[]
  get: (db: Conn, id: string) => Row | undefined
  insert: (db: Conn, row: Row) => void
  update: (db: Conn, id: string, fields: Row) => void
  remove: (db: Conn, id: string) => void
}

function track(
  key: string,
  table: SQLiteTable,
  idColumn: SQLiteColumn,
  read: (db: Conn, projectId: string) => Row[],
): TrackedTable {
  return {
    key,
    read,
    get: (db, id) => db.select().from(table).where(eq(idColumn, id)).get(),
    insert: (db, row) => {
      db.insert(table)
        .values(row as never)
        .run()
    },
    update: (db, id, fields) => {
      db.update(table).set(fields).where(eq(idColumn, id)).run()
    },
    remove: (db, id) => {
      db.delete(table).where(eq(idColumn, id)).run()
    },
  }
}

/**
 * 會被記錄的資料表，順序就是寫入時的相依順序（先有幕才有場、先有鏡頭才有版本）；
 * 刪除時用相反的順序。
 */
const TABLES: readonly TrackedTable[] = [
  track('acts', acts, acts.id, (db, projectId) =>
    db.select().from(acts).where(eq(acts.projectId, projectId)).all(),
  ),
  track('scenes', scenes, scenes.id, (db, projectId) =>
    db.select().from(scenes).where(eq(scenes.projectId, projectId)).all(),
  ),
  track('locations', locations, locations.id, (db, projectId) =>
    db.select().from(locations).where(eq(locations.projectId, projectId)).all(),
  ),
  track('locationConcepts', locationConcepts, locationConcepts.id, (db, projectId) =>
    db
      .select({ row: locationConcepts })
      .from(locationConcepts)
      .innerJoin(locations, eq(locationConcepts.locationId, locations.id))
      .where(eq(locations.projectId, projectId))
      .all()
      .map((r) => r.row),
  ),
  // 角色與它的版本、概念圖、三視圖：刪掉角色（連帶刪掉這三張表）也能復原。
  // 圖檔本身是內容雜湊命名的素材，刪角色不會刪檔，所以復原後圖還在
  track('characters', characters, characters.id, (db, projectId) =>
    db.select().from(characters).where(eq(characters.projectId, projectId)).all(),
  ),
  ...(
    [
      ['characterPacks', characterPacks, characterPacks.id, characterPacks.characterId],
      ['characterConcepts', characterConcepts, characterConcepts.id, characterConcepts.characterId],
      [
        'characterTurnarounds',
        characterTurnarounds,
        characterTurnarounds.id,
        characterTurnarounds.characterId,
      ],
    ] as const
  ).map(([key, table, id, characterId]) =>
    track(key, table, id, (db, projectId) =>
      db
        .select({ row: table })
        .from(table)
        .innerJoin(characters, eq(characterId, characters.id))
        .where(eq(characters.projectId, projectId))
        .all()
        .map((r) => r.row as Row),
    ),
  ),
  track('shots', shots, shots.id, (db, projectId) =>
    db.select().from(shots).where(eq(shots.projectId, projectId)).all(),
  ),
  // 自由節點（獨立圖片、獨立影片…）：畫布上的資料，依擁有者記錄
  track('canvasNodes', canvasNodes, canvasNodes.id, (db, projectId) =>
    db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId)).all(),
  ),
  // 版本依擁有者讀取：鏡頭擁有的、自由節點擁有的
  track('takes', takes, takes.id, (db, projectId) => [
    ...db
      .select({ row: takes })
      .from(takes)
      .innerJoin(shots, and(eq(takes.ownerType, 'shot'), eq(takes.ownerId, shots.id)))
      .where(eq(shots.projectId, projectId))
      .all()
      .map((r) => r.row),
    ...db
      .select({ row: takes })
      .from(takes)
      .innerJoin(canvasNodes, and(eq(takes.ownerType, 'node'), eq(takes.ownerId, canvasNodes.id)))
      .where(eq(canvasNodes.projectId, projectId))
      .all()
      .map((r) => r.row),
  ]),
  // 聲音（旁白、配樂的各個版本）：整次生成含聲音時，復原要一起退回、重做要一起回來（旁白屬於鏡頭，排在鏡頭之後）
  track('soundClips', soundClips, soundClips.id, (db, projectId) =>
    db.select().from(soundClips).where(eq(soundClips.projectId, projectId)).all(),
  ),
  // 節點位置與連線：移動節點、剪線都能復原。視角（鍵 viewport）不算編輯，不記錄。
  track('canvasLayout', canvasLayout, canvasLayout.id, (db, projectId) =>
    db
      .select()
      .from(canvasLayout)
      .where(and(eq(canvasLayout.projectId, projectId), ne(canvasLayout.id, 'viewport')))
      .all(),
  ),
  track('canvasEdges', canvasEdges, canvasEdges.id, (db, projectId) =>
    db.select().from(canvasEdges).where(eq(canvasEdges.projectId, projectId)).all(),
  ),
]

/** 每一列都有的主鍵（Row 是通用的物件型別，所以用 Reflect 取）。 */
const idOf = (row: Row): string => String(Reflect.get(row, 'id'))

type Snapshot = Map<string, Map<string, Row>>

function snapshot(db: Conn, projectId: string): Snapshot {
  return new Map(
    TABLES.map((table) => [
      table.key,
      new Map(table.read(db, projectId).map((row) => [idOf(row), row])),
    ]),
  )
}

/** 一筆資料的變化：新增、刪除，或只有哪幾個欄位從什麼變成什麼。 */
export type Change =
  | { table: string; id: string; kind: 'insert'; row: Row }
  | { table: string; id: string; kind: 'delete'; row: Row }
  | {
      table: string
      id: string
      kind: 'update'
      fields: Record<string, { before: unknown; after: unknown }>
    }

function diff(before: Snapshot, after: Snapshot): Change[] {
  const changes: Change[] = []
  for (const { key } of TABLES) {
    const was = before.get(key) ?? new Map<string, Row>()
    const now = after.get(key) ?? new Map<string, Row>()
    for (const [id, row] of now) {
      const old = was.get(id)
      if (!old) {
        changes.push({ table: key, id, kind: 'insert', row })
        continue
      }
      const fields: Record<string, { before: unknown; after: unknown }> = {}
      for (const [name, value] of Object.entries(row)) {
        if (!isDeepStrictEqual(old[name], value)) fields[name] = { before: old[name], after: value }
      }
      if (Object.keys(fields).length > 0) changes.push({ table: key, id, kind: 'update', fields })
    }
    for (const [id, row] of was) {
      if (!now.has(id)) changes.push({ table: key, id, kind: 'delete', row })
    }
  }
  return changes
}

const addDetail = (details: string[] | undefined, label: string): string[] =>
  details?.includes(label) === true ? details : [...(details ?? []), label]

export interface HistoryEntry {
  label: string
  changes: Change[]
  /** 一組合成一步的紀錄（Claude 一輪）：裡面各個編輯的名稱（「修改鏡頭的景別」…，不重複）；單獨的一步沒有。 */
  details?: string[]
}

/**
 * 一組合成一步的改動（例如 Claude 一輪裡所有的工具呼叫）。組開著的時候，用這個組記下的編輯都併進同一筆復原紀錄；
 * 沒用這個組記的編輯（使用者自己的操作）照舊各是一步、排在組的後面，不會被併進去。
 */
export interface HistoryGroup {
  readonly label: string
  /** 這一組目前的那一筆紀錄（還沒有任何改動時是 undefined）。 */
  entry?: HistoryEntry
  closed: boolean
}

type Fields = Record<string, { before: unknown; after: unknown }>
const afterValues = (fields: Fields): Row =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.after]))
const beforeValues = (fields: Fields): Row =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.before]))

/**
 * 把後來的改動接到前面已經記下的改動後面，結果等於「從最前面的狀態直接到最後的狀態」：
 * 新增後又改→一筆新增（內容是最後的）；新增後又刪→什麼都不用記；改了又改→欄位的「之前」留最早的、「之後」用最新的；
 * 改了又刪→刪（內容還原成最早的樣子）。
 */
export function mergeChanges(prev: readonly Change[], next: readonly Change[]): Change[] {
  const out = [...prev]
  for (const change of next) {
    const at = out.findIndex((c) => c.table === change.table && c.id === change.id)
    const old = at < 0 ? undefined : out[at]
    if (!old) {
      out.push(change)
    } else if (old.kind === 'insert' && change.kind === 'update') {
      out[at] = { ...old, row: { ...old.row, ...afterValues(change.fields) } }
    } else if (old.kind === 'insert' && change.kind === 'delete') {
      out.splice(at, 1)
    } else if (old.kind === 'update' && change.kind === 'update') {
      const fields: Fields = { ...old.fields }
      for (const [name, value] of Object.entries(change.fields)) {
        const first = fields[name]
        if (first === undefined) fields[name] = value
        else if (isDeepStrictEqual(first.before, value.after)) Reflect.deleteProperty(fields, name)
        else fields[name] = { before: first.before, after: value.after }
      }
      if (Object.keys(fields).length === 0) out.splice(at, 1)
      else out[at] = { ...old, fields }
    } else if (old.kind === 'update' && change.kind === 'delete') {
      out[at] = { ...change, row: { ...change.row, ...beforeValues(old.fields) } }
    } else if (old.kind === 'delete' && change.kind === 'insert') {
      // 刪掉又用同一個 id 建回來：整體看是這一列的內容變了
      const fields: Fields = {}
      for (const [name, value] of Object.entries(change.row)) {
        if (!isDeepStrictEqual(old.row[name], value))
          fields[name] = { before: old.row[name], after: value }
      }
      if (Object.keys(fields).length === 0) out.splice(at, 1)
      else out[at] = { table: change.table, id: change.id, kind: 'update', fields }
    } else {
      out.push(change)
    }
  }
  return out
}

/** 復原或重做一步的結果：那一步，加上真的動了幾處、因為後來又被改過而略過幾處。 */
export interface AppliedEntry extends HistoryEntry {
  applied: number
  skipped: number
}

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  /** 按「復原」會復原的動作名稱。 */
  undoLabel?: string
  redoLabel?: string
  /** 還可以復原／重做幾步。 */
  undoCount: number
  redoCount: number
}

/** 最多記住幾個動作；更早的會被丟掉。 */
export const HISTORY_LIMIT = 100

/**
 * 大綱與分鏡表的復原／重做。
 *
 * 做法不是替每個動作寫一個反向動作，而是在動作前後各拍一次「幕、場、地點、鏡頭、版本、畫布節點位置與連線」的快照，
 * 只記下差異（新增、刪除、哪些欄位變了）。復原就是把差異反過來套回去，所以新增、修改、
 * 排序、刪除（含連帶被刪掉的版本與連帶被清空的場／地點指定）都用同一套規則。
 *
 * 欄位的復原只在「現在的值還是這個動作留下的值」時才動它：
 * 動作之後如果鏡頭又重新生成、狀態或 Prompt 已經變了，就不會被舊值蓋掉。
 */
export class StructureHistory {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []

  constructor(
    private readonly db: AppDb,
    private readonly projectId: string,
    private readonly limit = HISTORY_LIMIT,
  ) {}

  /**
   * 執行一個編輯並記下它改了什麼；沒有改到任何東西就不記；編輯失敗（丟錯）也不記。
   * 給了 `group`（而且還開著）就併進那一組的紀錄，不另外成一步。
   */
  record<T>(label: string, run: () => T, group?: HistoryGroup): T {
    const before = snapshot(this.db, this.projectId)
    const result = run()
    const changes = diff(before, snapshot(this.db, this.projectId))
    if (changes.length === 0) return result
    this.redoStack = []
    if (group && !group.closed) {
      const existing = group.entry
      if (existing && this.undoStack.includes(existing)) {
        existing.details = addDetail(existing.details, label)
        existing.changes = mergeChanges(existing.changes, changes)
        // 全部抵銷了（新增又刪掉）：這一組沒留下任何東西，紀錄拿掉
        if (existing.changes.length === 0) {
          this.undoStack.splice(this.undoStack.indexOf(existing), 1)
          delete group.entry
        }
        return result
      }
      const entry: HistoryEntry = {
        label: group.label,
        changes,
        details: addDetail(undefined, label),
      }
      group.entry = entry
      this.undoStack.push(entry)
    } else {
      this.undoStack.push({ label, changes })
    }
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    return result
  }

  /** 開一組：之後用這一組記下的編輯會併成一步。 */
  openGroup(label: string): HistoryGroup {
    return { label, closed: false }
  }

  /** 收一組：之後不再併進去。 */
  closeGroup(group: HistoryGroup): void {
    group.closed = true
  }

  /** 最上面（按復原會退的）那一步，是不是這一組還開著的那一筆。 */
  groupIsOnTop(group: HistoryGroup): boolean {
    return !group.closed && group.entry !== undefined && this.undoStack.at(-1) === group.entry
  }

  /**
   * 會在背景跑一段時間的動作（例如一句話生成）：現在先拍快照，回傳的函式在動作結束時呼叫，
   * 把這段時間的所有變化記成一筆。期間另外記下的動作（生成中順手改的東西）併進這一筆，
   * 免得復原時兩筆互相打架；所以復原這一筆就是回到按下去之前的樣子。結束函式只有第一次呼叫有效。
   */
  begin(label: string): () => void {
    const before = snapshot(this.db, this.projectId)
    const mark = this.undoStack.length
    let done = false
    return () => {
      if (done) return
      done = true
      const changes = diff(before, snapshot(this.db, this.projectId))
      if (changes.length === 0) return
      this.undoStack.splice(Math.min(mark, this.undoStack.length))
      this.undoStack.push({ label, changes })
      if (this.undoStack.length > this.limit) this.undoStack.shift()
      this.redoStack = []
    }
  }

  /**
   * 這個專案是剛被這個動作建立出來的（第一次新增大綱或鏡頭時會自動建專案），
   * 動作之前什麼都沒有：把目前的內容整個當成這個動作的結果記下來。
   */
  recordCreation(label: string): void {
    const empty: Snapshot = new Map(TABLES.map((table) => [table.key, new Map<string, Row>()]))
    const changes = diff(empty, snapshot(this.db, this.projectId))
    if (changes.length === 0) return
    this.undoStack.push({ label, changes })
    this.redoStack = []
  }

  /**
   * 復原最近一個動作；沒有可復原的就回傳 undefined。
   * 回傳的 `skipped` 是這一步裡因為「現在的值已經不是它留下的值」（後來又被改過）或那一列已經不在而沒動的地方，
   * `applied` 是真的動了的地方；兩個都是數量。
   */
  undo(): AppliedEntry | undefined {
    const entry = this.undoStack.at(-1)
    if (!entry) return undefined
    const counts = this.apply(entry, 'undo')
    this.undoStack.pop()
    this.redoStack.push(entry)
    return { ...entry, ...counts }
  }

  redo(): AppliedEntry | undefined {
    const entry = this.redoStack.at(-1)
    if (!entry) return undefined
    const counts = this.apply(entry, 'redo')
    this.redoStack.pop()
    this.undoStack.push(entry)
    return { ...entry, ...counts }
  }

  /** 做了無法復原的大動作（例如 AI 重新拆場）之後清空，免得舊的紀錄對不上現在的資料。 */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }

  state(): HistoryState {
    const undo = this.undoStack.at(-1)
    const redo = this.redoStack.at(-1)
    return {
      canUndo: undo !== undefined,
      canRedo: redo !== undefined,
      ...(undo ? { undoLabel: undo.label } : {}),
      ...(redo ? { redoLabel: redo.label } : {}),
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    }
  }

  private apply(
    entry: HistoryEntry,
    direction: 'undo' | 'redo',
  ): { applied: number; skipped: number } {
    let applied = 0
    let skipped = 0
    const undoing = direction === 'undo'
    const toInsert = entry.changes.filter((c) => c.kind === (undoing ? 'delete' : 'insert'))
    const toRemove = entry.changes.filter((c) => c.kind === (undoing ? 'insert' : 'delete'))
    const toUpdate = entry.changes.filter((c) => c.kind === 'update')
    const byKey = (key: string): TrackedTable => {
      const table = TABLES.find((t) => t.key === key)
      if (!table) throw new Error(`未知的資料表：${key}`)
      return table
    }
    const order = (key: string): number => TABLES.findIndex((t) => t.key === key)

    try {
      this.db.transaction((tx) => {
        // 先補回被刪掉的（相依的先寫）、再改欄位、最後刪掉要消失的（相依的先刪）
        for (const change of [...toInsert].sort((a, b) => order(a.table) - order(b.table))) {
          if (change.kind === 'update') continue
          const table = byKey(change.table)
          if (table.get(tx, change.id)) skipped++
          else {
            table.insert(tx, change.row)
            applied++
          }
        }
        for (const change of toUpdate) {
          const table = byKey(change.table)
          const current = table.get(tx, change.id)
          if (!current) {
            skipped++
            continue
          }
          const fields: Row = {}
          for (const [name, { before, after }] of Object.entries(change.fields)) {
            const from = undoing ? after : before
            const to = undoing ? before : after
            if (isDeepStrictEqual(current[name], from)) fields[name] = to
            else skipped++
          }
          if (Object.keys(fields).length > 0) {
            table.update(tx, change.id, fields)
            applied += Object.keys(fields).length
          }
        }
        for (const change of [...toRemove].sort((a, b) => order(b.table) - order(a.table))) {
          byKey(change.table).remove(tx, change.id)
          applied++
        }
      })
      return { applied, skipped }
    } catch (error) {
      // 資料已經和這筆紀錄對不上（例如相關的場被別的動作刪掉），這筆就不能再用了
      if (undoing) this.undoStack.pop()
      else this.redoStack.pop()
      throw new AppError({
        code: 'project_invalid',
        userMessage: '資料已經和當時不一樣了，沒辦法復原這個動作。',
        cause: error,
      })
    }
  }
}
