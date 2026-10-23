// 找出程式裡「含中文字的字串」：用 TypeScript 解析，只算字串、樣板字串、JSX 文字（不算註解）。
// 給守門的棘輪測試與報表用；計畫書裡的 count-cjk.mjs 是同一個做法加上分類報表。
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const HAN = /[㐀-鿿]/
const SKIP_DIRS = new Set([
  'node_modules',
  'out',
  'dist',
  'test-results',
  '.git',
  'drizzle',
  'coverage',
  'playwright-report',
  'release',
])

/** 測試與測試輔助：不算進棘輪（測試固定用繁中跑，見 docs/i18n.md）。 */
export const isTestFile = (rel) =>
  /\.(test|e2e)\.(ts|tsx)$/.test(rel) ||
  /(^|\/)e2e\//.test(rel) ||
  /(^|\/)test-utils\//.test(rel) ||
  /(^|\/)renderer\/test\//.test(rel) ||
  /test-harness|test-deps|test-helpers|test-support|\/__tests__\//.test(rel)

/** 字串檔本身（繁中原文）不算：那裡就是中文該在的地方。 */
export const isLocaleSource = (rel) => rel.startsWith('packages/schema/src/i18n/locales/zh-TW/')

export function listSourceFiles(root) {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) files.push(path)
    }
  }
  for (const top of ['apps', 'packages']) if (existsSync(join(root, top))) walk(join(root, top))
  return files
}

/** 每個檔案「含中文字的字串」有幾條（只算正式程式）。回傳 { 'apps/…/x.ts': 3, … }。 */
export function countByFile(root, resolveFrom = root) {
  const ts = createRequire(join(resolveFrom, 'package.json'))('typescript')
  const counts = {}
  for (const file of listSourceFiles(root)) {
    const rel = relative(root, file)
    if (isTestFile(rel) || isLocaleSource(rel)) continue
    const text = readFileSync(file, 'utf8')
    if (!HAN.test(text)) continue
    const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind)
    let n = 0
    const visit = (node) => {
      if (ts.isTemplateExpression(node)) {
        // 一個樣板字串算一條（不管中文被 ${} 切成幾片）
        const pieces = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
        if (pieces.some((piece) => HAN.test(piece))) n++
        for (const span of node.templateSpans) visit(span.expression)
        return
      }
      const literal =
        ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)
          ? node.text
          : undefined
      if (literal !== undefined && HAN.test(literal)) n++
      ts.forEachChild(node, visit)
    }
    visit(sf)
    if (n > 0) counts[rel] = n
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}
