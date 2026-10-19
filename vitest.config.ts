import { defineConfig } from 'vitest/config'

// 單一測試／hook 的逾時：只是「卡住了」的保險，不是效能門檻。預設 5 秒對慢一點的機器（例如 GitHub 的共用 runner，
// 比開發機慢 4～5 倍）太緊：「建專案 → 跑 FFmpeg → 接片」這類測試在開發機約 1 秒，在 runner 上會超過 5 秒而誤判失敗。
const TEST_TIMEOUT_MS = 20_000

export default defineConfig({
  test: {
    // 這台機器同時有好幾個專案在跑測試，平行數固定最多 8，不用 CPU 數推算（tools/config/worker-cap.test.ts 釘住）
    maxWorkers: 8,
    projects: [
      // renderer（React + jsdom）有自己的設定
      'apps/desktop/vitest.config.mts',
      {
        test: {
          name: 'node',
          environment: 'node',
          testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS,
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
          exclude: ['apps/desktop/src/renderer/**', '**/node_modules/**'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/test-helpers.ts', 'packages/test-utils/**'],
      // 門檻：engine 與 schema ≥ 90%，其他套件 ≥ 75%（有實作的套件才檢查）
      thresholds: {
        'packages/engine/src/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'packages/schema/src/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'packages/db/src/**': { statements: 75, branches: 75, functions: 75, lines: 75 },
      },
    },
  },
})
