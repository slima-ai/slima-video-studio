import { describe, expect, it } from 'vitest'

import { findModuleLevelT } from './module-level-t.mjs'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..')

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'out', 'dist'].includes(name) || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.(test|e2e)\./.test(name) &&
      !full.includes('/i18n/locales/')
    )
      out.push(full)
  }
  return out
}

describe('模組載入時不能呼叫 t()', () => {
  it('t() 在載入的那一刻就跑，語言還沒定下來、換語言也不會變：常數表用 msg()，選項清單做成函式', () => {
    const hits: string[] = []
    for (const sub of ['apps', 'packages']) {
      for (const file of sources(join(ROOT, sub))) {
        for (const hit of findModuleLevelT(file) as { line: number; text: string }[]) {
          hits.push(`${file.replace(`${ROOT}/`, '')}:${String(hit.line)}  ${hit.text}`)
        }
      }
    }
    expect(hits).toEqual([])
  })
})
