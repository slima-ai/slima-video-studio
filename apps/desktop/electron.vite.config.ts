import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

import { buildCsp } from './src/shared/csp'

// workspace 套件以 TypeScript 原始碼提供，必須打包進輸出，不能當外部相依。
const WORKSPACE_PACKAGES = [
  '@svs/schema',
  '@svs/db',
  '@svs/engine',
  '@svs/providers',
  '@svs/media',
  '@svs/slima',
  '@svs/workflows',
]

/** 把 %CSP% 換成對應模式的內容安全政策。 */
function injectCsp(): Plugin {
  let dev = false
  return {
    name: 'svs-inject-csp',
    configResolved(config) {
      dev = config.command === 'serve'
    },
    transformIndexHtml(html) {
      return html.replace('%CSP%', buildCsp({ dev }))
    },
  }
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: WORKSPACE_PACKAGES },
      // 第二個入口：給 Claude Desktop 這類只會啟動指令的 AI 工具用的 stdio 轉接（out/main/mcp-stdio-bridge.js）
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'mcp-stdio-bridge': resolve(__dirname, 'src/main/mcp-stdio-bridge.ts'),
        },
      },
    },
  },
  preload: {
    // sandbox 預載腳本只能 require electron 與少數內建模組，所以第三方相依全部打包進去
    build: { externalizeDeps: false },
  },
  renderer: {
    plugins: [react(), tailwindcss(), injectCsp()],
  },
})
