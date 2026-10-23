// 守門的棘輪：記每個檔案現在有幾條「寫死的中文字串」，只准減少、不准增加。
//   node tools/i18n/ratchet.mjs            印出目前的數字與基準的差
//   node tools/i18n/ratchet.mjs --update   把基準改成目前的數字（轉完一塊之後跑）
// 測試在 tools/i18n/ratchet.test.ts。全部轉完之後基準會是空的，換成 ESLint 規則（見 docs/i18n.md）。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { countByFile } from './scan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(here, '..', '..')
export const BASELINE_FILE = join(here, 'baseline.json')

export function readBaseline() {
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
}

/** 比對目前與基準：回傳 { increased: [[檔案, 基準, 現在]], decreased: [...] } */
export function compare(current, baseline) {
  const increased = []
  const decreased = []
  for (const file of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    const now = current[file] ?? 0
    const before = baseline[file] ?? 0
    if (now > before) increased.push([file, before, now])
    else if (now < before) decreased.push([file, before, now])
  }
  return { increased, decreased }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = countByFile(ROOT)
  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 1) + '\n')
    const total = Object.values(current).reduce((a, b) => a + b, 0)
    console.log(`基準已更新：${String(Object.keys(current).length)} 個檔案、${String(total)} 條。`)
  } else {
    const { increased, decreased } = compare(current, readBaseline())
    for (const [file, before, now] of increased)
      console.log(`增加  ${file}  ${String(before)} → ${String(now)}`)
    for (const [file, before, now] of decreased)
      console.log(`減少  ${file}  ${String(before)} → ${String(now)}`)
    if (increased.length + decreased.length === 0) console.log('和基準一樣。')
  }
}
