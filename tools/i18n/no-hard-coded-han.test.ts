import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'

import { HAN_EXCEPTIONS } from './han-exceptions.mjs'
import { hanConfigs } from './no-hard-coded-han.mjs'

const ROOT = join(__dirname, '..', '..')

// 只驗證這條規則（不需要型別資訊），所以不載入完整的 eslint.config.mjs；解析器用 typescript-eslint（有 .tsx）。
const make = (exceptions = HAN_EXCEPTIONS): ESLint =>
  new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
      },
      ...hanConfigs(exceptions),
    ],
  })

const real = make()
async function problems(eslint: ESLint, filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? []).map((m) => m.message)
}

const NORMAL = 'apps/desktop/src/main/x.ts'
const NORMAL_TSX = 'apps/desktop/src/renderer/x.tsx'

describe('寫死的中文字串規則：會擋什麼', () => {
  it('字串、樣板字串（含有變數的）、JSX 文字、JSX 屬性、型別裡的字面值都擋', async () => {
    expect(await problems(real, NORMAL, "const a = '儲存'\n")).toHaveLength(1)
    // 樣板字串被 ${} 切成幾片，每一片有中文就報一次
    expect(await problems(real, NORMAL, 'const a = `共 ${1} 個`\n')).toHaveLength(2)
    expect(await problems(real, NORMAL, 'const a = `${1} 個`\n')).toHaveLength(1)
    expect(await problems(real, NORMAL, "type A = '吃' | 'in'\n")).toHaveLength(1)
    expect(await problems(real, NORMAL_TSX, 'export const a = <p>你好</p>\n')).toHaveLength(1)
    expect(await problems(real, NORMAL_TSX, 'export const a = <p title="你好" />\n')).toHaveLength(
      1,
    )
    expect(await problems(real, 'packages/db/src/x.ts', "export const a = '預設'\n")).toHaveLength(
      1,
    )
  })

  it('不擋：註解、沒有中文的字串、t() 的 key', async () => {
    const code = [
      '// 註解裡的中文不算',
      '/* 區塊註解 中文 */',
      "const a = 'save'",
      "const b = t('menu.save')",
      'export const c = <p>Hello</p>',
    ].join('\n')
    expect(await problems(real, NORMAL_TSX, code)).toEqual([])
  })

  it('錯誤訊息講得出怎麼辦（改 t()／msg()，或加例外並寫理由）', async () => {
    const [message] = await problems(real, NORMAL, "const a = '儲存'\n")
    expect(message).toContain('t()')
    expect(message).toContain('han-exceptions.mjs')
  })

  it('例外：繁中字串檔、測試、e2e、清單上的檔案不擋；清單以外的同類檔案照擋', async () => {
    const code = "const a = '儲存'\n"
    for (const path of [
      'packages/schema/src/i18n/locales/zh-TW/menu.ts',
      'apps/desktop/src/main/x.test.ts',
      'apps/desktop/src/renderer/x.test.tsx',
      'apps/desktop/e2e/x.e2e.ts',
      'packages/workflows/src/nodes.ts',
      'apps/desktop/src/renderer/features/canvas/perf-overlay.tsx',
    ]) {
      expect(await problems(real, path, code), path).toEqual([])
    }
    for (const path of [
      'packages/workflows/src/other.ts',
      'apps/desktop/src/renderer/features/canvas/canvas-page.tsx',
      'packages/schema/src/i18n/locales/en/menu.ts',
      'apps/desktop/src/main/mcp/tools/film.ts',
    ]) {
      expect(await problems(real, path, code), path).toHaveLength(1)
    }
  })
})

describe('例外清單：每一條都有理由、而且都還需要', () => {
  it('每一條都寫了理由，沒有重複的檔案', () => {
    const seen = new Set<string>()
    for (const entry of HAN_EXCEPTIONS) {
      expect(entry.reason.trim().length, entry.files.join(',')).toBeGreaterThan(10)
      for (const file of entry.files) {
        expect(seen.has(file), `重複：${file}`).toBe(false)
        seen.add(file)
      }
    }
  })

  // 拿掉任何一條例外，就一定有真實檔案因此被擋下來（否則那一條是多餘的，要從清單刪掉）
  const tracked = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => /^(apps|packages)\//.test(file) && !file.endsWith('.d.ts'))
    .filter((file) => file !== 'packages/db/src/migrations.generated.ts')
    .filter((file) => /[㐀-鿿]/.test(readFileSync(join(ROOT, file), 'utf8')))

  for (const entry of HAN_EXCEPTIONS) {
    it(`拿掉「${entry.files[0] ?? ''}」${entry.files.length > 1 ? ` 等 ${String(entry.files.length)} 項` : ''}這條例外，規則就會紅`, async () => {
      const without = make(HAN_EXCEPTIONS.filter((other) => other !== entry))
      let blocked = 0
      for (const file of tracked) {
        const [result] = await without.lintText(readFileSync(join(ROOT, file), 'utf8'), {
          filePath: file,
        })
        const hits = (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax')
        if (hits.length === 0) continue
        // 有被擋，確認這個檔案本來是靠這一條例外放行的
        const [full] = await real.lintText(readFileSync(join(ROOT, file), 'utf8'), {
          filePath: file,
        })
        expect(
          (full?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax'),
          file,
        ).toEqual([])
        blocked++
      }
      expect(blocked, '拿掉之後沒有任何檔案被擋：這一條例外是多餘的，請刪掉').toBeGreaterThan(0)
    }, 120_000)
  }

  it('目前所有正式程式都沒有未列例外的寫死中文', async () => {
    const bad: string[] = []
    for (const file of tracked) {
      const [result] = await real.lintText(readFileSync(join(ROOT, file), 'utf8'), {
        filePath: file,
      })
      if ((result?.messages ?? []).some((m) => m.ruleId === 'no-restricted-syntax')) bad.push(file)
    }
    expect(bad).toEqual([])
    // 要逐一檢查每一個有中文的檔案：CI 負載高時超過預設的 20 秒會逾時（跟上面每條例外的測試同樣給 120 秒）
  }, 120_000)
})
