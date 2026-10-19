/* global window */
// 錄一段約 40 秒的「獨立圖片接出去」影片（M6-9f，給審查用）：
// 放一張圖 → 拉到第 1 鏡的「第一張畫面」：圖換成這張、影片標「需要重跑」→ 按影片的 ▶ 補跑
// → 從圖片的「＋」新增角色：這張圖直接接成角色的參考圖 → Cmd/Ctrl+Z 一步步收回。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/free-links-record.mjs <輸出資料夾>
// 選檔視窗在錄影裡用假的（直接回傳準備好的檔案），因為 xvfb 沒有系統的選檔視窗。
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { app, page, pause, clickAt, record } = await prepare(outDir)

// 準備要放的圖：一張 16:9 的暖色漸層（用 FFmpeg 產生）
const picture = join(outDir, '窗邊的暖光.png')
spawnSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'gradients=s=640x360:c0=0xf59e0b:c1=0x7c2d12',
  '-frames:v',
  '1',
  picture,
])
await app.evaluate(
  ({ dialog }, files) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: files })
  },
  [picture],
)

const stop = await record('free-links-m6-9f.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const centerOf = async (testId) => {
  const b = await page.getByTestId(testId).boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y, { steps: 18 })
  await pause(300)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 45 })
  await pause(400)
  await page.mouse.up()
}
const graph = async () => (await page.evaluate(() => window.svs.invoke('canvas.get', {}))).data

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)
// 縮到 0.75：第 1 鏡整串和它下面的空白處都在畫面裡
const shot = (await graph()).nodes.find((n) => n.kind === 'shot').key
await page.evaluate((key) => {
  const rf = window.__svsCanvas
  const image = rf.getNode(`${key}:image`)
  return rf.setCenter(image.position.x + 60, image.position.y + 260, { zoom: 0.75, duration: 400 })
}, shot)
await pause(1200)

// 1) 放一張圖
mark('放一張圖')
await clickAt(page.getByTestId('palette-freeImage'))
await pause(2000)
const free = (await graph()).nodes.find((n) => n.kind === 'free_image').key

// 2) 拉到第 1 鏡的「第一張畫面」
mark('接到第一張畫面')
await drag(
  await centerOf(`port-${free}-free-img-out`),
  await centerOf(`port-${shot}:image-img-first`),
)
await pause(3000)

// 3) 按影片的 ▶ 補跑：只重生影片，用的是這張圖
mark('補跑影片')
await clickAt(page.getByTestId(`run-${shot}:video`))
await pause(1200)
await clickAt(page.getByTestId('run-confirm-ok'))
await pause(4500)

// 4) 從圖片的「＋」新增角色
mark('新增角色，圖當參考圖')
const out = await centerOf(`port-${free}-free-img-out`)
await drag(out, { x: out.x + 140, y: out.y + 160 })
await pause(900)
await clickAt(page.getByTestId('add-menu').getByRole('option', { name: /角色/ }))
await pause(3000)

// 5) 復原：角色收回，再收回第一張畫面
mark('復原')
await page.keyboard.press('Control+z')
await pause(1500)
await page.keyboard.press('Control+z')
await pause(1500)
await page.keyboard.press('Control+z')
await pause(2500)
mark('結束')

await stop()
