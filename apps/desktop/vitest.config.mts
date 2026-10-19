import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'renderer',
    environment: 'jsdom',
    // 與根目錄 vitest.config.ts 的 TEST_TIMEOUT_MS 一致（慢機器上 5 秒太緊）
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: ['src/renderer/**/*.test.{ts,tsx}'],
    setupFiles: ['src/renderer/test/setup.ts'],
  },
})
