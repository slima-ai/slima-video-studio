import {
  ActSchema,
  AppError,
  LocationSchema,
  SceneSchema,
  type Act,
  type Location,
  type Scene,
} from '@svs/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { AppDb } from '../database'
import { dropNulls } from '../rows'
import { acts, locations, scenes, shots } from '../tables/core'

export interface ActPatch {
  title?: string | undefined
  summary?: string | undefined
}
export interface ScenePatch {
  title?: string | undefined
  summary?: string | undefined
  /** 搬到另一幕（放在那一幕的最後面）。 */
  actId?: string | undefined
  /** null 代表清掉。 */
  locationId?: string | null | undefined
  timeOfDay?: string | null | undefined
  mood?: string | null | undefined
}
export interface LocationPatch {
  name?: string | undefined
  description?: string | undefined
}
export interface NewScene {
  title: string
  summary?: string
  locationId?: string
  timeOfDay?: string
  mood?: string
}

const notFound = (what: string, id: string): AppError =>
  new AppError({ code: 'project_invalid', userMessage: `找不到${what}（${id}）。` })

/** 大綱：幕、場與地點。排序都用 position，同一幕裡的場依 position 排。 */
export class OutlineRepository {
  constructor(
    private readonly db: AppDb,
    private readonly projectId: string,
  ) {}

  // ── 幕 ────────────────────────────────────────────

  listActs(): Act[] {
    return this.db
      .select()
      .from(acts)
      .where(eq(acts.projectId, this.projectId))
      .orderBy(asc(acts.position))
      .all()
      .map(toAct)
  }

  addAct(input: { title: string; summary?: string }): Act {
    const act = ActSchema.parse({
      id: randomUUID(),
      projectId: this.projectId,
      title: input.title,
      summary: input.summary ?? '',
      order: this.nextPosition(acts, acts.projectId, acts.position),
    })
    this.db.insert(acts).values(toActRow(act)).run()
    return act
  }

  updateAct(id: string, patch: ActPatch): Act {
    const current = this.getAct(id)
    const next = ActSchema.parse({ ...current, ...stripUndefined(patch) })
    this.db.update(acts).set(toActRow(next)).where(eq(acts.id, id)).run()
    return next
  }

  /** 刪掉一幕，它底下的場一起刪（鏡頭保留，只是不再屬於任何場）。 */
  deleteAct(id: string): void {
    this.db.transaction((tx) => {
      tx.delete(scenes).where(eq(scenes.actId, id)).run()
      tx.delete(acts).where(eq(acts.id, id)).run()
    })
  }

  moveAct(id: string, direction: 'up' | 'down'): void {
    const all = this.listActs()
    const index = all.findIndex((a) => a.id === id)
    if (index < 0) throw notFound('這一幕', id)
    const other = all[direction === 'up' ? index - 1 : index + 1]
    const self = all[index]
    if (!other || !self) return
    this.db.transaction((tx) => {
      tx.update(acts).set({ position: other.order }).where(eq(acts.id, self.id)).run()
      tx.update(acts).set({ position: self.order }).where(eq(acts.id, other.id)).run()
    })
  }

  // ── 場 ────────────────────────────────────────────

  /** 所有的場：依幕的順序，同一幕裡依場的順序；沒有歸屬的排在最後。 */
  listScenes(): Scene[] {
    const actOrder = new Map(this.listActs().map((a) => [a.id, a.order]))
    return this.db
      .select()
      .from(scenes)
      .where(eq(scenes.projectId, this.projectId))
      .orderBy(asc(scenes.position))
      .all()
      .map(toScene)
      .sort(
        (a, b) =>
          (a.actId ? (actOrder.get(a.actId) ?? Infinity) : Infinity) -
          (b.actId ? (actOrder.get(b.actId) ?? Infinity) : Infinity),
      )
  }

  addScene(actId: string, input: NewScene): Scene {
    this.getAct(actId)
    const scene = SceneSchema.parse({
      id: randomUUID(),
      projectId: this.projectId,
      actId,
      title: input.title,
      summary: input.summary ?? '',
      ...(input.locationId ? { locationId: input.locationId } : {}),
      ...(input.timeOfDay ? { timeOfDay: input.timeOfDay } : {}),
      ...(input.mood ? { mood: input.mood } : {}),
      order: this.nextPosition(scenes, scenes.projectId, scenes.position),
    })
    this.db.insert(scenes).values(toSceneRow(scene)).run()
    return scene
  }

  updateScene(id: string, patch: ScenePatch): Scene {
    const current = this.getScene(id)
    const { actId, locationId, timeOfDay, mood, ...rest } = patch
    if (actId !== undefined) this.getAct(actId)
    const moved = actId !== undefined && actId !== current.actId
    const next = SceneSchema.parse({
      ...current,
      ...stripUndefined(rest),
      ...(actId === undefined ? {} : { actId }),
      ...(locationId === undefined ? {} : { locationId: locationId ?? undefined }),
      ...(timeOfDay === undefined ? {} : { timeOfDay: timeOfDay ?? undefined }),
      ...(mood === undefined ? {} : { mood: mood ?? undefined }),
      ...(moved ? { order: this.nextPosition(scenes, scenes.projectId, scenes.position) } : {}),
    })
    this.db.update(scenes).set(toSceneRow(next)).where(eq(scenes.id, id)).run()
    return next
  }

  deleteScene(id: string): void {
    this.db.delete(scenes).where(eq(scenes.id, id)).run()
  }

  /** 在同一幕裡往前或往後移一格。 */
  moveScene(id: string, direction: 'up' | 'down'): void {
    const self = this.getScene(id)
    const siblings = this.listScenes().filter((s) => s.actId === self.actId)
    const index = siblings.findIndex((s) => s.id === id)
    const other = siblings[direction === 'up' ? index - 1 : index + 1]
    if (!other) return
    this.db.transaction((tx) => {
      tx.update(scenes).set({ position: other.order }).where(eq(scenes.id, self.id)).run()
      tx.update(scenes).set({ position: self.order }).where(eq(scenes.id, other.id)).run()
    })
  }

  // ── 地點 ──────────────────────────────────────────

  listLocations(): Location[] {
    return this.db
      .select()
      .from(locations)
      .where(eq(locations.projectId, this.projectId))
      .orderBy(asc(sql`rowid`))
      .all()
      .map(toLocation)
  }

  addLocation(input: { name: string; description?: string }): Location {
    const location = LocationSchema.parse({
      id: randomUUID(),
      projectId: this.projectId,
      name: input.name,
      description: input.description ?? '',
    })
    this.db.insert(locations).values(toLocationRow(location)).run()
    return location
  }

  updateLocation(id: string, patch: LocationPatch): Location {
    const current = this.listLocations().find((l) => l.id === id)
    if (!current) throw notFound('這個地點', id)
    const next = LocationSchema.parse({ ...current, ...stripUndefined(patch) })
    this.db.update(locations).set(toLocationRow(next)).where(eq(locations.id, id)).run()
    return next
  }

  /** 刪掉地點；用到它的場與鏡頭只是不再指定地點。 */
  deleteLocation(id: string): void {
    this.db.transaction((tx) => {
      tx.update(scenes).set({ locationId: null }).where(eq(scenes.locationId, id)).run()
      tx.update(shots).set({ locationId: null }).where(eq(shots.locationId, id)).run()
      tx.delete(locations)
        .where(and(eq(locations.id, id), eq(locations.projectId, this.projectId)))
        .run()
    })
  }

  // ── 整份換掉 ──────────────────────────────────────

  /** 刪掉所有的幕與場（地點與鏡頭保留；鏡頭只是不再屬於任何場）。 */
  clear(): void {
    this.db.transaction((tx) => {
      tx.delete(scenes).where(eq(scenes.projectId, this.projectId)).run()
      tx.delete(acts).where(eq(acts.projectId, this.projectId)).run()
    })
  }

  // ── 內部 ──────────────────────────────────────────

  private getAct(id: string): Act {
    const row = this.db.select().from(acts).where(eq(acts.id, id)).get()
    if (!row) throw notFound('這一幕', id)
    return toAct(row)
  }

  private getScene(id: string): Scene {
    const row = this.db.select().from(scenes).where(eq(scenes.id, id)).get()
    if (!row) throw notFound('這個場', id)
    return toScene(row)
  }

  private nextPosition(
    table: typeof acts | typeof scenes,
    projectColumn: typeof acts.projectId | typeof scenes.projectId,
    positionColumn: typeof acts.position | typeof scenes.position,
  ): number {
    const row = this.db
      .select({ max: sql<number>`coalesce(max(${positionColumn}), -1)` })
      .from(table)
      .where(eq(projectColumn, this.projectId))
      .get()
    return (row?.max ?? -1) + 1
  }
}

type ActRow = typeof acts.$inferSelect
type SceneRow = typeof scenes.$inferSelect
type LocationRow = typeof locations.$inferSelect

const stripUndefined = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>

function toAct(row: ActRow): Act {
  const { position, ...rest } = row
  return ActSchema.parse({ ...rest, order: position })
}
function toActRow(act: Act): ActRow {
  const { order, ...rest } = act
  return { ...rest, position: order }
}
function toScene(row: SceneRow): Scene {
  const { position, ...rest } = dropNulls(row)
  return SceneSchema.parse({ ...rest, order: position })
}
function toSceneRow(scene: Scene): SceneRow {
  const { order, ...rest } = scene
  return {
    id: rest.id,
    projectId: rest.projectId,
    actId: rest.actId ?? null,
    title: rest.title,
    summary: rest.summary,
    locationId: rest.locationId ?? null,
    timeOfDay: rest.timeOfDay ?? null,
    mood: rest.mood ?? null,
    estimatedSeconds: rest.estimatedSeconds ?? null,
    position: order,
  }
}
function toLocation(row: LocationRow): Location {
  return LocationSchema.parse(dropNulls(row))
}
function toLocationRow(location: Location): LocationRow {
  return {
    id: location.id,
    projectId: location.projectId,
    name: location.name,
    description: location.description,
    anchorText: location.anchorText,
    mainAssetHash: location.mainAssetHash ?? null,
    angleAssetHashes: location.angleAssetHashes,
    status: location.status,
  }
}
