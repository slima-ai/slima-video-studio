import { and, eq, inArray, ne, or } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { AppDb } from '../database'
import { canvasEdges, canvasLayout, canvasNodes } from '../tables/canvas'

/** 視角在 `canvas_layout` 裡用的特殊鍵。 */
export const VIEWPORT_KEY = 'viewport'

export interface Position {
  x: number
  y: number
}
export interface FreeNodeRow {
  id: string
  type: string
  params: Record<string, unknown>
  x: number
  y: number
}
export interface FreeEdgeRow {
  id: string
  sourceKey: string
  sourcePort: string
  targetKey: string
  targetPort: string
  kind: 'data' | 'reference'
}

/**
 * 畫布的位置與自由節點。幕、場、鏡頭…本身仍在原本的表；
 * 這裡只存「節點放在哪裡」、視角，以及不屬於任何原本資料的自由節點與連線。
 */
export class CanvasRepository {
  constructor(
    private readonly db: AppDb,
    private readonly projectId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 被拖過的節點位置（不含視角）；沒有的節點用自動排版。 */
  positions(): Map<string, Position> {
    return new Map(
      this.db
        .select()
        .from(canvasLayout)
        .where(and(eq(canvasLayout.projectId, this.projectId), ne(canvasLayout.id, VIEWPORT_KEY)))
        .all()
        .map((row) => [row.id, { x: row.x, y: row.y }]),
    )
  }

  /** 把一批節點放到新位置（沒有列就新增）。 */
  move(moves: readonly { key: string; x: number; y: number }[]): void {
    this.db.transaction((tx) => {
      for (const { key, x, y } of moves) {
        if (key === VIEWPORT_KEY) continue
        tx.insert(canvasLayout)
          .values({ id: key, projectId: this.projectId, x, y })
          .onConflictDoUpdate({ target: canvasLayout.id, set: { x, y } })
          .run()
      }
    })
  }

  /** 讓這些節點回到自動排版。 */
  resetPositions(keys: readonly string[]): void {
    if (keys.length === 0) return
    this.db
      .delete(canvasLayout)
      .where(inArray(canvasLayout.id, [...keys]))
      .run()
  }

  viewport(): { x: number; y: number; zoom: number } | undefined {
    const row = this.db.select().from(canvasLayout).where(eq(canvasLayout.id, VIEWPORT_KEY)).get()
    return row?.zoom == null ? undefined : { x: row.x, y: row.y, zoom: row.zoom }
  }

  setViewport(view: { x: number; y: number; zoom: number }): void {
    this.db
      .insert(canvasLayout)
      .values({ id: VIEWPORT_KEY, projectId: this.projectId, ...view })
      .onConflictDoUpdate({ target: canvasLayout.id, set: view })
      .run()
  }

  // ── 自由節點與連線（第一版只建表：投影會讀出來，新增與連線的介面之後才開放） ──

  listNodes(): FreeNodeRow[] {
    return this.db
      .select()
      .from(canvasNodes)
      .where(eq(canvasNodes.projectId, this.projectId))
      .all()
      .map(({ id, type, params, x, y }) => ({ id, type, params, x, y }))
  }

  addNode(input: Omit<FreeNodeRow, 'id'> & { id?: string }): FreeNodeRow {
    const row = { ...input, id: input.id ?? randomUUID() }
    this.db
      .insert(canvasNodes)
      .values({ ...row, projectId: this.projectId, createdAt: this.now().toISOString() })
      .run()
    return row
  }

  /** 改自由節點的設定（只覆蓋有給的欄位）；找不到節點就回 false。 */
  updateNodeParams(id: string, patch: Record<string, unknown>): boolean {
    const row = this.db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.projectId, this.projectId), eq(canvasNodes.id, id)))
      .get()
    if (!row) return false
    this.db
      .update(canvasNodes)
      .set({ params: { ...row.params, ...patch } })
      .where(eq(canvasNodes.id, id))
      .run()
    return true
  }

  /** 刪掉自由節點，連同接在它身上的自由連線與存下來的位置。 */
  removeNode(id: string): void {
    const key = `node:${id}`
    this.db.transaction((tx) => {
      tx.delete(canvasEdges)
        .where(
          and(
            eq(canvasEdges.projectId, this.projectId),
            or(eq(canvasEdges.sourceKey, key), eq(canvasEdges.targetKey, key)),
          ),
        )
        .run()
      tx.delete(canvasLayout).where(eq(canvasLayout.id, key)).run()
      tx.delete(canvasNodes)
        .where(and(eq(canvasNodes.projectId, this.projectId), eq(canvasNodes.id, id)))
        .run()
    })
  }

  /** 刪掉從某個節點出發的自由連線（一句話重新生成、取代全部時清掉舊的線）。 */
  removeEdgesFrom(sourceKey: string): void {
    this.db
      .delete(canvasEdges)
      .where(and(eq(canvasEdges.projectId, this.projectId), eq(canvasEdges.sourceKey, sourceKey)))
      .run()
  }

  /** 拿掉接到某個連接點的線（不管從哪裡接來的；一個點只能接一條時，換接之前先清掉）。 */
  removeEdgesInto(targetKey: string, targetPort: string): void {
    this.db
      .delete(canvasEdges)
      .where(
        and(
          eq(canvasEdges.projectId, this.projectId),
          eq(canvasEdges.targetKey, targetKey),
          eq(canvasEdges.targetPort, targetPort),
        ),
      )
      .run()
  }

  /** 拿掉一條線。 */
  removeEdge(edge: Omit<FreeEdgeRow, 'id' | 'kind'>): void {
    this.db
      .delete(canvasEdges)
      .where(
        and(
          eq(canvasEdges.projectId, this.projectId),
          eq(canvasEdges.sourceKey, edge.sourceKey),
          eq(canvasEdges.sourcePort, edge.sourcePort),
          eq(canvasEdges.targetKey, edge.targetKey),
          eq(canvasEdges.targetPort, edge.targetPort),
        ),
      )
      .run()
  }

  listEdges(): FreeEdgeRow[] {
    return this.db
      .select()
      .from(canvasEdges)
      .where(eq(canvasEdges.projectId, this.projectId))
      .all()
      .map(({ id, sourceKey, sourcePort, targetKey, targetPort, kind }) => ({
        id,
        sourceKey,
        sourcePort,
        targetKey,
        targetPort,
        kind: kind === 'reference' ? 'reference' : 'data',
      }))
  }

  addEdge(input: Omit<FreeEdgeRow, 'id'> & { id?: string }): FreeEdgeRow {
    const row = { ...input, id: input.id ?? randomUUID() }
    this.db
      .insert(canvasEdges)
      .values({ ...row, projectId: this.projectId })
      .run()
    return row
  }
}
