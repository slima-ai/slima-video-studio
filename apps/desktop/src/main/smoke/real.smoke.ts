import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

import { locateTools } from '../bundled-tools'
import { runSmoke, summarize } from './run-smoke'

/**
 * 真實 API 冒煙測試（`pnpm smoke:real`）：用自己的 Key 跑一次完整的「快速開始」，
 * 看每一步花多久、花多少錢、成品長什麼樣。會花真錢（預設 3 鏡 × 3 秒，通常不到 US$1）。
 *
 *   OPENROUTER_API_KEY=…  pnpm smoke:real            （只用 OpenRouter 一把：文字、圖片、影片都走它）
 *   FAL_KEY=…  OPENROUTER_API_KEY=…  pnpm smoke:real （兩把都填：同一個模型自動走比較便宜的那家）
 *
 * 選用：SVS_SMOKE_REGENERATE=1（再重新生成第 1 鏡並重新接片）、SVS_SMOKE_STORY、
 * SVS_SMOKE_LIMIT_USD（花費上限，預設 5）、SVS_SMOKE_MOCK=1（不連網，只檢查腳本本身）。
 */
const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '../../../smoke-output')

const falKey = process.env.FAL_KEY
const openrouterKey = process.env.OPENROUTER_API_KEY
const demo = process.env.SVS_SMOKE_MOCK === '1'
// 只填 OpenRouter 就要能出完整影片（M2-8 的驗收標準），所以 fal.ai 是選填
const keysMissing = !demo && !openrouterKey

const print = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

it.skipIf(keysMissing)('真實 API：快速開始跑完一支短片', async () => {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const workDir = join(outDir, stamp)
  mkdirSync(workDir, { recursive: true })
  const limit = Number(process.env.SVS_SMOKE_LIMIT_USD ?? '5')
  const report = await runSmoke({
    workDir,
    demoMode: demo,
    keys: demo ? {} : { openrouter: openrouterKey ?? '', ...(falKey ? { fal: falKey } : {}) },
    ...(process.env.SVS_SMOKE_STORY ? { story: process.env.SVS_SMOKE_STORY } : {}),
    ...(Number.isFinite(limit) ? { limitUsd: limit } : {}),
    regenerate: process.env.SVS_SMOKE_REGENERATE === '1',
    tools: () => locateTools(),
    say: (line) => {
      print(`  ${line}`)
    },
  })
  const file = join(workDir, 'smoke-report.json')
  writeFileSync(file, JSON.stringify(report, null, 2))
  print('')
  for (const line of summarize(report)) print(line)
  print(`報告：${file}`)
  expect(report.problem).toBeUndefined()
  expect(report.ok).toBe(true)
})

it.skipIf(!keysMissing)('沒有設定 Key：略過（說明怎麼跑）', () => {
  print('')
  print('沒有找到 API Key，略過真實 API 冒煙測試。')
  print('用法：OPENROUTER_API_KEY=… pnpm smoke:real（fal.ai 選填：再加 FAL_KEY=…）')
  print('只想確認腳本沒壞（不連網、不花錢）：SVS_SMOKE_MOCK=1 pnpm smoke:real')
})
