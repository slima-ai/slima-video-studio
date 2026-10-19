/* global window */
// 錄一段約 35 秒的「便條與自訂群組」影片（M6-9c，給審查用）：
// 左側面板新增便條 → 雙擊寫字 → 選兩個鏡頭按 Ctrl+G 框成群組 → 換顏色、F2 改名
// → 拖群組的標題列，框住的格子一起搬 → Cmd/Ctrl+Z 回去。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/notes-groups-record.mjs <輸出資料夾>
// 每一段開始的秒數會印出來，填進 PR 說明。
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('notes-groups-m6-9c.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const press = async (x, y, options = {}) => {
  await page.mouse.move(x, y, { steps: 18 })
  await pause(300)
  await page.mouse.click(x, y, options)
}
const boxOf = (id) => page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox()
const freeKey = async (kind) => {
  const result = await page.evaluate(() => window.svs.invoke('canvas.get', {}))
  return result.data.nodes.find((n) => n.kind === kind)?.key
}

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)
// 縮到 0.62：第 1、2 鏡整串和右邊的空白處都在畫面裡
await page.evaluate(() => {
  const rf = window.__svsCanvas
  const shot = rf.getNodes().find((n) => n.data.kind === 'shot')
  return rf.setCenter(shot.position.x + 330, shot.position.y + 260, { zoom: 0.62, duration: 400 })
})
await pause(1200)

// 1) 便條：左側面板新增 → 雙擊寫字
mark('便條')
await clickAt(page.getByTestId('palette-note'))
await pause(1500)
const note = await freeKey('note')
const n = await boxOf(note)
await page.mouse.move(n.x + n.width / 2, n.y + n.height * 0.6, { steps: 15 })
await page.mouse.dblclick(n.x + n.width / 2, n.y + n.height * 0.6)
await pause(400)
await page.keyboard.type('第 2 鏡要更暗一點', { delay: 110 })
await pause(500)
// 點畫布右下角的空白處：輸入框失焦就存
const pane = await page.locator('.react-flow__pane').boundingBox()
await press(pane.x + pane.width - 60, pane.y + pane.height - 60)
await pause(1500)

// 2) 選兩個鏡頭 → Ctrl+G
mark('Ctrl+G 框成群組')
const shots = (await page.evaluate(() => window.__svsCanvas.getNodes())).filter(
  (x) => x.data.kind === 'shot',
)
const a = await boxOf(shots[0].id)
const b = await boxOf(shots[1].id)
await press(a.x + 50, a.y + 14)
await page.keyboard.down('Shift')
await press(b.x + 50, b.y + 14)
await page.keyboard.up('Shift')
await pause(600)
await page.keyboard.press('Control+g')
await pause(2000)

// 3) 換顏色、F2 改名
mark('換顏色、改名')
const group = await freeKey('group')
const grip = page.locator(`.react-flow__node[data-id="${group}"] .svs-group-grip`).first()
const g = await grip.boundingBox()
await press(g.x + 40, g.y + 12)
await pause(500)
await clickAt(page.getByTestId('group-color-blue'))
await pause(1000)
await page.keyboard.press('F2')
await pause(400)
await page.keyboard.type('開場', { delay: 150 })
await page.keyboard.press('Enter')
await pause(1500)

// 4) 拖群組：框住的格子一起搬 → 復原
mark('拖群組')
const g2 = await grip.boundingBox()
await page.mouse.move(g2.x + 40, g2.y + 12, { steps: 12 })
await page.mouse.down()
await page.mouse.move(g2.x + 40, g2.y + 12 + 220, { steps: 40 })
await page.mouse.up()
await pause(1800)
await page.keyboard.press('Control+z')
await pause(2000)
mark('結束')

await stop()
