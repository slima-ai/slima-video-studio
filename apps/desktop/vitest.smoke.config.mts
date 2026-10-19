import { defineConfig } from 'vitest/config'

// 真實 API 冒煙測試專用設定（`pnpm smoke:real`），不會被一般的 `pnpm test` 撈到
export default defineConfig({
  test: {
    maxWorkers: 8,
    name: 'smoke',
    environment: 'node',
    include: ['src/main/smoke/real.smoke.ts', 'src/main/smoke/slima.smoke.ts'],
    testTimeout: 30 * 60_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
})
