import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** 白話介面：使用者看得到的字不能出現這些業界用語。 */
const JARGON = ['節點']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$|test-|test\//.test(path) ? [path] : []
  })
}

/** 拿掉註解，剩下的中文只會在字串或 JSX 文字裡（變數名不用中文）。 */
const withoutComments = (code: string): string =>
  code.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:'"`])\/\/.*$/gm, '$1')

describe('介面用語', () => {
  it('畫面（renderer）與主行程回給畫面的訊息裡沒有「節點」這類術語', () => {
    const roots = [join(__dirname, '..', 'renderer'), __dirname]
    const offenders = roots.flatMap((root) =>
      sourceFiles(root).flatMap((file) => {
        const code = withoutComments(readFileSync(file, 'utf8'))
        return JARGON.filter((word) => code.includes(word)).map((word) => `${file}：${word}`)
      }),
    )
    expect(offenders).toEqual([])
  })
})
