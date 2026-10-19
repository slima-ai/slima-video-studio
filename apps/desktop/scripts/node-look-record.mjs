/* global document, window */
// 錄一段約 45 秒的「畫布外觀」影片（M6-7d-2，給審查用）：
// 空畫布的起點與「未命名專案」（A）→ 生成 → 16:9 縮圖、底部一致、每個會生成的都有 ▶（D）
// →「放進成品」開關與說明提示（C）→ 剪輯卡（E）→ 新增面板與選單沒有「節點」（K）
// → 縮小：「第 N 場」大字與鏡頭大編號（B）。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/node-look-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir, { seed: false })
const stop = await record('node-look-m6-7d2.mp4')

const view = (x, y, zoom, duration = 700) =>
  page.evaluate(
    ([vx, vy, z, d]) => {
      void window.__svsCanvas.setViewport({ x: vx, y: vy, zoom: z }, { duration: d })
    },
    [x, y, zoom, duration],
  )
const center = (id, zoom) =>
  page.evaluate(
    ([nodeId, z]) => {
      const rf = window.__svsCanvas
      const node = rf.getNode(nodeId)
      if (node)
        void rf.setCenter(node.position.x + 400, node.position.y + 120, { zoom: z, duration: 700 })
    },
    [id, zoom],
  )

// 1) A：空畫布中央就是起點，標題寫「未命名專案」；先寫故事再按「新增一句話」
await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-empty').waitFor()
await pause(2000)
await clickAt(page.getByTestId('empty-story'))
await page.keyboard.type('一隻貓在下雨的夜晚找到溫暖的家', { delay: 70 })
await pause(500)
await clickAt(page.getByTestId('empty-add-oneliner'))
await page.getByTestId('oneliner-story').waitFor()
await pause(1500)
await clickAt(page.getByTestId('oneliner-shots'))
await pause(300)
await clickAt(page.getByTestId('oneliner-shots-option-3'))
await clickAt(page.getByTestId('oneliner-duration'))
await pause(300)
await clickAt(page.getByTestId('oneliner-duration-option-3'))
await pause(500)
await clickAt(page.getByTestId('oneliner-generate'))
await page.getByTestId('run-confirm').waitFor()
await pause(800)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.waitForFunction(
  () => document.querySelector('[data-testid="canvas-root"]')?.dataset.growing === 'false',
  undefined,
  { timeout: 120_000 },
)
await pause(5200)

// 2) D：放大第 1 鏡那一串：16:9 縮圖、底部「版本・模型／耗時・多久前」、鏡頭也有 ▶
const shot = await page.evaluate(
  () => window.__svsCanvas.getNodes().find((n) => n.data.kind === 'shot')?.id,
)
await center(shot, 1)
await pause(3500)

// 3) C：「放進成品」是開關，切掉時提示說明影響，可以復原
const video = `${shot}:video`
await clickAt(page.getByTestId(`incut-${video}`))
await pause(3000)
await clickAt(page.getByTestId('toast-action'))
await pause(1500)

// 4) E：剪輯卡（每場一列、16:9 成品縮圖）
await center('cut', 1)
await pause(2500)

// 5) K：新增面板與 Tab 選單的用語（沒有「節點」）
const area = await page.getByTestId('canvas-root').boundingBox()
await page.mouse.click(area.x + area.width - 120, area.y + area.height - 140)
await pause(300)
await page.keyboard.press('Tab')
await pause(2500)
await page.keyboard.press('Escape')
await pause(500)

// 6) B：縮小到 0.35（「第 1 場」大字）再到 0.18（鏡頭色塊上的大編號）
await page.getByTestId('fit-view').click()
await pause(1200)
const box = await page.getByTestId('canvas-root').boundingBox()
await view(box.width / 2 - 250, box.height / 2 - 120, 0.35)
await pause(2500)
await view(box.width / 2 - 110, box.height / 2 - 60, 0.18)
await pause(3000)
await stop()
