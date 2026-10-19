/* global document, window */
// 錄一段約 45 秒的「畫布上的一句話」影片（M6-8a，給審查用）：
// 空畫布 → 新增一句話 → 寫故事、選鏡頭數 → 生成（確認花費）→ 節點一個個長出 → 再生成一次（新增一場）→ 取代全部的警告。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/canvas-grow-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir, { seed: false })
const stop = await record('canvas-grow-m6-8a.mp4')

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1800)

// 1) 空畫布：按「新增一句話」，節點出現並自動平移到看得見
await clickAt(page.getByTestId('empty-add-oneliner'))
await page.getByTestId('oneliner-story').waitFor()
await pause(1500)

// 2) 寫故事、選鏡頭數與秒數
await clickAt(page.getByTestId('oneliner-story'))
await page.keyboard.type('一隻貓在下雨的夜晚找到溫暖的家', { delay: 90 })
await pause(600)
await clickAt(page.getByTestId('oneliner-shots'))
await pause(500)
await clickAt(page.getByTestId('oneliner-shots-option-5'))
await pause(500)
await clickAt(page.getByTestId('oneliner-duration'))
await pause(500)
await clickAt(page.getByTestId('oneliner-duration-option-4'))
await pause(1000)

// 3) 按「生成影片」：先看花費確認
await clickAt(page.getByTestId('oneliner-generate'))
await page.getByTestId('run-confirm').waitFor()
await pause(2500)
await clickAt(page.getByTestId('run-confirm-ok'))

// 4) 節點一個個長出來
await page.waitForFunction(
  () => document.querySelector('[data-testid="canvas-root"]')?.dataset.growing === 'false',
  undefined,
  { timeout: 120_000 },
)
await pause(2500)

// 5) 全部顯示，再把一句話拉回中間，再生成一次（預設新增成新的一場）
await page.getByTestId('fit-view').click()
await pause(1800)
await page.evaluate(() => {
  const rf = window.__svsCanvas
  const node = rf.getNodes().find((n) => n.id.startsWith('node:'))
  void rf.setCenter(node.position.x + 150, node.position.y + 150, { zoom: 1, duration: 600 })
})
await pause(1200)
await clickAt(page.getByTestId('oneliner-generate'))
await page.getByTestId('run-confirm').waitFor()
await pause(1500)

// 6) 勾「取代全部」：出現警告、確認鈕變紅；先取消
await clickAt(page.getByTestId('grow-replace'))
await pause(2200)
await page.keyboard.press('Escape')
await pause(800)

// 7) 不取代，直接生成：新增第二個場
await clickAt(page.getByTestId('oneliner-generate'))
await page.getByTestId('run-confirm').waitFor()
await pause(1200)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.waitForFunction(
  () => document.querySelector('[data-testid="canvas-root"]')?.dataset.growing === 'false',
  undefined,
  { timeout: 120_000 },
)
await pause(2500)
await page.getByTestId('fit-view').click()
await pause(2500)

await stop()
