// 錄一段約 25 秒的「畫布首頁」影片（M6-7a，給審查用）。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/canvas-home-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, centerOf, record } = await prepare(outDir)
const stop = await record('canvas-home-m6-7a.mp4')

// 1) 點導覽的「畫布」：整張圖看得到
const nav = await centerOf(page.getByRole('button', { name: '畫布', exact: true }))
await page.mouse.move(nav.x, nav.y, { steps: 10 })
await pause(300)
await page.mouse.click(nav.x, nav.y)
await page.getByTestId('canvas-root').waitFor()
await pause(1500)

// 2) 觸控板平移與 Ctrl 縮放
await page.mouse.move(820, 480, { steps: 8 })
for (let i = 0; i < 14; i++) {
  await page.mouse.wheel(i < 7 ? 14 : -14, i < 7 ? 24 : -24)
  await pause(30)
}
await page.keyboard.down('Control')
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 90)
  await pause(60)
}
await pause(500)
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -90)
  await pause(60)
}
await page.keyboard.up('Control')
await page.getByRole('button', { name: '全部顯示' }).click()
await pause(1200)

// 3) 點鏡頭：選取、相連的線變亮
const shot = page.locator('.react-flow__node[data-id^="shot:"]').first()
const shotPoint = await centerOf(shot)
await page.mouse.move(shotPoint.x, shotPoint.y, { steps: 20 })
await pause(300)
await page.mouse.click(shotPoint.x, shotPoint.y)
await pause(1200)

// 4) 影片節點的「放進成品」：關掉 → 剪輯變 2/3 鏡 → 復原
const toggle = page.getByRole('button', { name: /放進成品/ }).first()
const togglePoint = await centerOf(toggle)
await page.mouse.move(togglePoint.x, togglePoint.y, { steps: 20 })
await pause(300)
await page.mouse.click(togglePoint.x, togglePoint.y)
await pause(1500)
await page.keyboard.press('Control+z')
await pause(1500)

// 5) 縮小：小於 0.5 只留標題與縮圖，小於 0.25 只剩色塊
await page.keyboard.down('Control')
await page.mouse.move(820, 480, { steps: 6 })
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, 90)
  await pause(70)
}
await pause(900)
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, 90)
  await pause(70)
}
await pause(900)
await page.keyboard.up('Control')
await page.getByRole('button', { name: '全部顯示' }).click()
await pause(1000)

// 6) 切到分鏡表再回畫布：視角還在
await page.getByRole('button', { name: '分鏡表' }).click()
await pause(1000)
await page.getByRole('button', { name: '畫布' }).click()
await pause(1500)

// 7) 切換主題
await page.getByRole('button', { name: '切換主題' }).click()
await pause(1500)

await stop()
