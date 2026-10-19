/* global window */
// 錄一段約 60 秒的「畫布的回饋」影片（M6-7d-3，給審查用）：
// 視窗上方沒有英文選單（AC）、上方列的已花與步數（F）→ 滑過鏡頭才出現沒接線的點（F）
// → 新增角色放在看得到的地方（G）→ 拉線時接得上的亮綠、接不上的淡掉（J）→ 選取角色出現剪線的 ×（H）
// → 拖鏡頭時場框即時長大、拖進別的場有大的提示（L）→ 整理（F）→ 刪角色再復原（N）；提示一次一則（I、T）。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/canvas-feedback-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('canvas-feedback-m6-7d3.mp4')

const nodes = () =>
  page.evaluate(() =>
    window.__svsCanvas
      .getNodes()
      .map((n) => ({ id: n.id, kind: n.data.kind, x: n.position.x, y: n.position.y })),
  )
const fit = () =>
  page.evaluate(
    () =>
      void window.__svsCanvas.fitView({
        maxZoom: 0.85,
        duration: 600,
        padding: { top: '80px', left: '270px', right: '40px', bottom: '48px' },
      }),
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

// 1) AC、F：沒有英文選單；上方列「已花 US$0.00」、復原步數
await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1200)
await fit()
await pause(2500)

// 2) F：滑過第 1 鏡，才出現沒接線的「角色」「地點」點
const [shot] = (await nodes()).filter((n) => n.kind === 'shot')
const shotBox = await page.getByTestId(`rf__node-${shot.id}`).boundingBox()
await page.mouse.move(shotBox.x + shotBox.width / 2, shotBox.y + shotBox.height / 2, { steps: 20 })
await pause(2000)

// 3) G：新增角色，放在看得到的地方
await clickAt(page.getByTestId('palette-character'))
await pause(2200)
await fit()
await pause(1500)
const hero = (await nodes()).find((n) => n.kind === 'character')

// 4) J：從角色拉線，鏡頭亮綠、圖與影片淡掉；放到第 1 鏡的「角色」點
const from = await centerOf(`port-${hero.id}-char-out`)
const to = await centerOf(`port-${shot.id}-shot-ref-char`)
await glide(from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })
await pause(1800)
await page.mouse.move(to.x, to.y, { steps: 15 })
await pause(600)
await page.mouse.up()
await pause(2000)

// 5) H：選取角色，線中點出現「×」；按下去剪線，再按提示上的復原
await clickAt(page.getByTestId(`rf__node-${hero.id}`))
await pause(1500)
await clickAt(page.getByRole('button', { name: '剪掉這條線' }))
await pause(1500)
await clickAt(page.getByTestId('toast-action'))
await pause(1500)

// 6) L：新增一個場，把第 1 鏡拖進去（目標框即時長大、大的提示）
await clickAt(page.getByTestId('palette-scene'))
await pause(1800)
await fit()
await pause(1500)
const scenes = (await nodes()).filter((n) => n.kind === 'scene')
const second = scenes[1]
const target = await page.getByTestId(`rf__node-${second.id}`).boundingBox()
const grip = await page.getByTestId(`rf__node-${shot.id}`).boundingBox()
await glide(
  { x: grip.x + 50, y: grip.y + 14 },
  { x: target.x + target.width / 2, y: target.y + target.height / 2 },
  40,
)
await pause(2200)
await page.mouse.up()
await pause(2500)

// 7) F：整理：拖過的回到排好的位置，步數多一
await clickAt(page.getByTestId('tidy'))
await pause(2500)

// 8) N：刪角色（說明出場的鏡頭會拿掉它），再復原
await fit()
await pause(1000)
await clickAt(page.getByTestId(`rf__node-${hero.id}`))
await page.keyboard.press('Backspace')
await pause(2500)
await clickAt(page.getByTestId('delete-confirm-ok'))
await pause(1800)
await clickAt(page.getByTestId('undo'))
await pause(2500)
await stop()
