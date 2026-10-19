/* global window */
// 錄一段約 30 秒的「整理動畫、大專案的全部顯示與場名」影片（M6-12b，給審查用）：
// 把第 1 鏡拖開 → 按「整理」：格子滑回自動排好的位置（不是一下跳過去）
// → 開一個 120 鏡的示範專案 → 按「全部顯示」：裝不下時從第 1 場開始看、場名蓋在場框中間
// → 放大到 0.3：場名回到場框上方，不壓到上一場。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/polish-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('polish-m6-12b.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await clickAt(page.getByTestId('fit-view'))
await pause(1200)

mark('把第 1 鏡拖開')
const shot = await page.evaluate(
  () => window.__svsCanvas.getNodes().find((n) => n.data.kind === 'shot')?.id,
)
const box = await page.locator(`.react-flow__node[data-id="${shot}"]`).boundingBox()
await page.mouse.move(box.x + 60, box.y + 12, { steps: 10 })
await page.mouse.down()
await page.mouse.move(box.x + 60, box.y + 260, { steps: 25 })
await page.mouse.up()
await pause(1500)

mark('整理：滑回去')
await clickAt(page.getByTestId('tidy'))
await pause(2500)

mark('120 鏡的示範專案 → 全部顯示')
await page.evaluate(() => window.svs.invoke('dev.seedDemo', { shots: 120 }))
await page.waitForFunction(() => window.__svsCanvas.getNodes().length > 350)
await pause(800)
await clickAt(page.getByTestId('fit-view'))
await pause(3000)

mark('放大到 0.3')
await page.evaluate(() => {
  const rf = window.__svsCanvas
  const v = rf.getViewport()
  return rf.setViewport({ ...v, zoom: 0.3 }, { duration: 800 })
})
await pause(3000)
mark('結束')
await stop()
