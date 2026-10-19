/* global document, DataTransfer, DragEvent */
// 錄一段約 25 秒的「放上圖片或影片」影片（M6-9d，給審查用）：
// 左側面板「圖片或影片」選檔（一次選一張圖和一段影片）→ 放成兩格獨立的格子 →
// 從檔案總管拖一張圖進畫布，放在放開的地方 → 拖一個不支援的檔案，提示說明原因。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/free-media-record.mjs <輸出資料夾>
// 選檔視窗在錄影裡用假的（直接回傳準備好的檔案），因為 xvfb 沒有系統的選檔視窗。
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { app, page, pause, clickAt, record } = await prepare(outDir)

// 準備要放的檔案：一張 16:9 的圖、一段 3 秒的影片（用 FFmpeg 產生）
const picture = join(outDir, '雨夜的巷子.png')
const clip = join(outDir, '貓走過窗台.mp4')
const ffmpeg = (args) => spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args])
ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'gradients=s=640x360:c0=0x1e3a8a:c1=0x0f172a',
  '-frames:v',
  '1',
  picture,
])
ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=3', '-pix_fmt', 'yuv420p', clip])
const dropped = join(outDir, 'drop.png')
ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'gradients=s=640x360:c0=0x7c2d12:c1=0x1c1917',
  '-frames:v',
  '1',
  dropped,
])
await app.evaluate(
  ({ dialog }, files) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: files })
  },
  [picture, clip],
)

const stop = await record('free-media-m6-9d.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1500)

// 1) 左側面板「圖片或影片」：選檔 → 兩格
mark('上傳圖片與影片')
await clickAt(page.getByTestId('palette-freeImage'))
await pause(3000)

// 2) 從檔案總管拖一張圖進來
mark('拖檔案進畫布')
const pane = await page.locator('.react-flow__pane').boundingBox()
const at = { x: pane.x + pane.width - 280, y: pane.y + pane.height - 220 }
await page.mouse.move(at.x, at.y, { steps: 25 })
const base64 = (await import('node:fs')).readFileSync(dropped).toString('base64')
const drop = (name, type, data) =>
  page.evaluate(
    ({ name, type, data, at }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], name, { type }))
      const target = document.elementFromPoint(at.x, at.y)
      for (const kind of ['dragenter', 'dragover', 'drop']) {
        target?.dispatchEvent(
          new DragEvent(kind, {
            bubbles: true,
            cancelable: true,
            clientX: at.x,
            clientY: at.y,
            dataTransfer: transfer,
          }),
        )
      }
    },
    { name, type, data, at },
  )
await drop('秋天的街.png', 'image/png', base64)
await pause(3000)

// 3) 不支援的檔案：說明原因
mark('不支援的檔案')
await drop('筆記.txt', 'text/plain', Buffer.from('hello').toString('base64'))
await pause(3500)
mark('結束')

writeFileSync(join(outDir, 'done.txt'), 'ok')
await stop()
