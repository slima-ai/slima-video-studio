/* global document, window */
// 錄一段約 35 秒的「示範模式的內容」影片（M6-7d-1，給審查用）：
// 一句話選 5 鏡 → 長出 5 鏡（O）→ 剪輯 5/5 → 放大看示範圖裡的中文（M）、節點寫「示範圖片」
// → 展開生成佇列，只看到中文描述、沒有英文關鍵字（Q）。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/demo-content-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir, { seed: false })
const stop = await record('demo-content-m6-7d1.mp4')

const center = (id, zoom = 1) =>
  page.evaluate(
    ([nodeId, z]) => {
      const rf = window.__svsCanvas
      const node = rf.getNode(nodeId)
      if (node)
        void rf.setCenter(node.position.x + 115, node.position.y + 110, { zoom: z, duration: 600 })
    },
    [id, zoom],
  )

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1200)
await clickAt(page.getByTestId('empty-add-oneliner'))
await page.getByTestId('oneliner-story').waitFor()
await pause(800)

// 1) 寫故事、選 5 鏡（O：要長出 5 鏡，不是 3 鏡）
await clickAt(page.getByTestId('oneliner-story'))
await page.keyboard.type(
  '一隻貓在下雨的夜晚，躲進巷子裡的紙箱，遇到撐傘的小女孩，被抱回家，在暖爐旁睡著了',
  {
    delay: 35,
  },
)
await pause(500)
await clickAt(page.getByTestId('oneliner-shots'))
await pause(400)
await clickAt(page.getByTestId('oneliner-shots-option-5'))
await pause(800)
await clickAt(page.getByTestId('oneliner-generate'))
await page.getByTestId('run-confirm').waitFor()
await pause(1800)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.waitForFunction(
  () => document.querySelector('[data-testid="canvas-root"]')?.dataset.growing === 'false',
  undefined,
  { timeout: 120_000 },
)
await pause(1500)

// 2) 全部顯示：5 個鏡頭、剪輯 5/5 鏡
await page.getByTestId('fit-view').click()
await pause(2500)

// 3) 放大第 1 鏡的第一張畫面（M：示範圖裡的中文正常顯示；節點寫「示範圖片」不是 mock/image）
const image = await page.evaluate(
  () => window.__svsCanvas.getNodes().find((n) => n.data.kind === 'image')?.id,
)
await center(image, 1.6)
await pause(3500)

// 4) 展開生成佇列（Q：只有中文描述，沒有 photorealistic 這類英文關鍵字）
const queue = page.getByTestId('queue-panel')
if ((await queue.getAttribute('data-collapsed')) === 'true') {
  await clickAt(page.getByRole('button', { name: '展開生成佇列' }))
}
await pause(3500)
await stop()
