/* global document, window */
// 錄一段約 70 秒的「一句話的回饋」影片（M6-7d-4，給審查用）：
// 欄位都有標籤（V）→ 確認面板貼在按鈕旁（W）→ 長的過程中畫面不動、欄位鎖住並說明原因、佇列不自己展開（R、U、X）
// → 長完一次把一句話與新的場放進畫面（R）→ 提示上的「復原」一步拿掉整次生成、重做再回來（Y）
// → 勾「刪掉現有內容」寫清楚刪什麼、能復原（S）→ 刪掉並生成後 Ctrl+Z 舊的全部回來（Y）
// → ▶ 的確認面板不蓋住標亮的那一串（W）→ 佇列要自己按才展開（X）。
// 用法：SVS_MOCK_LATENCY_MS=350 xvfb-run -a -s "-screen 0 1440x900x24" node scripts/oneliner-feedback-record.mjs <輸出資料夾>
// 每一段開始的秒數會印出來，填進驗收清單。
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir, { seed: false })
const stop = await record('oneliner-m6-7d4.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const growing = (value) =>
  page.waitForFunction(
    (want) => document.querySelector('[data-testid="canvas-root"]')?.dataset.growing === want,
    value,
    { timeout: 120_000 },
  )

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1500)

// 1) V：空畫布寫故事 → 新增一句話；故事、畫風、鏡頭數、每鏡幾秒、畫面比例都有標籤
mark('V 一句話的欄位標籤')
await clickAt(page.getByTestId('empty-story'))
await page.keyboard.type('一隻貓在下雨的夜晚找到溫暖的家', { delay: 70 })
await pause(500)
await clickAt(page.getByTestId('empty-add-oneliner'))
await page.getByTestId('oneliner-story').waitFor()
await pause(2500)
await clickAt(page.getByTestId('oneliner-shots'))
await pause(400)
await clickAt(page.getByTestId('oneliner-shots-option-3'))
await pause(400)
await clickAt(page.getByTestId('oneliner-duration'))
await pause(400)
await clickAt(page.getByTestId('oneliner-duration-option-3'))
await pause(1500)

// 2) W：確認面板貼在「生成影片」旁邊
mark('W 確認面板貼在按鈕旁')
await clickAt(page.getByTestId('oneliner-generate'))
await page.getByTestId('run-confirm').waitFor()
await pause(3000)
await clickAt(page.getByTestId('run-confirm-ok'))

// 3) R、U、X：長的過程中畫面不動、欄位鎖住並寫原因、佇列只在標題列顯示數量
mark('R U X 長的過程（畫面不動、鎖住的原因、佇列不展開）')
await growing('true')
await page.getByTestId('oneliner-locked').hover()
await growing('false')
mark('R 長完一次放進畫面')
await pause(3500)

// 4) Y：提示上的「復原」一步拿掉整次生成；重做再回來
mark('Y 復原整次生成、重做')
await clickAt(page.getByTestId('toast').getByRole('button', { name: '復原' }))
await pause(2500)
await clickAt(page.getByTestId('redo'))
await pause(2500)

// 5) S：再生成一次，勾「刪掉現有的內容」：寫清楚刪幾個場、幾個鏡頭、能復原
mark('S 刪掉現有內容的警告')
await clickAt(page.getByTestId('oneliner-generate'))
await page.getByTestId('run-confirm').waitFor()
await pause(1500)
await clickAt(page.getByTestId('grow-replace'))
await pause(4500)
await clickAt(page.getByTestId('run-confirm-ok'))
await growing('true')
await growing('false')
await pause(2500)

// 6) Y：Ctrl+Z，舊的內容全部回來
mark('Y 刪掉並生成之後 Ctrl+Z')
await page.keyboard.press('Control+z')
await pause(3500)

// 7) W：影片的 ▶：確認面板貼著 ▶、不蓋住標亮的那一串
mark('W ▶ 的確認面板不蓋住標亮')
const video = await page.evaluate(
  () =>
    window.__svsCanvas
      .getNodes()
      .filter((n) => n.data.kind === 'video')
      .at(-1)?.id,
)
await page.evaluate((id) => {
  const n = window.__svsCanvas.getNode(id)
  void window.__svsCanvas.setCenter(n.position.x - 200, n.position.y + 115, {
    zoom: 0.85,
    duration: 500,
  })
}, video)
await pause(1200)
await clickAt(page.getByTestId(`run-${video}`))
await page.getByTestId('run-confirm').waitFor()
await pause(3500)
await page.keyboard.press('Escape')
await pause(1000)

// 8) X：佇列要自己按才展開
mark('X 佇列自己按才展開')
await clickAt(page.getByTestId('queue-toggle'))
await pause(3000)
await clickAt(page.getByTestId('queue-toggle'))
await pause(1500)
mark('結束')

await stop()
