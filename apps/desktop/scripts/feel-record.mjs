/* global window */
// 錄一段約 45 秒的「手感自驗收」影片（M6-7d-8，給審查用）：
// 拖移時按下去的那一點一直在游標下 → Ctrl＋滾輪縮小：0.25～0.5 卡片中間寫大字的名稱、
// 小於 0.25 色塊上寫編號與名稱 → 放大回來 → 兩指捲動平移 → 格子上的 ▶ 平移後確認面板貼著它。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/feel-record.mjs <輸出資料夾>
// 每一段開始的秒數會印出來，填進驗收清單。
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('feel-m6-7d8.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1500)

// 1) 拖移跟手：慢慢拖第 2 鏡繞一圈，游標一直停在按下去的那一點
mark('拖移跟手')
const shot = page.locator('.react-flow__node').filter({ hasText: '第 2 鏡' }).first()
const box = await shot.boundingBox()
const grab = { x: box.x + 70, y: box.y + 18 }
await page.mouse.move(grab.x, grab.y, { steps: 15 })
await pause(400)
await page.mouse.down()
for (let i = 1; i <= 50; i++) {
  const a = (i / 50) * Math.PI * 2
  await page.mouse.move(grab.x + Math.sin(a) * 160, grab.y + (1 - Math.cos(a)) * 90)
  await pause(30)
}
await page.mouse.up()
await pause(1200)
await page.keyboard.press('Control+z')
await pause(1200)

// 2) Ctrl＋滾輪縮小：名稱變大字，再到色塊
mark('縮小：0.25～0.5 卡片寫大字名稱')
await page.mouse.move(820, 480, { steps: 10 })
await page.keyboard.down('Control')
for (let i = 0; i < 26; i++) {
  await page.mouse.wheel(0, 18)
  await pause(40)
}
await pause(2500)
mark('縮得更小：色塊寫編號與名稱')
for (let i = 0; i < 34; i++) {
  await page.mouse.wheel(0, 18)
  await pause(40)
}
await pause(2800)
mark('放大回來')
for (let i = 0; i < 60; i++) {
  await page.mouse.wheel(0, -18)
  await pause(40)
}
await page.keyboard.up('Control')
await pause(1500)

// 3) 兩指捲動平移
mark('捲動平移')
for (let i = 0; i < 60; i++) {
  await page.mouse.wheel(i < 30 ? 6 : -6, i < 30 ? 14 : -14)
  await pause(30)
}
await pause(1500)
// 4) 從格子上的 ▶ 執行、第一格在畫面外：先平移帶進來，面板貼在 ▶ 現在的位置
mark('▶ 的確認面板跟著平移')
const added = await page.evaluate(() => window.svs.invoke('canvas.add', { kind: 'shot' }))
const video = `${added.data.key}:video`
await pause(1500)
await page.evaluate((id) => {
  const rf = window.__svsCanvas
  const node = rf.getNode(id)
  // 影片的 ▶ 在畫面中間偏左，前面的第一張畫面被左側面板擋住
  void rf.setCenter(node.position.x + 260, node.position.y + 120, { zoom: 1, duration: 0 })
}, video)
await pause(1200)
await clickAt(page.getByTestId(`run-${video}`))
await page.locator('[data-testid="run-confirm"][data-placed="true"]').waitFor()
await pause(3500)
await clickAt(page.getByTestId('run-confirm').getByRole('button', { name: '取消' }))
await pause(1500)
mark('結束')

await stop()
