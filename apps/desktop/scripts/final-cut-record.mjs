/* global window */
// 錄一段約 50 秒的「成品」影片（M6-7d-5，給審查用）：
// 剪輯卡用成品第一格當縮圖、寫第幾版與長度、按 ▶ 在卡片上播放（P、Z2）
// → 關掉一鏡的「放進成品」：剪輯卡提醒要重新接、上方列變「接成成品」（Z1）
// → 一行的確認「接成成品 · 2 段 · 免費（在本機處理）」（Z10）→ 接好變 v2、「全部都生成好了」（Z1、Z2）
// → 新增一個空鏡頭：「全部生成」的清單最後一步是接成品，做完變 v3（Z1）。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/final-cut-record.mjs <輸出資料夾>
// 每一段開始的秒數會印出來，填進驗收清單。
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('final-cut-m6-7d5.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const center = (key, zoom = 1) =>
  page.evaluate(
    ([id, z]) => {
      const n = window.__svsCanvas.getNode(id)
      const w = n.measured?.width ?? n.width ?? 230
      const h = n.measured?.height ?? n.height ?? 230
      void window.__svsCanvas.setCenter(n.position.x + w / 2 - 260, n.position.y + h / 2, {
        zoom: z,
        duration: 600,
      })
    },
    [key, zoom],
  )
const videos = () =>
  page.evaluate(() =>
    window.__svsCanvas
      .getNodes()
      .filter((n) => n.data.kind === 'video')
      .map((n) => n.id),
  )

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1000)

// 1) P、Z2：剪輯卡的成品（第一格、第幾版、長度），按 ▶ 在卡片上播放
mark('P Z2 剪輯卡的成品，按 ▶ 播放')
await center('cut', 1.2)
await pause(2500)
await clickAt(page.getByTestId('cut-play'))
await pause(5000)

// 2) Z1：關掉第 2 鏡的「放進成品」→ 剪輯卡提醒要重新接、上方列變「接成成品」
mark('Z1 關掉一鏡：成品要重新接、上方列「接成成品」')
const [, second] = await videos()
await center(second, 1)
await pause(1200)
await clickAt(page.getByTestId(`incut-${second}`))
await pause(1500)
await center('cut', 1.2)
await pause(2500)

// 3) Z10：一行的確認；接好變 v2、「全部都生成好了」
mark('Z10 接成成品的一行確認')
await clickAt(page.getByTestId('run-all'))
await page.getByTestId('run-confirm').waitFor()
await pause(3000)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.getByText('全部都生成好了').waitFor({ timeout: 60_000 })
mark('Z2 接好變 v2')
await pause(3500)

// 4) Z1：新增一個空鏡頭 →「全部生成」的清單最後一步是接成品 → 做完變 v3
mark('Z1 新增鏡頭後全部生成（包括接成品）')
await clickAt(page.getByTestId('palette-shot'))
await pause(2000)
await page.getByText('全部生成（約').waitFor()
await clickAt(page.getByTestId('run-all'))
await page.getByTestId('run-confirm').waitFor()
await pause(3500)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.getByText('全部都生成好了').waitFor({ timeout: 60_000 })
await center('cut', 1.2)
mark('Z2 v3')
await pause(3500)
mark('結束')

await stop()
