import { AppError, ProjectSchema, type Project } from '@svs/schema'
import { eq } from 'drizzle-orm'

import type { AppDb } from '../database'
import { dropNulls } from '../rows'
import { projects } from '../tables/core'

export type ProjectPatch = Partial<
  Pick<Project, 'name' | 'aspectRatio' | 'defaultStyleId' | 'budget' | 'models'>
>

/** 專案資料庫裡只會有一列 projects。 */
export class ProjectsRepository {
  constructor(
    private readonly db: AppDb,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 新建專案（資料庫裡還沒有專案時才會用到）。 */
  insert(project: Project): Project {
    this.db.insert(projects).values(project).run()
    return this.get()
  }

  get(): Project {
    const row = this.db.select().from(projects).get()
    if (!row) {
      throw new AppError({
        code: 'project_invalid',
        userMessage: '專案資料庫裡沒有專案資料。',
      })
    }
    // 資料庫也是外部邊界：讀出來要驗證
    return ProjectSchema.parse(dropNulls(row))
  }

  update(patch: ProjectPatch): Project {
    const current = this.get()
    const next = ProjectSchema.parse({
      ...current,
      ...patch,
      updatedAt: this.now().toISOString(),
    })
    this.db.update(projects).set(next).where(eq(projects.id, current.id)).run()
    return next
  }

  setSchemaVersion(version: number): void {
    this.db.update(projects).set({ schemaVersion: version }).run()
  }
}
