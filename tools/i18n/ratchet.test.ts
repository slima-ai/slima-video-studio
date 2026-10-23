import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ROOT, compare, readBaseline } from './ratchet.mjs'
import { countByFile } from './scan.mjs'

const temp: string[] = []
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 做一個小的假專案：路徑決定算不算（測試檔、字串檔不算）。 */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'svs-i18n-'))
  temp.push(root)
  writeFileSync(join(root, 'package.json'), '{}')
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), code)
  }
  return root
}

describe('寫死中文的掃描', () => {
  it('算字串、樣板字串、JSX 文字；不算註解、不算沒有中文的字串', () => {
    const root = fixture({
      'apps/a/src/x.tsx': [
        '// 註解裡的中文不算',
        "const a = '儲存'",
        'const b = `共 ${1} 個`',
        "const c = 'save'",
        'export const d = <p>你好</p>',
        '/* 區塊註解 中文 */',
      ].join('\n'),
    })
    expect(countByFile(root, ROOT)).toEqual({ 'apps/a/src/x.tsx': 3 })
  })

  it('測試檔、e2e、測試輔助、繁中字串檔本身都不算', () => {
    const root = fixture({
      'apps/a/src/x.test.ts': "const a = '儲存'",
      'apps/a/e2e/y.ts': "const a = '儲存'",
      'apps/a/src/renderer/test/z.ts': "const a = '儲存'",
      'packages/schema/src/i18n/locales/zh-TW/menu.ts': "export const menu = { 'a': '儲存' }",
      'apps/a/src/real.ts': "const a = '儲存'",
    })
    expect(countByFile(root, ROOT)).toEqual({ 'apps/a/src/real.ts': 1 })
  })
})

describe('棘輪：寫死的中文字串只准減少，不准增加', () => {
  it('比對：增加與減少都找得出來（新檔案算從 0 增加）', () => {
    expect(compare({ a: 3, b: 1, c: 2 }, { a: 2, b: 1, d: 5 })).toEqual({
      increased: [
        ['a', 2, 3],
        ['c', 0, 2],
      ],
      decreased: [['d', 5, 0]],
    })
  })

  it('目前的程式沒有任何檔案比基準多出寫死的中文字串；有減少就要更新基準', () => {
    const { increased, decreased } = compare(countByFile(ROOT), readBaseline())
    expect(
      increased,
      '這些檔案多了寫死的中文字串：改用 t("key")（字串放 packages/schema/src/i18n/locales/，作法見 docs/i18n.md）',
    ).toEqual([])
    expect(
      decreased,
      '這些檔案的中文字串變少了（很好）：跑 node tools/i18n/ratchet.mjs --update 把基準也降下來，之後就不會被加回去',
    ).toEqual([])
  })
})
