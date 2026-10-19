/* global window */
// 錄一段約 40 秒的「選取與鍵盤」影片（M6-9a，給審查用）：
// 空白處拖曳框選（從場框裡面開始也可以）→ 方向鍵微調選取的鏡頭（整串一起動）、Cmd/Ctrl+Z 一步回去
// → Enter 開鏡頭面板 → F2 改場的名字 → 中鍵拖曳平移。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/select-keys-record.mjs <輸出資料夾>
// 每一段開始的秒數會印出來，填進驗收清單。
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('select-keys-m6-9a.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const boxOf = (id) => page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox()

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1500)
const nodes = await page.evaluate(() => window.__svsCanvas.getNodes())
const shots = nodes.filter((n) => n.data.kind === 'shot')
const scene = nodes.find((n) => n.data.kind === 'scene')
const [first, second, third] = shots

// 1) 框選：從第 3 鏡左下方（場框裡面）往上拖到第 1 鏡
mark('框選')
const a = await boxOf(first.id)
const c = await boxOf(third.id)
await page.mouse.move(c.x - 10, c.y + c.height + 12, { steps: 15 })
await pause(400)
await page.mouse.down()
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 40 })
await pause(600)
await page.mouse.up()
await pause(1500)
// 點左下角的空白處取消選取
await page.mouse.move(330, 800, { steps: 15 })
await page.mouse.click(330, 800)
await pause(800)

// 2) 方向鍵微調：選第 2 鏡，往右四下、Shift+下一下；停下來才存，Cmd/Ctrl+Z 一步回去
mark('方向鍵微調')
const b = await boxOf(second.id)
await clickAt({ boundingBox: async () => ({ x: b.x + 40, y: b.y + 8, width: 40, height: 16 }) })
await pause(600)
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('ArrowRight')
  await pause(250)
}
await page.keyboard.press('Shift+ArrowDown')
await pause(1800)
await page.keyboard.press('Control+z')
await pause(1800)

// 3) Enter 開面板
mark('Enter 開面板')
await page.keyboard.press('Enter')
await page.getByTestId('shot-panel').waitFor()
await pause(2200)
await page.keyboard.press('Escape')
await pause(1000)

// 4) F2 改場的名字
mark('F2 改名')
const title = await page
  .locator(`.react-flow__node[data-id="${scene.id}"] .svs-frame-title`)
  .boundingBox()
await clickAt({
  boundingBox: async () => ({ x: title.x + 30, y: title.y + 6, width: 20, height: 12 }),
})
await pause(600)
await page.keyboard.press('F2')
await pause(800)
await page.keyboard.type('雨夜的巷子', { delay: 120 })
await pause(500)
await page.keyboard.press('Enter')
await pause(2500)

// 5) 中鍵拖曳平移
mark('中鍵拖曳平移')
await page.mouse.move(1100, 700, { steps: 10 })
await page.mouse.down({ button: 'middle' })
await page.mouse.move(850, 600, { steps: 30 })
await page.mouse.up({ button: 'middle' })
await pause(1500)
mark('結束')

await stop()
