// 把 drizzle-kit 產生的 SQL migration 內嵌成 TypeScript（src/migrations.generated.ts），
// 這樣打包後的主行程不需要讀檔案系統就能 migrate。
// 用法：pnpm --filter @svs/db db:generate（先 drizzle-kit generate，再執行這支腳本）。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DRIZZLE_DIR = join(here, '..', 'drizzle')
const OUT_FILE = join(here, '..', 'src', 'migrations.generated.ts')

export function buildMigrationsSource(drizzleDir = DRIZZLE_DIR) {
  const journal = JSON.parse(readFileSync(join(drizzleDir, 'meta', '_journal.json'), 'utf8'))
  const migrations = journal.entries.map((entry) => {
    const sql = readFileSync(join(drizzleDir, `${entry.tag}.sql`), 'utf8')
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return { tag: entry.tag, statements }
  })
  return [
    '// 由 scripts/embed-migrations.mjs 產生，請勿手動修改。',
    '// 更新方式：pnpm --filter @svs/db db:generate',
    '',
    'export interface Migration {',
    '  /** drizzle-kit 產生的檔名（不含副檔名），例如 0000_content。 */',
    '  tag: string',
    '  statements: readonly string[]',
    '}',
    '',
    `export const MIGRATIONS: readonly Migration[] = ${JSON.stringify(migrations, null, 2)}`,
    '',
  ].join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(OUT_FILE, buildMigrationsSource())
  console.log(`已寫入 ${OUT_FILE}`)
}
