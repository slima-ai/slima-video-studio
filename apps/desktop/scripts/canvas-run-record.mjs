/* global document, window */
// 錄一段約 40 秒的「畫布執行」影片（M6-8b，給審查用）：
// 新增一個空鏡頭 → 影片節點 ▶（確認面板列兩步、那一串標亮）→ 補圖再補影片 → 上方列「全部都生成好了」
// → 已完成的影片 ▶ 重做 → 剪輯 ▶ 接成品 → Ctrl+Enter 執行選取的節點。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/canvas-run-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('canvas-run-m6-8b.mp4')

const center = (id) =>
  page.evaluate((nodeId) => {
    const rf = window.__svsCanvas
    const node = rf.getNode(nodeId)
    if (node)
      void rf.setCenter(node.position.x + 130, node.position.y + 60, { zoom: 1, duration: 600 })
  }, id)

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1500)
await page.getByTestId('fit-view').click()
await pause(1800)

// 1) 新增一個空鏡頭（從節點面板）
await clickAt(page.getByTestId('palette-shot'))
await pause(1500)
const newShot = await page.evaluate(() =>
  window.__svsCanvas
    .getNodes()
    .filter((n) => n.id.startsWith('shot:') && n.data.kind === 'video' && n.data.status === 'idle')
    .map((n) => n.id)
    .at(0),
)
await center(newShot)
await pause(1500)

// 2) 影片節點 ▶：先看確認面板（列出缺的兩步、那一串標亮）
await clickAt(page.getByTestId(`run-${newShot}`))
await page.getByTestId('run-confirm').waitFor()
await pause(3000)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.waitForFunction(
  (id) => window.__svsCanvas.getNode(id)?.data.status === 'done',
  newShot,
  { timeout: 120_000 },
)
await pause(2000)

// 3) 上方列變成「全部都生成好了」；已完成的影片 ▶ 重做
await pause(1500)
await clickAt(page.getByTestId(`run-${newShot}`))
await page.getByTestId('run-confirm').waitFor()
await pause(2500)
await page.keyboard.press('Escape')
await pause(800)

// 4) 再加一個空鏡頭，用上方列「全部生成」
await clickAt(page.getByTestId('palette-shot'))
await pause(1800)
await clickAt(page.getByTestId('run-all'))
await page.getByTestId('run-confirm').waitFor()
await pause(2500)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.waitForFunction(
  () => document.querySelector('[data-testid="run-all"]')?.textContent === '全部都生成好了',
  undefined,
  { timeout: 120_000 },
)
await pause(2000)

// 5) 剪輯節點 ▶：把全部影片接成成品
await page.getByTestId('fit-view').click()
await pause(1500)
await center('cut')
await pause(1200)
await clickAt(page.getByTestId('run-cut'))
await page.getByTestId('run-confirm').waitFor()
await pause(2500)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.getByTestId('toast').filter({ hasText: '成品接好了' }).waitFor({ timeout: 120_000 })
await pause(2500)

await stop()
