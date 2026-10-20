/* global document, window */
// 錄一段約 35 秒的「拉線、剪線、刪除」影片（M6-7c-2，給審查用）。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/canvas-link-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, centerOf, clickAt, record } = await prepare(outDir)
const stop = await record('canvas-link-m6-7c2.mp4')

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1200)

// 1) 新增一個角色，放進畫面
await clickAt(page.getByTestId('palette-character'))
await pause(1600)
await page.getByTestId('fit-view').click()
await pause(1200)
const ids = await page.evaluate(() =>
  window.__svsCanvas.getNodes().map((n) => ({ id: n.id, kind: n.data.kind })),
)
const hero = ids.find((n) => n.kind === 'character').id
const shots = ids.filter((n) => n.kind === 'shot')
const video = ids.find((n) => n.kind === 'video').id

async function dragTo(fromTestId, to, { release = true, steps = 40, hold = 0 } = {}) {
  const from = await centerOf(page.getByTestId(fromTestId))
  await page.mouse.move(from.x, from.y, { steps: 20 })
  await pause(500)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  if (hold) await pause(hold)
  if (release) await page.mouse.up()
}

// 2) 拉到第 2 鏡的「角色」輸入點：接得上的點亮綠，放開後鏡頭多一個角色
await dragTo(
  `port-${hero}-char-out`,
  await centerOf(page.getByTestId(`port-${shots[1].id}-shot-ref-char`)),
  {
    release: false,
    hold: 1300,
  },
)
await page.mouse.up()
await pause(1800)

// 3) 同一個角色再拉一次：旁邊提示「已經在這一鏡」
await dragTo(
  `port-${hero}-char-out`,
  await centerOf(page.getByTestId(`port-${shots[1].id}-shot-ref-char`)),
)
await pause(1800)

// 4) 拉到影片的輸入點（接不上）：說明原因
await dragTo(`port-${hero}-char-out`, await centerOf(page.getByTestId(`port-${video}-vid-in`)))
await pause(1800)

// 5) 滑過那條線，點中點的「×」剪掉，再 Cmd/Ctrl+Z 接回來
const mid = await page.evaluate(() => {
  const hit = document.querySelector('.react-flow__edge .svs-edge-ref')
  const path = hit?.parentElement?.querySelector('.react-flow__edge-interaction')
  const p = path.getPointAtLength(path.getTotalLength() / 2)
  const s = p.matrixTransform(path.getScreenCTM())
  return { x: s.x, y: s.y }
})
await page.mouse.move(mid.x - 80, mid.y - 60, { steps: 15 })
await page.mouse.move(mid.x, mid.y, { steps: 15 })
await pause(900)
await clickAt(page.getByRole('button', { name: '剪掉這條線' }))
await pause(1500)
await page.keyboard.press('Control+z')
await pause(1500)

// 6) 從角色拉到空白處放開：選單只列接得上的「鏡頭」
const start = await centerOf(page.getByTestId(`port-${hero}-char-out`))
const spot = await page.evaluate(() => {
  for (let y = 760; y > 200; y -= 30) {
    for (let x = 900; x > 400; x -= 30) {
      if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y }
    }
  }
  return undefined
})
await dragTo(`port-${hero}-char-out`, spot ?? { x: start.x + 80, y: start.y + 300 })
await pause(1500)
await page.getByTestId('add-menu').getByRole('option', { name: /鏡頭/ }).click()
await pause(2200)

// 7) 選一個鏡頭按 Delete：先確認，刪掉後鏡號重排，再復原
const titleOf = async (id) => {
  const b = await page.getByTestId(`rf__node-${id}`).boundingBox()
  return { x: b.x + 60, y: b.y + 16 }
}
const t = await titleOf(shots[0].id)
await page.mouse.move(t.x, t.y, { steps: 20 })
await pause(300)
await page.mouse.click(t.x, t.y)
await pause(600)
await page.keyboard.press('Delete')
await pause(1800)
// 刪除不再跳確認框：提示（附「復原」）直接出現
await pause(2000)
await clickAt(page.getByTestId('toast-action'))
await pause(1800)

await stop()
