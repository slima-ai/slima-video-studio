/* global window */
// 錄一段約 30 秒的「展開步驟」影片（M6-10b，給審查用）：
// 第 1 鏡按「展開步驟」：鏡頭下面多出整理 Prompt、挑參考圖、送出模型三格，下面的鏡頭往下讓開
// → 在「整理 Prompt」直接改送給模型的 Prompt：第一張畫面和影片標「需要重跑」→ 回到自動整理的
// → 上方列「全部展開步驟」、再「全部收合步驟」。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/expand-steps-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('expand-steps-m6-10b.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const graph = async () => (await page.evaluate(() => window.svs.invoke('canvas.get', {}))).data

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)
const [first] = (await graph()).nodes.filter((n) => n.kind === 'shot')
// 縮到 0.62：第 1 鏡整串和下面兩鏡都在畫面裡
await page.evaluate((key) => {
  const rf = window.__svsCanvas
  const shot = rf.getNode(key)
  return rf.setCenter(shot.position.x + 420, shot.position.y + 420, { zoom: 0.62, duration: 400 })
}, first.key)
await pause(1200)

// 1) 展開第 1 鏡
mark('展開步驟')
await clickAt(page.getByTestId(`steps-toggle-${first.key}`))
await pause(2500)

// 2) 改 Prompt
mark('直接改 Prompt')
const box = page.getByTestId(`step-prompt-${first.key}`)
await clickAt(box)
await page.keyboard.press('Control+a')
await page.keyboard.type('一隻橘貓坐在窗台上，窗外下著雨，暖色燈光', { delay: 90 })
await pause(400)
// 點空白處：輸入框失焦就存
const pane = await page.locator('.react-flow__pane').boundingBox()
await page.mouse.move(pane.x + 340, pane.y + pane.height - 60, { steps: 15 })
await page.mouse.click(pane.x + 340, pane.y + pane.height - 60)
await pause(3000)

// 3) 回到自動整理的
mark('回到自動整理的')
await clickAt(page.getByTestId(`step-prompt-reset-${first.key}`))
await pause(2500)

// 4) 全部展開、全部收合
mark('全部展開步驟')
await clickAt(page.getByTestId('steps-all'))
await pause(3000)
mark('全部收合步驟')
await clickAt(page.getByTestId('steps-all'))
await pause(2500)
mark('結束')

await stop()
