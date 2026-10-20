/* global document, window */
// M6-7d 的總驗收錄影：驗收清單（A～Y、Z1～Z13、AA、AB，加上後來發現的 AC）每一項都在這一支示範一次。
// 從空的 App 開始，一路做到成品、執行、失敗與重試、分頁與專案頁。各段開始的秒數會印出來，填進驗收清單。
// 視窗上方全程沒有英文選單（AC）；提示一次只有一則（I、T）。
// 用法：SVS_MOCK_LATENCY_MS=400 SVS_MOCK_REJECT_TEXT=【拒絕】 xvfb-run -a -s "-screen 0 1440x900x24" \
//   node scripts/acceptance-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir, { seed: false })
const stop = await record('m6-7d-acceptance.mp4')
const started = Date.now()
const marks = []
const mark = (items, text) => {
  const at = (Date.now() - started) / 1000
  marks.push({ at, items, text })
  console.log(`${at.toFixed(1)}s [${items}] ${text}`)
}

// ── 小工具 ──
const nodes = () =>
  page.evaluate(() =>
    window.__svsCanvas.getNodes().map((n) => ({
      id: n.id,
      kind: n.data.kind,
      status: n.data.status,
      x: n.position.x,
      y: n.position.y,
    })),
  )
const center = (key, zoom = 1, dx = 115, dy = 115) =>
  page.evaluate(
    ([id, z, ox, oy]) => {
      const n = window.__svsCanvas.getNode(id)
      if (n)
        void window.__svsCanvas.setCenter(n.position.x + ox, n.position.y + oy, {
          zoom: z,
          duration: 600,
        })
    },
    [key, zoom, dx, dy],
  )
const fit = (maxZoom = 0.85) =>
  page.evaluate(
    (z) =>
      void window.__svsCanvas.fitView({
        maxZoom: z,
        duration: 600,
        padding: { top: '80px', left: '270px', right: '40px', bottom: '48px' },
      }),
    maxZoom,
  )
const view = (x, y, zoom) =>
  page.evaluate(
    ([vx, vy, z]) =>
      void window.__svsCanvas.setViewport({ x: vx, y: vy, zoom: z }, { duration: 700 }),
    [x, y, zoom],
  )
const centerOf = async (testId) => {
  const b = await page.getByTestId(testId).boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const glide = async (from, to, steps = 25) => {
  await page.mouse.move(from.x, from.y, { steps: 10 })
  await pause(200)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
}
const growing = (value) =>
  page.waitForFunction(
    (want) => document.querySelector('[data-testid="canvas-root"]')?.dataset.growing === want,
    value,
    { timeout: 180_000 },
  )
const statusOf = (key) => page.evaluate((id) => window.__svsCanvas.getNode(id)?.data.status, key)
const waitStatus = async (key, want) => {
  for (let i = 0; i < 600; i++) {
    if ((await statusOf(key)) === want) return
    await pause(150)
  }
  throw new Error(`${key} 一直不是 ${want}`)
}
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
const go = (name) => clickAt(page.getByRole('button', { name, exact: true }))

// ════════ 1. 空畫布 → 一句話 → 長出整支短片 ════════
await go('畫布')
await page.getByTestId('canvas-empty').waitFor()
mark('A AC', '空畫布中央的起點、「未命名專案」；視窗上方沒有英文選單')
await pause(3000)
await clickAt(page.getByTestId('empty-story'))
await page.keyboard.type('一隻貓在下雨的夜晚，躲進紙箱，被小女孩抱回家，在暖爐旁睡著了', {
  delay: 50,
})
await clickAt(page.getByTestId('empty-add-oneliner'))
await page.getByTestId('oneliner-story').waitFor()
mark('V K', '一句話的欄位都有標籤；新增面板沒有「節點」這個詞')
await pause(2500)
await clickAt(page.getByTestId('oneliner-shots'))
await pause(300)
await clickAt(page.getByTestId('oneliner-shots-option-4'))
await clickAt(page.getByTestId('oneliner-duration'))
await pause(300)
await clickAt(page.getByTestId('oneliner-duration-option-3'))
await pause(800)
mark('W', '確認面板貼在「生成影片」旁邊')
await clickAt(page.getByTestId('oneliner-generate'))
await page.getByTestId('run-confirm').waitFor()
await pause(2500)
await clickAt(page.getByTestId('run-confirm-ok'))
await growing('true')
mark('R U X Z7', '長的過程中畫面不動、欄位鎖住並寫原因、佇列不展開；上方列「生成中 · 停止」')
await pause(1500)
await page.getByTestId('oneliner-locked').hover()
await growing('false')
mark('R O', '長完一次把一句話和新的場放進畫面；選 4 鏡就長出 4 鏡')
await pause(3500)

// Y：整次生成一步復原、重做
mark('Y I T', '提示上的「復原」一步拿掉整次生成，再重做；提示一次只有一則')
await clickAt(page.getByTestId('toast').getByRole('button', { name: '復原' }))
await pause(2500)
await clickAt(page.getByTestId('redo'))
await pause(3000)

// ════════ 2. 卡片外觀 ════════
const shots = (await nodes()).filter((n) => n.kind === 'shot')
const first = shots[0].id
await center(`${first}:image`, 1.15, 115, 115)
await pause(1200)
mark(
  'D M Q',
  '卡片 16:9、底部「版本・模型（示範圖片）・耗時・多久前」、每格都有 ▶；示範圖的中文正常',
)
await pause(4000)
mark('Q', '佇列只顯示中文描述（打開看一下）')
await clickAt(page.getByTestId('queue-toggle'))
await pause(3000)
await clickAt(page.getByTestId('queue-toggle'))
await pause(800)

mark('B', '縮小到 0.35：「第 N 場」大字；0.18：鏡頭色塊大編號')
const area = await page.getByTestId('canvas-root').boundingBox()
await view(area.width / 2 - 250, area.height / 2 - 160, 0.35)
await pause(2800)
await view(area.width / 2 - 110, area.height / 2 - 70, 0.18)
await pause(2800)
await fit()
await pause(1500)

// ════════ 3. 上方列、成品 ════════
mark(
  'F E P Z2',
  '上方列（已花、復原步數、整理、全部生成）；剪輯卡收緊、成品第一格與「成品 v1 · 長度」，按 ▶ 播放',
)
await center('cut', 1.2, 130, 150)
await pause(2500)
await clickAt(page.getByTestId('cut-play'))
await pause(4500)

mark('C Z1', '「放進成品」是開關：關掉時提示說明影響；剪輯卡提醒要重新接、上方列變「接成成品」')
const secondVideo = `${shots[1].id}:video`
await center(secondVideo, 1)
await pause(1200)
await clickAt(page.getByTestId(`incut-${secondVideo}`))
await pause(3000)
await center('cut', 1.2, 130, 150)
await pause(2000)
mark('Z10 Z2', '接成品的一行確認「接成成品 · 3 段 · 免費（在本機處理）」；接好變 v2')
await clickAt(page.getByTestId('run-all'))
await page.getByTestId('run-confirm').waitFor()
await pause(3000)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.getByText('全部都生成好了').waitFor({ timeout: 60_000 })
await pause(3000)
// 放回去（接成品留到後面的「全部生成」一起做）
await center(secondVideo, 1)
await pause(800)
await clickAt(page.getByTestId(`incut-${secondVideo}`))
await pause(1500)

// ════════ 4. 編輯：角色、拉線、剪線、拖進別的場、整理、刪角色 ════════
await fit()
await pause(1000)
mark('F', '沒接線的點平常藏起來，滑過鏡頭才出現')
const shotBox = await page.getByTestId(`rf__node-${first}`).boundingBox()
await page.mouse.move(shotBox.x + shotBox.width / 2, shotBox.y + shotBox.height / 2, { steps: 15 })
await pause(2500)
mark('G', '新增角色：放在看得到、不被面板蓋住、不重疊的地方')
await clickAt(page.getByTestId('palette-character'))
await pause(2500)
await fit()
await pause(1500)
const hero = (await nodes()).find((n) => n.kind === 'character')
mark('J', '從角色拉線：接得上的鏡頭整格亮綠、圖與影片淡掉；放到第 1 鏡')
const from = await centerOf(`port-${hero.id}-char-out`)
const to = await centerOf(`port-${first}-shot-ref-char`)
await glide(from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })
await pause(2000)
await page.mouse.move(to.x, to.y, { steps: 15 })
await pause(500)
await page.mouse.up()
await pause(2200)
mark('H', '選取角色，線上出現看得見的「×」；剪線再復原')
await clickAt(page.getByTestId(`rf__node-${hero.id}`))
await pause(1500)
await clickAt(page.getByRole('button', { name: '剪掉這條線' }))
await pause(1500)
await clickAt(page.getByTestId('toast-action'))
await pause(1500)
mark('L', '新增一個場，把第 1 鏡拖進去：目標框即時長大、大的提示；選取場用外框')
await clickAt(page.getByTestId('palette-scene'))
await pause(2000)
await fit()
await pause(1500)
const scenes = (await nodes()).filter((n) => n.kind === 'scene')
const target = await page.getByTestId(`rf__node-${scenes[1].id}`).boundingBox()
const grip = await page.getByTestId(`rf__node-${first}`).boundingBox()
await glide(
  { x: grip.x + 50, y: grip.y + 14 },
  { x: target.x + target.width / 2, y: target.y + target.height / 2 },
  40,
)
await pause(2500)
await page.mouse.up()
await pause(2500)
mark('F', '「整理」：拖過的回到排好的位置（可以復原）')
await clickAt(page.getByTestId('tidy'))
await pause(2500)
await clickAt(page.getByTestId('undo'))
await pause(1200)
await clickAt(page.getByTestId('undo'))
await pause(1500)
mark('N', '刪角色（確認說明出場的鏡頭會拿掉它），再復原')
await fit()
await pause(1000)
await clickAt(page.getByTestId(`rf__node-${hero.id}`))
await page.keyboard.press('Backspace')
await pause(2500)
// 刪除不再跳確認框：提示（附「復原」）直接出現
await pause(1800)
await clickAt(page.getByTestId('undo'))
await pause(2500)

// ════════ 5. 一句話再生成：刪掉現有內容的警告 ════════
const oneliner = (await nodes()).find((n) => n.kind === 'oneliner')
await center(oneliner.id, 1, 150, 170)
await pause(1200)
mark(
  'S',
  '勾「刪掉現有的內容」：寫清楚刪幾個場、幾個鏡頭、角色地點留著、可以復原（這裡按 Esc 不刪）',
)
await clickAt(page.getByTestId('oneliner-generate'))
await page.getByTestId('run-confirm').waitFor()
await pause(1200)
await clickAt(page.getByTestId('grow-replace'))
await pause(4500)
await page.keyboard.press('Escape')
await pause(1000)

// ════════ 6. 執行：說明、面板、進度、停止、失敗與重試 ════════
const shot5 = await addShot()
await setDescription(shot5, '小女孩撐著傘走過巷口')
await pause(1200)
await center(`${shot5}:image`, 1)
await pause(1200)
mark('Z8', '滑過影片的 ▶：說明依狀態寫「補跑第一張畫面後生成影片（2 步）」')
await page.getByTestId(`run-${shot5}:video`).hover()
await pause(2500)
mark('Z11 Z3 W', '按下去面板馬上出現（不淡入）、說明收起來、清單叫「第一張畫面」、不蓋住標亮的格子')
await clickAt(page.getByTestId(`run-${shot5}:video`))
await page.getByTestId('run-confirm').waitFor()
await pause(3000)
mark('Z4 Z5 Z7', '開始的提示照清單寫、在右下角；格子有骨架、秒數與 ■；上方列「生成中 0/2 · 停止」')
await clickAt(page.getByTestId('run-confirm-ok'))
await pause(2500)
mark('Z6 Z3', '打開佇列：和格子同步，也叫「第一張畫面」')
await clickAt(page.getByTestId('queue-toggle'))
await waitStatus(`${shot5}:video`, 'done')
mark('Z5', '做完換成「完成：…」')
await pause(2500)
await clickAt(page.getByTestId('queue-toggle'))
await pause(800)
mark('Z9 Z8', '已完成的影片：說明是「重做這一步」，面板與按鈕寫「重做（產生 v2，保留 v1）」')
await page.getByTestId(`run-${shot5}:video`).hover()
await pause(2000)
await clickAt(page.getByTestId(`run-${shot5}:video`))
await page.getByTestId('run-confirm').waitFor()
await pause(3000)
await page.keyboard.press('Escape')
await pause(800)

const shot6 = await addShot()
await setDescription(shot6, '貓在窗邊打瞌睡')
await pause(1200)
await center(`${shot6}:image`, 1)
await pause(1000)
mark('Z13', '選取鏡頭按 Ctrl+Enter 執行；中途按上方列的「停止」')
await clickAt(page.locator(`.react-flow__node[data-id="${shot6}"]`))
await pause(600)
await page.keyboard.press('Control+Enter')
await page.getByTestId('run-confirm').waitFor()
await pause(2000)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.getByTestId('run-stop').waitFor()
await pause(600)
await clickAt(page.getByTestId('run-stop'))
await pause(3000)
mark('Z13', '故意失敗：格子寫原因、按鈕變「重試」、提示說幾步沒成功；改掉內容後重試成功')
await setDescription(shot6, '貓在窗邊【拒絕】')
await pause(1500)
await clickAt(page.getByTestId(`run-${shot6}:image`))
await page.getByTestId('run-confirm').waitFor()
await pause(1000)
await clickAt(page.getByTestId('run-confirm-ok'))
await waitStatus(`${shot6}:image`, 'failed')
await pause(3500)
await setDescription(shot6, '貓在窗邊看雨')
await pause(1500)
await clickAt(page.getByTestId(`run-${shot6}:image`))
await page.getByTestId('run-confirm').waitFor()
await pause(1000)
await clickAt(page.getByTestId('run-confirm-ok'))
await waitStatus(`${shot6}:video`, 'done')
await pause(2500)

mark(
  'Z12 Z1',
  '畫面移到遠處，從上方列「全部生成」：先平移把要做的那一格帶進來；清單最後一步是接成品',
)
const shot7 = await addShot()
await setDescription(shot7, '暖爐旁的貓伸懶腰')
await pause(800)
await view(2600, 2200, 0.8)
await pause(1800)
await clickAt(page.getByTestId('run-all'))
await page.getByTestId('run-confirm').waitFor()
await pause(3500)
await clickAt(page.getByTestId('run-confirm-ok'))
await page.getByText('全部都生成好了').waitFor({ timeout: 120_000 })
await center('cut', 1.2, 130, 150)
await pause(3000)

// ════════ 7. 分頁與專案頁 ════════
mark('AB', '每一頁的上方列都和畫布一樣；生成紀錄與檔案的篩選放上方列、只顯示中文描述、路徑一行')
for (const name of ['大綱', '分鏡表', '角色', '場景卡', '生成紀錄', '檔案', '設定']) {
  await go(name)
  await pause(1800)
}
mark('AA', '專案頁：開新專案（空畫布）→ 回專案頁打開原本的 → 回到它的畫布')
await go('專案')
await pause(2500)
await clickAt(page.getByTestId('project-new'))
await page.getByTestId('canvas-empty').waitFor()
await pause(2000)
await go('專案')
await pause(2000)
await clickAt(page.getByTestId('project-open'))
await page.getByTestId('canvas-root').waitFor()
await pause(3000)
mark('-', '結束')

await stop()
console.log(JSON.stringify(marks))
