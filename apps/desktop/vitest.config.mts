import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'renderer',
    environment: 'jsdom',
    include: ['src/renderer/**/*.test.{ts,tsx}'],
    setupFiles: ['src/renderer/test/setup.ts'],
  },
})
