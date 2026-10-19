/* global window */
// 錄一段約 90 秒的「執行的回饋」影片（M6-7d-6，給審查用）：
// ▶ 的說明依狀態寫、確認面板一打開說明就收起來、面板不淡入（Z8、Z11）→ 清單與佇列都叫「第一張畫面」（Z3）
// → 開始的提示照清單寫、固定在右下角（Z4、Z5）→ 生成中有 ■、骨架與秒數、上方列「生成中 1/2 · 停止」（Z7）
// → 佇列和格子同步（Z6）→ 完成的提示（Z5）→ 重做寫「產生 v2，保留 v1」（Z9）
// → Ctrl+Enter 執行選取的鏡頭、中途按「停止」（Z13）→ 故意失敗、改掉內容後「重試」（Z13）
// → 從上方列執行、要做的那一格在畫面外：先平移帶進來（Z12）。
// 用法：SVS_MOCK_LATENCY_MS=1200 SVS_MOCK_REJECT_TEXT=【拒絕】 xvfb-run -a -s "-screen 0 1440x900x24" \
//   node scripts/run-feedback-record.mjs <輸出資料夾>
// 每一段開始的秒數會印出來，填進驗收清單。
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('run-feedback-m6-7d6.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const center = (key, zoom = 1) =>
  page.evaluate(
    ([id, z]) => {
      const n = window.__svsCanvas.getNode(id)
      void window.__svsCanvas.setCenter(n.position.x + 115, n.position.y + 115, {
        zoom: z,
        duration: 500,
      })
    },
    [key, zoom],
  )
const addShot = async () => {
  const added = await page.evaluate(() => window.svs.invoke('canvas.add', { kind: 'shot' }))
  return added.data.key
}
const setDescription = (key, text) =>
  page.evaluate(
    ([id, description]) =>
      window.svs.invoke('shots.update', { shotId: id, patch: { description } }),
    [key.replace(/^shot:/, ''), text],
  )
const statusOf = (key) => page.evaluate((id) => window.__svsCanvas.getNode(id)?.data.status, key)
const waitStatus = async (key, want) => {
  for (let i = 0; i < 400; i++) {
    if ((await statusOf(key)) === want) return
    await pause(150)
  }
  throw new Error(`${key} 一直不是 ${want}`)
}

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)

// 1) Z8、Z11、Z3：新的空鏡頭，滑過影片的 ▶ 看說明；按下去面板馬上出現，說明收起來
const shot5 = await addShot()
await pause(1200)
await center(`${shot5}:image`, 1)
await pause(1200)
mark('Z8 ▶ 的說明依狀態寫')
await page.getByTestId(`run-${shot5}:video`).hover()
await pause(2200)
mark('Z11 Z3 面板不淡入、說明收起來、叫「第一張畫面」')
await clickAt(page.getByTestId(`run-${shot5}:video`))
await page.getByTestId('run-confirm').waitFor()
await pause(3000)

// 2) Z4、Z5、Z7、Z6：確認 → 開始的提示（右下角）、生成中的格子與上方列、打開佇列對照
mark('Z4 Z5 Z7 開始生成：提示、骨架與 ■、上方列進度')
await clickAt(page.getByTestId('run-confirm-ok'))
await pause(2500)
mark('Z6 Z3 佇列與格子同步')
await clickAt(page.getByTestId('queue-toggle'))
await waitStatus(`${shot5}:video`, 'done')
mark('Z5 完成的提示')
await pause(2500)
await clickAt(page.getByTestId('queue-toggle'))
await pause(800)

// 3) Z9：已完成的影片按 ▶：重做會產生 v2、保留 v1
mark('Z9 重做寫版本')
await page.getByTestId(`run-${shot5}:video`).hover()
await pause(1800)
await clickAt(page.getByTestId(`run-${shot5}:video`))
await page.getByTestId('run-confirm').waitFor()
await pause(3000)
await page.keyboard.press('Escape')
await pause(800)

// 4) Z13：選取新的鏡頭按 Ctrl+Enter；開始後按上方列的「停止」
mark('Z13 Ctrl+Enter 執行選取的鏡頭')
const shot6 = await addShot()
// 和第 5 鏡不同的描述（一樣的話結果會直接沿用，一下就做完，來不及示範停止）
await setDescription(shot6, '一隻貓在窗邊打瞌睡')
await pause(1200)
await center(`${shot6}:image`, 1)
await pause(1000)
await clickAt(page.locator(`.react-flow__node[data-id="${shot6}"]`))
await pause(600)
await page.keyboard.press('Control+Enter')
await page.getByTestId('run-confirm').waitFor()
await pause(2200)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.getByTestId('run-stop').waitFor()
await pause(700)
mark('Z13 中途停止')
await clickAt(page.getByTestId('run-stop'))
await pause(3000)

// 5) Z13：故意失敗 → 格子寫原因、按鈕變「重試」→ 改掉內容 → 重試
mark('Z13 失敗與重試')
await setDescription(shot6, '一隻貓在窗邊【拒絕】')
await pause(1500)
await clickAt(page.getByTestId(`run-${shot6}:image`))
await page.getByTestId('run-confirm').waitFor()
await pause(1200)
await clickAt(page.getByTestId('run-confirm-ok'))
await waitStatus(`${shot6}:image`, 'failed')
await pause(3500)
await setDescription(shot6, '一隻貓在窗邊看雨')
await pause(1500)
await clickAt(page.getByTestId(`run-${shot6}:image`))
await page.getByTestId('run-confirm').waitFor()
await pause(1200)
await clickAt(page.getByTestId('run-confirm-ok'))
await waitStatus(`${shot6}:video`, 'done')
await pause(2500)

// 6) Z12：畫面移到遠處，再從上方列「全部生成」：先平移把要做的那一格帶進來，面板才出現
mark('Z12 上方列執行時把目標帶進畫面')
const shot7 = await addShot()
await pause(1000)
await page.evaluate(
  () => void window.__svsCanvas.setViewport({ x: 2600, y: 2200, zoom: 0.8 }, { duration: 600 }),
)
await pause(1800)
await clickAt(page.getByTestId('run-all'))
await page.getByTestId('run-confirm').waitFor()
await pause(3500)
await page.keyboard.press('Escape')
await pause(800)
mark(`結束（${shot7}）`)

await stop()
