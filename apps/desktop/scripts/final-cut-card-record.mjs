/* global window */
// 錄一段約 25 秒的「剪輯卡上的重新接片與匯出」影片（M6-11，給審查用）：
// 關掉第 2 鏡的「放進成品」（影片格子變淡、成品標要重新接）→ 剪輯卡「重新接片」：成品變第 2 版、短一鏡
// → 剪輯卡「匯出 MP4」：提示存到專案的「匯出」資料夾。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/final-cut-card-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('final-cut-m6-11.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const graph = async () => (await page.evaluate(() => window.svs.invoke('canvas.get', {}))).data

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)
const videos = (await graph()).nodes.filter((n) => n.kind === 'video')
// 縮到 0.7：第 2 鏡的影片和剪輯卡都在畫面裡
await page.evaluate((key) => {
  const rf = window.__svsCanvas
  const cut = rf.getNode('cut')
  const video = rf.getNode(key)
  return rf.setCenter(
    (cut.position.x + video.position.x) / 2 + 120,
    (cut.position.y + video.position.y) / 2 + 120,
    { zoom: 0.7, duration: 400 },
  )
}, videos[1].key)
await pause(1500)
console.log(
  `成品長度（前）：${String((await graph()).nodes.find((n) => n.kind === 'cut').final?.durationSec)}`,
)

mark('第 2 鏡不放進成品')
await clickAt(page.getByTestId(`incut-${videos[1].key}`))
await pause(2500)

mark('剪輯卡：重新接片')
await clickAt(page.getByTestId('cut-rejoin'))
await page.getByTestId('toast').filter({ hasText: '成品接好了' }).waitFor({ timeout: 60_000 })
await pause(2500)
console.log(
  `成品長度（後）：${String((await graph()).nodes.find((n) => n.kind === 'cut').final?.durationSec)}`,
)

mark('剪輯卡：匯出 MP4')
await clickAt(page.getByTestId('cut-export'))
await pause(3500)
mark('結束')

await stop()
