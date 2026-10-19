/* global document, window */
// 錄一段約 40 秒的「需要重跑」與「詳情面板」影片（M6-8c，給審查用）：
// 點鏡頭的 ↗ 開鏡頭面板 → 改描述「只儲存修改」→ 那一鏡的圖與影片標「需要重跑」→ 關面板
// → 上方列「全部生成」只補它們 → 恢復完成 → 剪輯的 ↗ 開成品面板 → 預覽 → 重新接片 → 匯出。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/canvas-stale-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('canvas-stale-m6-8c.mp4')

const center = (id) =>
  page.evaluate((nodeId) => {
    const rf = window.__svsCanvas
    const node = rf.getNode(nodeId)
    if (node)
      void rf.setCenter(node.position.x + 230, node.position.y + 60, { zoom: 0.9, duration: 600 })
  }, id)
const statusOf = (id) =>
  page.evaluate((nodeId) => window.__svsCanvas.getNode(nodeId)?.data.status, id)

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1500)
await page.getByTestId('fit-view').click()
await pause(1800)

// 1) 第 2 鏡的 ↗：右側滑入鏡頭面板
const shot = await page.evaluate(
  () =>
    window.__svsCanvas.getNodes().find((n) => n.data.kind === 'shot' && n.data.title === '第 2 鏡')
      ?.id,
)
await center(shot)
await pause(1200)
await clickAt(page.getByTestId(`open-${shot}`))
await page.getByTestId('shot-panel').waitFor()
await pause(1800)

// 2) 改描述、只儲存（不重新生成）→ 圖與影片標「需要重跑」
const description = page.getByTestId('shot-description')
await clickAt(description)
await description.fill('')
await page.keyboard.type('貓躲在屋簷下，看著路燈下的雨', { delay: 60 })
await pause(600)
await clickAt(page.getByTestId('shot-save'))
await page.waitForFunction(
  (id) => window.__svsCanvas.getNode(`${id}:image`)?.data.status === 'stale',
  shot,
  { timeout: 30_000 },
)
await pause(2500)

// 3) 關掉面板，上方列「全部生成」只補需要重跑的這一鏡
await clickAt(page.getByTestId('shot-panel-close'))
await pause(1200)
await clickAt(page.getByTestId('run-all'))
await page.getByTestId('run-confirm').waitFor()
await pause(3000)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.waitForFunction(
  (id) => window.__svsCanvas.getNode(`${id}:video`)?.data.status === 'done',
  shot,
  { timeout: 120_000 },
)
console.log('補跑後', await statusOf(`${shot}:image`), await statusOf(`${shot}:video`))
await pause(2500)

// 4) 剪輯的 ↗：成品面板（預覽、重新接片、匯出）
await center('cut')
await pause(1200)
await clickAt(page.getByTestId('open-cut'))
await page.getByTestId('final-cut-panel').waitFor()
await pause(2000)
await clickAt(page.getByTestId('final-cut-rejoin'))
await page.waitForFunction(
  () => document.querySelector('[data-testid="final-cut-rejoin"]')?.textContent === '重新接片',
  undefined,
  { timeout: 60_000 },
)
await pause(1500)
await clickAt(page.getByTestId('final-cut-video'))
await pause(3500)
await clickAt(page.getByTestId('final-cut-export'))
await page.getByTestId('final-cut-exported').waitFor()
await pause(2500)

await stop()
