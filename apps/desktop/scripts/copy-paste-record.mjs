/* global window */
// 錄一段約 35 秒的「複製、貼上、刪除」影片（M6-9e，給審查用）：
// 選第 1 鏡 Ctrl+C、Ctrl+V：後面多一鏡（帶描述、沒有圖和影片）→ 右鍵影片「複製成獨立的一格」
// → 加一個角色、右鍵複製、在空白處右鍵貼上（名字加「副本」）→ 選第 2 鏡的圖按 Delete：
// 清掉採用中的版本 → Cmd/Ctrl+Z 一步步收回。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/copy-paste-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('copy-paste-m6-9e.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const graph = async () => (await page.evaluate(() => window.svs.invoke('canvas.get', {}))).data
const boxOf = (key) => page.locator(`.react-flow__node[data-id="${key}"]`).boundingBox()
const press = async (x, y, options = {}) => {
  await page.mouse.move(x, y, { steps: 18 })
  await pause(300)
  await page.mouse.click(x, y, options)
}

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)
const [first] = (await graph()).nodes.filter((n) => n.kind === 'shot')
// 縮到 0.7：第 1、2 鏡整串和右邊的空白處都在畫面裡
await page.evaluate((key) => {
  const rf = window.__svsCanvas
  const shot = rf.getNode(key)
  return rf.setCenter(shot.position.x + 420, shot.position.y + 240, { zoom: 0.7, duration: 400 })
}, first.key)
await pause(1200)

// 1) 鏡頭 Ctrl+C、Ctrl+V
mark('鏡頭 Ctrl+C、Ctrl+V')
const s1 = await boxOf(first.key)
await press(s1.x + 60, s1.y + 12)
await pause(400)
await page.keyboard.press('Control+c')
await pause(1200)
await page.keyboard.press('Control+v')
await pause(3000)

// 2) 右鍵影片「複製成獨立的一格」
mark('影片複製成獨立的一格')
const v1 = await boxOf(`${first.key}:video`)
await press(v1.x + 60, v1.y + 12, { button: 'right' })
await pause(900)
await clickAt(page.getByRole('menuitem', { name: /複製成獨立的一格/ }))
await pause(2500)

// 3) 角色：右鍵複製 → 空白處右鍵貼上
mark('角色複製、貼上')
await clickAt(page.getByTestId('palette-character'))
await pause(1800)
const hero = (await graph()).nodes.find((n) => n.kind === 'character')
const h = await boxOf(hero.key)
await press(h.x + 60, h.y + 12, { button: 'right' })
await pause(800)
await clickAt(page.getByRole('menuitem', { name: /^複製/ }).first())
await pause(800)
await press(h.x + 40, h.y + h.height + 80, { button: 'right' })
await pause(800)
await clickAt(page.getByRole('menuitem', { name: /貼上/ }))
await pause(2500)

// 4) 選第 3 鏡（原本的第 2 鏡）的圖按 Delete：清掉採用中的版本
mark('刪圖：清掉採用中的版本')
const shots = (await graph()).nodes.filter((n) => n.kind === 'shot')
const third = shots.find((n) => n.title === '第 3 鏡')
const img = await boxOf(`${third.key}:image`)
await press(img.x + 60, img.y + 12)
await pause(500)
await page.keyboard.press('Delete')
await pause(3000)

// 5) 復原
mark('復原')
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('Control+z')
  await pause(1300)
}
await pause(1200)
mark('結束')

await stop()
