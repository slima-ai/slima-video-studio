/* global window */
// 錄一段約 30 秒的「右鍵選單」影片（M6-9b，給審查用）：
// 影片上按右鍵（依狀態列出能做的事）→「不放進成品」→ 場框標題按右鍵「改名」→
// 選兩個鏡頭按右鍵（執行／刪除選取的 2 格）→ 空白處按右鍵「新增…」選角色，新的角色放在按的地方。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/context-menu-record.mjs <輸出資料夾>
// 每一段開始的秒數會印出來，填進 PR 說明。
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('context-menu-m6-9b.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const boxOf = (id) => page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox()
/** 游標慢慢移過去再按（左鍵或右鍵）。 */
const press = async (x, y, options = {}) => {
  await page.mouse.move(x, y, { steps: 18 })
  await pause(300)
  await page.mouse.click(x, y, options)
}
const pick = async (name) => {
  const item = page.getByTestId('context-menu').getByRole('menuitem', { name })
  const b = await item.boundingBox()
  await pause(1200)
  await press(b.x + 40, b.y + b.height / 2)
}

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)
// 往左帶一點，讓影片那一欄也在畫面裡
await page.evaluate(() => {
  const rf = window.__svsCanvas
  const v = rf.getViewport()
  return rf.setViewport({ ...v, x: v.x - 380 }, { duration: 400 })
})
await pause(1200)
const nodes = await page.evaluate(() => window.__svsCanvas.getNodes())
const shots = nodes.filter((n) => n.data.kind === 'shot')
const scene = nodes.find((n) => n.data.kind === 'scene')

// 1) 影片上按右鍵 →「不放進成品」
mark('影片上按右鍵')
// 挑畫面上看得到的影片（畫面外的格子不會畫出來）
const v = await page.locator('.react-flow__node[data-id$=":video"]').first().boundingBox()
await press(v.x + 60, v.y + 16, { button: 'right' })
await pick(/不放進成品/)
await pause(2200)

// 2) 場框標題按右鍵 →「改名」
mark('場框按右鍵改名')
const t = await page
  .locator(`.react-flow__node[data-id="${scene.id}"] .svs-frame-title`)
  .boundingBox()
await press(t.x + 40, t.y + 12, { button: 'right' })
await pick(/改名/)
await page.keyboard.type('雨夜的巷子', { delay: 120 })
await page.keyboard.press('Enter')
await pause(2000)

// 3) 選兩個鏡頭按右鍵：對整群
mark('選取的一群按右鍵')
const a = await boxOf(shots[0].id)
const b = await boxOf(shots[1].id)
await press(a.x + 60, a.y + 16)
await page.keyboard.down('Shift')
await press(b.x + 60, b.y + 16)
await page.keyboard.up('Shift')
await press(b.x + 60, b.y + 16, { button: 'right' })
await pause(2500)
await page.keyboard.press('Escape')
await pause(800)

// 4) 空白處按右鍵 →「新增…」→ 角色
mark('空白處按右鍵新增')
await press(560, 640, { button: 'right' })
await pick(/新增/)
await pause(800)
const hero = page.getByTestId('add-menu').getByRole('option', { name: /角色/ })
const h = await hero.boundingBox()
await press(h.x + 60, h.y + h.height / 2)
await pause(2500)
mark('結束')

await stop()
