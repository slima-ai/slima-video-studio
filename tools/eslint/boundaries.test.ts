import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

import { boundaryConfigs } from './boundaries.mjs'

// 只驗證相依方向規則（不需要型別資訊），所以不載入完整的 eslint.config.mjs。
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.{ts,tsx}'], languageOptions: { sourceType: 'module' } },
    ...boundaryConfigs,
  ],
})

async function lint(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? []).map((m) => m.message)
}

describe('套件相依方向', () => {
  it('engine 不可以 import providers', async () => {
    const msgs = await lint('packages/engine/src/x.ts', "import '@svs/providers'\n")
    expect(msgs).toHaveLength(1)
  })

  it('engine 不可以 import electron', async () => {
    const msgs = await lint('packages/engine/src/x.ts', "import 'electron'\n")
    expect(msgs).toHaveLength(1)
  })

  it('engine 可以 import schema', async () => {
    const msgs = await lint('packages/engine/src/x.ts', "import '@svs/schema'\n")
    expect(msgs).toEqual([])
  })

  it('schema 不可以 import 任何其他套件', async () => {
    const msgs = await lint('packages/schema/src/x.ts', "import '@svs/engine'\n")
    expect(msgs).toHaveLength(1)
  })

  it('renderer 只能 import schema', async () => {
    const bad = await lint('apps/desktop/src/renderer/x.tsx', "import '@svs/db'\n")
    expect(bad).toHaveLength(1)
    const electron = await lint('apps/desktop/src/renderer/x.tsx', "import 'electron'\n")
    expect(electron).toHaveLength(1)
    const ok = await lint('apps/desktop/src/renderer/x.tsx', "import '@svs/schema'\n")
    expect(ok).toEqual([])
  })

  it('main 行程可以組裝所有套件', async () => {
    const msgs = await lint(
      'apps/desktop/src/main/x.ts',
      "import '@svs/engine'\nimport '@svs/providers'\nimport 'electron'\n",
    )
    expect(msgs).toEqual([])
  })
})
