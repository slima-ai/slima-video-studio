// 找出「模組載入時就執行」的 t() 呼叫：語言在那一刻還沒定下來，換語言也不會變（要改成 msg()＋用的時候才 t()）。
// 用法：node tools/i18n/module-level-t.mjs <檔案…>（沒給檔案就掃 apps 與 packages 的 src）
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const ROOT = resolve(new URL('../..', import.meta.url).pathname)

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out' || name === 'dist' || name.startsWith('.'))
      continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.(test|e2e)\./.test(name) &&
      !full.includes('/i18n/locales/')
    )
      out.push(full)
  }
}

/** 這個函式是「被呼叫的時候才跑」的（有名字的函式、方法、指定給變數的箭頭函式）。 */
function isDeferred(fn) {
  const p = fn.parent
  if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isConstructorDeclaration(fn))
    return true
  if (ts.isGetAccessor(fn) || ts.isSetAccessor(fn)) return true
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p))
    return true
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return true
  if (ts.isReturnStatement(p) || ts.isArrowFunction(p)) return true
  if (ts.isCallExpression(p) && p.arguments.includes(fn)) {
    // 傳給 React 的 hook／事件的函式是之後才跑；傳給 map／Array.from 之類的會立刻跑
    const name = p.expression.getText()
    return /^(use[A-Z]|set[A-Z]|on[A-Z]|setTimeout|setInterval|addEventListener|requestAnimationFrame|handle|register|ipcMain\.handle|[\w.]*\.(on|once|then|catch|finally|handle|subscribe))/.test(
      name,
    )
  }
  return false
}

export function findModuleLevelT(file) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const hits = []
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't'
    ) {
      let cur = node.parent
      let deferred = false
      while (cur && !ts.isSourceFile(cur)) {
        if (
          (ts.isFunctionLike(cur) || ts.isClassDeclaration(cur)) &&
          (ts.isClassDeclaration(cur) || isDeferred(cur))
        ) {
          deferred = true
          break
        }
        cur = cur.parent
      }
      if (!deferred) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        hits.push({ line: line + 1, text: node.getText().slice(0, 70) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2)
  const files = []
  if (args.length > 0) files.push(...args.map((a) => resolve(a)))
  else {
    for (const sub of ['apps', 'packages']) walk(join(ROOT, sub), files)
  }
  let n = 0
  for (const file of files) {
    for (const h of findModuleLevelT(file)) {
      console.log(`${file.replace(`${ROOT}/`, '')}:${h.line}  ${h.text}`)
      n++
    }
  }
  console.log(n === 0 ? '沒有模組載入時就執行的 t()' : `${n} 處模組載入時就執行的 t()`)
  process.exit(n === 0 ? 0 : 1)
}
