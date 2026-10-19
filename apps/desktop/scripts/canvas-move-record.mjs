/* global window */
// 錄一段約 30 秒的「拖移」影片（M6-7c-1，給審查用）：整串一起動、對齊線、Alt 單獨拖、拖進別的場、場框整個拖、復原。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/canvas-move-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('canvas-move-m6-7c.mp4')

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1500)

const nodes = () =>
  page.evaluate(() =>
    window.__svsCanvas
      ?.getNodes()
      .map((n) => ({ id: n.id, kind: n.data.kind, sceneId: n.data.sceneId })),
  )
const shots = (await nodes()).filter((n) => n.kind === 'shot')
const frames = (await nodes()).filter((n) => n.kind === 'scene')
const titlePoint = async (id) => {
  const b = await page.getByTestId(`rf__node-${id}`).boundingBox()
  return { x: b.x + 60, y: b.y + 16 }
}
async function drag(from, to, { steps = 40, release = true, hold = 300 } = {}) {
  await page.mouse.move(from.x, from.y, { steps: 15 })
  await pause(250)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  if (release) {
    await pause(hold)
    await page.mouse.up()
  }
}

// 1) 拖第 2 鏡：圖與影片整串跟著動；靠近第 1 鏡的左緣時出現對齊線並吸附
let p = await titlePoint(shots[1].id)
await drag(p, { x: p.x + 130, y: p.y + 40 }, { release: false })
await pause(300)
await page.mouse.move(p.x + 6, p.y + 50, { steps: 40 })
await pause(1100)
await page.mouse.up()
await pause(900)
await page.keyboard.press('Control+z')
await pause(1200)

// 2) 按著 Alt 只拖鏡頭本身，圖與影片留在原地
p = await titlePoint(shots[0].id)
await page.keyboard.down('Alt')
await drag(p, { x: p.x + 40, y: p.y + 120 })
await page.keyboard.up('Alt')
await pause(1000)
await page.keyboard.press('Control+z')
await pause(1200)

// 3) 新增第 2 場（下方多一個場框），再把第 1 鏡拖進去：目標框亮起並提示，放開後改場、鏡號重排
await clickAt(page.getByTestId('palette-scene'))
await pause(1800)
await page
  .getByTestId('fit-view')
  .click()
  .catch(() => undefined)
await pause(900)
const sceneIds = (await nodes()).filter((n) => n.kind === 'scene')
const targetId = sceneIds.find((s) => !frames.some((f) => f.id === s.id))?.id
if (!targetId) throw new Error('沒有找到新的場框')
const box = await page.getByTestId(`rf__node-${targetId}`).boundingBox()
p = await titlePoint(shots[0].id)
await drag(
  p,
  { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  { steps: 60, release: false },
)
await pause(1400)
await page.mouse.up()
await pause(2200)
await clickAt(page.getByTestId('toast-action'))
await pause(1500)

// 4) 拖場框的標題列：整個場的鏡頭一起動，再復原
const grip = await page
  .getByTestId(`rf__node-${frames[0].id}`)
  .locator('.svs-frame-title')
  .boundingBox()
const gp = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }
await drag(gp, { x: gp.x + 60, y: gp.y + 70 })
await pause(1200)
await page.keyboard.press('Control+z')
await pause(1500)

await stop()
