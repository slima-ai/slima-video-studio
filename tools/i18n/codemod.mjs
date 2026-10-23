// 把程式裡寫死的中文字串換成 t('key')，並把中文放進 zh-TW 字串檔、英文放進 en 字串檔。可以在最新的 main 上重跑。
//
// 兩步（先 extract、寫好英文、再 apply）：
//   node tools/i18n/codemod.mjs extract <namespace> <檔案…> --out <extract.json>
//       找出每個檔案裡含中文的字串，列成 { 中文原文: { 出現位置, 種類, 是否能自動換 } }。
//   （把英文寫進 translations.json：{ "中文原文（{參數}照抄）": "English text" }）
//   node tools/i18n/codemod.mjs apply <namespace> <檔案…> --translations <translations.json>
//       能自動換的就換，換不了的（拼接、比對資料用的中文）列在輸出裡，留給人手改。
//
// 規則：
// - JSX 文字、JSX 屬性字串、函式裡的字串與樣板字串 → t('ns.key')（樣板字串的 ${x} 變成 {x} 參數）。
// - 模組層級（不在任何函式裡）的字串 → msg('ns.key')，用的地方要手動改成 t(…)（型別會擋沒改的）。
// - 拼接（'中文' + x）、比對資料用的字串（=== '中文'、case、物件鍵）→ 不動，列出來。
// - key 由英文翻譯變來（camelCase、最多 5 個字）；同一句中文共用同一個 key。
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ts = createRequire(join(ROOT, 'package.json'))('typescript')
const HAN = /[㐀-鿿]/
const LOCALES_DIR = join(ROOT, 'packages/schema/src/i18n/locales')

const args = process.argv.slice(2)
const mode = args.shift()
const namespace = args.shift()
const flag = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const [, value] = args.splice(i, 2)
  return value
}
const outFile = flag('--out')
const translationsFile = flag('--translations')
const filesFrom = flag('--files-from')
const files = [
  ...args,
  ...(filesFrom ? readFileSync(filesFrom, 'utf8').split('\n').filter(Boolean) : []),
].map((f) => resolve(f))

const isFunctionLike = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessor(n) ||
  ts.isSetAccessor(n)
const inFunction = (node) => {
  for (let p = node.parent; p; p = p.parent) if (isFunctionLike(p)) return true
  return false
}
const norm = (s) => s.replace(/\s+/g, ' ').trim()

/** 這個字串能不能換：回傳 undefined（能）或原因（不能）。 */
function skipReason(node) {
  const p = node.parent
  if (!p) return undefined
  if (
    ts.isLiteralTypeNode(p) ||
    ts.isCaseClause(p) ||
    ts.isImportDeclaration(p) ||
    ts.isExportDeclaration(p) ||
    ts.isComputedPropertyName(p) ||
    ts.isPropertySignature(p) ||
    ts.isEnumMember(p)
  )
    return '型別、case 或匯入'
  if (
    ts.isCallExpression(p) &&
    /(^|\.)(log|mainLog|logger|console)\??\.(info|warn|error|debug|log)$/.test(
      p.expression.getText(),
    )
  )
    return 'log（開發者看的，最後統一改英文）'
  if (ts.isPropertyAssignment(p) && p.name === node) return '物件的鍵'
  if (ts.isElementAccessExpression(p)) return '當索引用'
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind
    if (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken
    )
      return '拿來比對資料'
    if (op === ts.SyntaxKind.PlusToken) return '用 + 拼接（要合成一條帶參數的訊息，手改）'
  }
  return undefined
}

/** 樣板字串 → { text: '中文{name}中文', params: [[name, 原始碼]] } */
function templateParts(tpl, sf) {
  let text = tpl.head.text
  const params = []
  const used = new Set()
  for (const span of tpl.templateSpans) {
    const src = span.expression.getText(sf)
    let name = /^[A-Za-z_$][\w$]*$/.test(src)
      ? src
      : /^[\w$.?]+$/.test(src)
        ? src.split(/[.?]+/).filter(Boolean).at(-1)
        : ''
    if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) name = 'value'
    // 全大寫的常數名（APP_TITLE）→ 小寫的參數名（appTitle）
    if (name === name.toUpperCase() && name.length > 1)
      name = name.toLowerCase().replace(/_(\w)/g, (_, c) => c.toUpperCase())
    let unique = name
    for (let i = 2; used.has(unique); i++) unique = `${name}${String(i)}`
    used.add(unique)
    params.push([unique, src])
    text += `{${unique}}${span.literal.text}`
  }
  return { text, params }
}

const found = [] // { file, line, kind, zh, auto, reason, node info }

function scan(file) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const rel = relative(ROOT, file)
  const add = (info) => found.push({ file, rel, ...info })
  const visit = (node) => {
    const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
    if (ts.isJsxText(node) && HAN.test(node.text)) {
      const raw = node.text
      const zh = norm(raw)
      const lead = /^\s*/.exec(raw)[0]
      const trail = /\s*$/.exec(raw)[0]
      const start = node.getFullStart() + lead.length
      const end = node.getEnd() - trail.length
      const mixed = node.parent.children.some(
        (c) => c !== node && !(ts.isJsxText(c) && !c.text.trim()),
      )
      add({
        line: line(node),
        kind: mixed ? 'jsx-text(旁邊有別的元素)' : 'jsx-text',
        zh,
        params: [],
        range: [start, end],
        form: 'jsx-child',
      })
    } else if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      HAN.test(node.initializer.text)
    ) {
      const lit = node.initializer
      add({
        line: line(lit),
        kind: `屬性 ${node.name.getText(sf)}`,
        zh: norm(lit.text),
        params: [],
        range: [lit.getStart(), lit.getEnd()],
        form: 'jsx-attr',
      })
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (HAN.test(node.text) && !ts.isJsxAttribute(node.parent)) {
        const reason = skipReason(node)
        const module = !inFunction(node)
        add({
          line: line(node),
          kind: module ? '模組層級' : '字串',
          zh: norm(node.text),
          params: [],
          range: [node.getStart(), node.getEnd()],
          form: module ? 'msg' : 'call',
          reason,
        })
      }
    } else if (ts.isTemplateExpression(node)) {
      const { text: zh, params } = templateParts(node, sf)
      if (HAN.test(zh)) {
        const logCall =
          ts.isCallExpression(node.parent) &&
          /(^|\.)(log|mainLog|logger|console)\??\.(info|warn|error|debug|log)$/.test(
            node.parent.expression.getText(),
          )
        const module = !inFunction(node)
        add({
          line: line(node),
          kind: module ? '模組層級樣板' : '樣板字串',
          zh: norm(zh),
          params,
          range: [node.getStart(), node.getEnd()],
          form: module ? 'msg' : 'call',
          reason: logCall
            ? 'log（開發者看的，最後統一改英文）'
            : module && params.length > 0
              ? '模組層級有參數（要改成函式）'
              : undefined,
        })
      }
      return // 內層的片段已經併進去了
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { text, sf }
}

const sources = new Map()
for (const file of files) sources.set(file, scan(file))

if (mode === 'extract') {
  const out = {}
  for (const f of found) {
    const e = (out[f.zh] ??= { places: [], auto: true })
    e.places.push(
      `${f.rel}:${String(f.line)} ${f.kind}${f.reason ? `（不自動換：${f.reason}）` : ''}`,
    )
    if (f.reason) e.auto = false
  }
  if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 1))
  const manual = found.filter((f) => f.reason)
  console.log(
    `${String(found.length)} 處（不重複 ${String(Object.keys(out).length)} 句）；不能自動換 ${String(manual.length)} 處`,
  )
  for (const m of manual)
    console.log(`  手改：${m.rel}:${String(m.line)}  ${m.zh.slice(0, 40)}  ← ${m.reason}`)
  process.exit(0)
}

if (mode !== 'apply') throw new Error('用法：extract|apply <namespace> <檔案…>')
if (!translationsFile) throw new Error('apply 要 --translations <檔>')
const translations = JSON.parse(readFileSync(translationsFile, 'utf8'))
// 翻譯檔裡值是 null 的字串：不換（留給手改，或是 log 之類不翻的）
for (const f of found)
  if (!f.reason && translations[f.zh] === null) f.reason = '翻譯檔標成不換（null）'
// 先檢查每一句要換的都有翻譯，沒有就在動任何檔案之前停下來（不會改到一半）
const missing = [
  ...new Set(found.filter((f) => !f.reason && translations[f.zh] === undefined).map((f) => f.zh)),
]
if (missing.length > 0)
  throw new Error(`沒有英文翻譯（${String(missing.length)} 句）：\n${missing.join('\n')}`)

// --- key：由英文翻譯產生，同一句中文共用同一個 key ---
const slug = (en) => {
  const words = en
    .replace(/\{\w+\}/g, ' ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 5)
  const s = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
  return s || 'text'
}
const nsFileZh = join(LOCALES_DIR, 'zh-TW', `${namespace}.ts`)
const nsFileEn = join(LOCALES_DIR, 'en', `${namespace}.ts`)
const readDict = (file) => {
  if (!existsSync(file)) return {}
  const entries = [
    ...readFileSync(file, 'utf8').matchAll(/^\s+'([^']+)':\s*(?:\n\s*)?'((?:[^'\\]|\\.)*)',?$/gm),
  ]
  return Object.fromEntries(
    entries.map(([, k, v]) => [k, v.replace(/\\'/g, "'").replace(/\\\\/g, '\\')]),
  )
}
const zhDict = readDict(nsFileZh)
const enDict = readDict(nsFileEn)
const keyOfZh = new Map(Object.entries(zhDict).map(([k, v]) => [v, k]))
const taken = new Set(Object.keys(zhDict))
const keyFor = (zh) => {
  const known = keyOfZh.get(zh)
  if (known) return known
  const entry = translations[zh]
  if (entry === undefined) throw new Error(`沒有英文翻譯：${zh}`)
  // 值可以是字串（key 由英文自動產生），或 { en, key }（自己指定語意的 key，不含 namespace 前綴）
  const en = typeof entry === 'string' ? entry : entry.en
  const base = `${namespace}.${typeof entry === 'string' ? slug(en) : entry.key}`
  let key = base
  for (let i = 2; taken.has(key); i++) key = `${base}${String(i)}`
  taken.add(key)
  keyOfZh.set(zh, key)
  zhDict[key] = zh
  enDict[key] = en
  return key
}

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const manualLeft = []
for (const [file, { text }] of sources) {
  const list = found.filter((f) => f.file === file)
  const fileEdits = []
  let usesT = false
  let usesMsg = false
  for (const f of list) {
    if (f.reason) {
      manualLeft.push(`${f.rel}:${String(f.line)} ${f.zh.slice(0, 40)}（${f.reason}）`)
      continue
    }
    const key = keyFor(f.zh)
    const paramsObj =
      f.params.length > 0
        ? `, { ${f.params.map(([n, src]) => (n === src ? n : `${n}: ${src}`)).join(', ')} }`
        : ''
    let replacement
    if (f.form === 'jsx-child') {
      replacement = `{t(${q(key)})}`
      usesT = true
    } else if (f.form === 'jsx-attr') {
      replacement = `{t(${q(key)})}`
      usesT = true
    } else if (f.form === 'msg') {
      replacement = `msg(${q(key)})`
      usesMsg = true
    } else {
      replacement = `t(${q(key)}${paramsObj})`
      usesT = true
    }
    fileEdits.push({ start: f.range[0], end: f.range[1], replacement })
  }
  if (fileEdits.length === 0) continue
  let next = text
  for (const e of fileEdits.sort((a, b) => b.start - a.start))
    next = next.slice(0, e.start) + e.replacement + next.slice(e.end)
  // import：加進 '@svs/schema'（有就補 specifier，沒有就新增一行）；
  // @svs/schema 自己的檔案不能 import 自己的套件名（循環相依），改用到 i18n 的相對路徑
  const need = [usesT ? 't' : null, usesMsg ? 'msg' : null].filter(Boolean)
  const schemaSrc = join(ROOT, 'packages', 'schema', 'src')
  const source = file.startsWith(schemaSrc + '/')
    ? (relative(dirname(file), join(schemaSrc, 'i18n')) || '.').replace(/^(?!\.)/, './')
    : '@svs/schema'
  const importRe = new RegExp(
    `import\\s+(type\\s+)?\\{([^}]*)\\}\\s+from\\s+'${source.replace(/[./]/g, '\\$&')}'\\n`,
  )
  const m = importRe.exec(next)
  if (m && !m[1]) {
    const names = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const n of need) if (!names.includes(n)) names.push(n)
    next = next.replace(importRe, `import { ${names.join(', ')} } from '${source}'\n`)
  } else {
    const importAt = [...next.matchAll(/^import .*$/gm)]
    const line = `import { ${need.join(', ')} } from '${source}'\n`
    if (importAt.length === 0) next = line + '\n' + next
    else {
      const last = importAt.at(-1)
      // 找到最後一個 import 結束的位置（可能多行）
      const endIdx =
        next.indexOf(
          '\n',
          next.indexOf(' from ', last.index) >= 0 ? next.indexOf(' from ', last.index) : last.index,
        ) + 1
      next = next.slice(0, endIdx) + line + next.slice(endIdx)
    }
  }
  writeFileSync(file, next)
}

// --- 字串檔 ---
const render = (varName, dict, typeAnn) =>
  `${typeAnn}export const ${varName} = {\n${Object.entries(dict)
    .map(([k, v]) => `  ${q(k)}: ${q(v)},`)
    .join('\n')}\n} as const\n`
mkdirSync(dirname(nsFileZh), { recursive: true })
mkdirSync(dirname(nsFileEn), { recursive: true })
const varName = namespace.replace(/-(\w)/g, (_, c) => c.toUpperCase())
writeFileSync(nsFileZh, render(varName, zhDict, ''))
writeFileSync(nsFileEn, render(varName, enDict, ''))
// index 補上這個 namespace（index.ts 裡有兩個標記行，新的插在標記前面）
for (const lang of ['zh-TW', 'en']) {
  const indexFile = join(LOCALES_DIR, lang, 'index.ts')
  const idx = readFileSync(indexFile, 'utf8')
  if (idx.includes(`from './${namespace}'`)) continue
  writeFileSync(
    indexFile,
    idx
      .replace(
        '// <i18n:imports>',
        `import { ${varName} } from './${namespace}'\n// <i18n:imports>`,
      )
      .replace('// <i18n:spread>', `...${varName},\n  // <i18n:spread>`),
  )
}
console.log(
  `換了 ${String(found.filter((f) => !f.reason).length)} 處；留給手改 ${String(manualLeft.length)} 處`,
)
for (const m of manualLeft) console.log(`  手改：${m}`)
