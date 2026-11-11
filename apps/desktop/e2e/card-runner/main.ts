// 真的 Electron 裡跑「字卡服務」的小程式（只給 e2e/cards.e2e.ts 用，不會進安裝檔）：
// 用正式的 createCardService 與 renderHtmlWithElectron，把幾種卡畫成 PNG，寫進指定資料夾，再把結果印成 JSON 檔。
// 用法：electron <這支打包後的檔> <輸出資料夾> <封面圖路徑> <字型路徑>
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  renderCardWithElectron,
  renderHtmlWithElectron,
} from '../../src/main/cards/render-electron'
import { createCardService, type CardAssets } from '../../src/main/cards/card-service'

const [outDir, coverPath, fontPath] = process.argv.slice(-3) as [string, string, string]

const logs: string[] = []

async function run(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const files = new Map<string, { path: string; mime: string }>()
  const hashOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
  const coverBytes = (await import('node:fs')).readFileSync(coverPath)
  const coverHash = hashOf(coverBytes)
  files.set(coverHash, { path: coverPath, mime: 'image/png' })
  const assets: CardAssets = {
    put: (bytes, mime) => {
      const hash = hashOf(bytes)
      const path = join(outDir, `asset-${hash.slice(0, 12)}.png`)
      writeFileSync(path, bytes)
      files.set(hash, { path, mime })
      return Promise.resolve({ hash, path, mime, bytes: bytes.length, created: true })
    },
    find: (hash) => files.get(hash),
  }
  const service = createCardService({
    render: renderHtmlWithElectron,
    assets,
    fontUrl: pathToFileURL(fontPath).href,
    log: (message) => logs.push(message),
  })
  const noFont = createCardService({
    render: renderHtmlWithElectron,
    assets,
    fontUrl: pathToFileURL(join(outDir, 'missing-font.otf')).href,
    log: (message) => logs.push(`[no-font] ${message}`),
  })
  const results: Record<string, unknown> = {}
  for (const ratio of ['16:9', '9:16'] as const) {
    const tag = ratio === '16:9' ? 'wide' : 'tall'
    const text = await service.render(
      { kind: 'card', text: '他回來了', subtext: '黑藤裂谷・第一章' },
      ratio,
    )
    const title = await service.render(
      {
        kind: 'title',
        title: '黑藤裂谷',
        author: '某某作者 著',
        endLine: '12 月 1 日　全台書店上市',
        coverAssetHash: coverHash,
        footnote: 'Video generated with Kling AI',
      },
      ratio,
    )
    const long = await service.render(
      { kind: 'card', text: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥' },
      ratio,
    )
    const again = await service.render(
      { kind: 'card', text: '他回來了', subtext: '黑藤裂谷・第一章' },
      ratio,
    )
    const size = ratio === '16:9' ? 720 : 1280
    const credits = await renderCardWithElectron({
      lines: [
        'Video generated with Kling AI',
        'Images generated with GPT Image (OpenAI)',
        'Voice by MiniMax',
        'Made with Slima Video Studio',
      ],
      width: ratio === '16:9' ? 1280 : 720,
      height: size,
    })
    writeFileSync(join(outDir, `credits-${tag}.png`), credits)
    for (const [name, result] of [
      ['text', text],
      ['title', title],
      ['long', long],
    ] as const) {
      const found = files.get(result.assetHash)
      if (found) copyFileSync(found.path, join(outDir, `${name}-${tag}.png`))
    }
    results[tag] = { text, title, long, againCached: again.cached, againHash: again.assetHash }
  }
  // 字型檔不見：退回系統字型，仍然畫得出來，log 有記
  const fallback = await noFont.render({ kind: 'card', text: '他回來了' }, '16:9')
  const found = files.get(fallback.assetHash)
  if (found) copyFileSync(found.path, join(outDir, 'text-fallback-font.png'))
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ results, logs }, null, 2))
}

app
  .whenReady()
  .then(run)
  .then(() => {
    app.exit(0)
  })
  .catch((error: unknown) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    writeFileSync(join(outDir, 'error.txt'), [detail, ...logs].join('\n'))
    app.exit(1)
  })
