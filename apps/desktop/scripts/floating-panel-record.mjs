/* global window */
// 錄一段約 35 秒的「浮動面板」影片（M6-10a，給審查用）：
// 鏡頭的 ↗ 打開面板：蓋在畫布上、不推擠畫布 → 點第 2 鏡的圖，面板跟著換成那張圖的所有版本
// → 「試跑」分頁：列出這次的步驟與花費、按「執行」→ 點場框標題：場的欄位，改氣氛
// → 新增一個角色：角色卡 → 點空白處收起。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/floating-panel-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('floating-panel-m6-10a.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const graph = async () => (await page.evaluate(() => window.svs.invoke('canvas.get', {}))).data
const boxOf = (key) => page.locator(`.react-flow__node[data-id="${key}"]`).boundingBox()
const press = async (x, y) => {
  await page.mouse.move(x, y, { steps: 18 })
  await pause(300)
  await page.mouse.click(x, y)
}

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)
const shots = (await graph()).nodes.filter((n) => n.kind === 'shot')
// 縮到 0.7：第 1、2 鏡整串在畫面左半邊
await page.evaluate((key) => {
  const rf = window.__svsCanvas
  const shot = rf.getNode(key)
  return rf.setCenter(shot.position.x + 520, shot.position.y + 200, { zoom: 0.7, duration: 400 })
}, shots[0].key)
await pause(1200)

// 1) 鏡頭的 ↗ 打開面板
mark('打開鏡頭的面板')
await clickAt(page.getByTestId(`open-${shots[0].key}`))
await pause(2500)

// 2) 點第 2 鏡的圖：面板跟著換
mark('點別的格子，面板跟著換')
const img = await boxOf(`${shots[1].key}:image`)
await press(img.x + 60, img.y + 12)
await pause(2500)

// 3) 試跑
mark('試跑')
await clickAt(page.getByTestId('canvas-panel-tab-trial'))
await pause(2200)
await clickAt(page.getByTestId('trial-run'))
await pause(3500)

// 4) 場的欄位
mark('場的欄位')
const scene = (await graph()).nodes.find((n) => n.kind === 'scene')
const frame = await page
  .locator(`.react-flow__node[data-id="${scene.key}"] .svs-frame-title`)
  .boundingBox()
await press(frame.x + 60, frame.y + 12)
await pause(1500)
await clickAt(page.getByTestId('scene-panel-mood'))
await page.keyboard.type('安靜、潮濕', { delay: 120 })
await page.keyboard.press('Tab')
await pause(1800)

// 5) 角色卡
mark('角色卡')
await clickAt(page.getByTestId('palette-character'))
await pause(1500)
const hero = (await graph()).nodes.find((n) => n.kind === 'character')
const h = await boxOf(hero.key)
await press(h.x + 60, h.y + 12)
await pause(400)
await page.keyboard.press('Enter')
await pause(2500)

// 6) 點空白處收起
mark('點空白處收起')
const pane = await page.locator('.react-flow__pane').boundingBox()
await press(pane.x + 360, pane.y + pane.height - 60)
await pause(2000)
mark('結束')

await stop()
