/* global window */
// 錄一段約 40 秒的「？選單：鍵盤快捷鍵與效能自測」影片（M6-12a，給審查用）：
// 上方列「？」→ 鍵盤快捷鍵 → 知道了 →「？」→ 效能自測 → 產生 250 鏡示範專案（確認）
// → 畫布全部顯示 250 鏡 → 量讀取時間 → 自動平移 4 秒，看平均 fps → 選一個角色：它的參考線才畫出來。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/perf-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir, { seed: false })
const stop = await record('perf-m6-12a.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)

mark('？ → 鍵盤快捷鍵')
await clickAt(page.getByTestId('help-menu'))
await pause(600)
await clickAt(page.getByRole('menuitem', { name: '鍵盤快捷鍵' }))
await pause(3000)
await clickAt(page.getByRole('button', { name: '知道了' }))
await pause(600)

mark('？ → 效能自測')
await clickAt(page.getByTestId('help-menu'))
await pause(600)
await clickAt(page.getByRole('menuitem', { name: /效能自測/ }))
await pause(1500)

mark('產生 250 鏡示範專案')
await clickAt(page.getByTestId('perf-seed'))
await pause(1500)
await clickAt(page.getByTestId('perf-seed-ok'))
await page
  .getByTestId('perf-message')
  .filter({ hasText: '250 個鏡頭' })
  .waitFor({ timeout: 120_000 })
await pause(2500)

mark('量讀取時間')
await clickAt(page.getByTestId('perf-measure-load'))
await pause(1500)

mark('自動平移 4 秒')
await clickAt(page.getByTestId('perf-pan'))
await page.getByTestId('perf-pan-result').waitFor({ timeout: 15_000 })
console.log(await page.getByTestId('perf-pan-result').textContent())
await pause(3000)

mark('關掉效能自測，選角色：參考線才畫出來')
await clickAt(page.getByTestId('perf-overlay').getByRole('button', { name: '關閉' }))
await pause(600)
const hero = await page.evaluate(
  () => window.__svsCanvas.getNodes().find((n) => n.data.kind === 'character')?.id,
)
await page.evaluate((id) => {
  const node = window.__svsCanvas.getNode(id)
  window.__svsCanvas.setCenter(node.position.x + 500, node.position.y + 150, {
    zoom: 0.6,
    duration: 600,
  })
}, hero)
await pause(1200)
const card = await page.locator(`.react-flow__node[data-id="${hero}"]`).boundingBox()
await page.mouse.move(card.x + 40, card.y + 10, { steps: 15 })
await page.mouse.click(card.x + 40, card.y + 10)
await pause(3000)
mark('結束')

await stop()
