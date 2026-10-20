import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: './test-results',
  fullyParallel: true,
  // scripts/e2e.mjs 依這個數字替每個 worker 起一個自己的 Xvfb
  workers: Number(process.env.SVS_E2E_WORKERS ?? '2'),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'app', testIgnore: 'perf/**' },
    // 量 fps 的測試要獨佔 CPU：等其他測試都跑完才跑（uiux-spec §12.13 的 15 fps 回歸警戒線）
    { name: 'perf', testMatch: 'perf/**/*.e2e.ts', dependencies: ['app'] },
  ],
})
