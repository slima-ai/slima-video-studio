import { SlimaLinkSchema, type SlimaEntityType, type SlimaLink } from '@svs/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { AppDb } from '../database'
import { dropNulls } from '../rows'
import { slimaLinks } from '../tables/core'

export interface SlimaLinkInput {
  entityType: SlimaEntityType
  entityId: string
  bookToken: string
  path: string
  remoteVersion?: string | undefined
}

/**
 * 從 Slima 匯入的東西和來源檔案的對應：書本 token、檔案路徑，以及匯入當時內容的版本標記。
 * 之後用它提示「Slima 有新版本」。同一個實體對同一個來源檔案只會有一筆（重新匯入會更新）。
 */
export class SlimaLinksRepository {
  constructor(
    private readonly db: AppDb,
    private readonly projectId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): SlimaLink[] {
    return this.db
      .select()
      .from(slimaLinks)
      .where(eq(slimaLinks.projectId, this.projectId))
      .orderBy(asc(sql`rowid`))
      .all()
      .map((row) => SlimaLinkSchema.parse(dropNulls(row)))
  }

  forEntity(entityType: SlimaEntityType, entityId: string): SlimaLink | undefined {
    return this.list().find((l) => l.entityType === entityType && l.entityId === entityId)
  }

  /** 這個來源檔案匯入過的所有實體。 */
  forSource(bookToken: string, path: string): SlimaLink[] {
    return this.list().filter((l) => l.bookToken === bookToken && l.path === path)
  }

  /** 同一個實體、同一個來源檔案已經有連結就更新版本，沒有就新增（一個實體可以來自好幾個檔案）。 */
  upsert(input: SlimaLinkInput): SlimaLink {
    const existing = this.list().find(
      (l) =>
        l.entityType === input.entityType &&
        l.entityId === input.entityId &&
        l.bookToken === input.bookToken &&
        l.path === input.path,
    )
    const importedAt = this.now().toISOString()
    if (existing) {
      this.db
        .update(slimaLinks)
        .set({
          remoteVersion: input.remoteVersion ?? null,
          importedAt,
        })
        .where(and(eq(slimaLinks.id, existing.id), eq(slimaLinks.projectId, this.projectId)))
        .run()
      return { ...existing, ...input, importedAt }
    }
    const row = {
      id: randomUUID(),
      projectId: this.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      bookToken: input.bookToken,
      path: input.path,
      remoteVersion: input.remoteVersion ?? null,
      importedAt,
    }
    this.db.insert(slimaLinks).values(row).run()
    return SlimaLinkSchema.parse(dropNulls(row))
  }
}
