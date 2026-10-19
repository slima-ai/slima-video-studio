import { defineConfig } from 'drizzle-kit'

// 只用來產生 SQL migration（pnpm --filter @svs/db db:generate）。
// 0000 內容資料、0001 執行與帳本；之後的 migration 各自一個檔案（見 drizzle/）。
export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/tables/core.ts', './src/tables/execution.ts', './src/tables/canvas.ts'],
  out: './drizzle',
})
