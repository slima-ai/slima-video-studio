/* global document */
// 錄一段約 30 秒的「從畫布新增節點」影片（M6-7b，給審查用）。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/canvas-add-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, centerOf, clickAt, record } = await prepare(outDir)
const stop = await record('canvas-add-m6-7b.mp4')

// 1) 回到畫布，看左側節點面板
await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(1500)

// 2) 面板上點「鏡頭」：長出第 4 鏡、自動選取；再用 toast 的「復原」收回
await clickAt(page.getByTestId('palette-shot'))
await pause(1800)
await clickAt(page.getByTestId('toast-action'))
await pause(1500)

// 3) 面板上點「角色」：新角色長出來；滑過它的輸出點出現「＋」，點開只列接得上的「鏡頭」
await clickAt(page.getByTestId('palette-character'))
await pause(1800)
const hero = page.locator('.react-flow__node[data-id^="character:"]')
const id = await hero.getAttribute('data-id')
const port = page.getByTestId(`port-${id}-char-out`)
const portPoint = await centerOf(port)
await page.mouse.move(portPoint.x, portPoint.y, { steps: 25 })
await pause(800)
await clickAt(page.getByTestId(`plus-${id}-char-out`))
await pause(1500)
await page.getByTestId('add-menu').getByRole('option', { name: /鏡頭/ }).click()
await pause(2200)

// 4) 按 Tab 開新增選單，打「地點」再 Enter
await page.getByTestId('canvas-root').click({ position: { x: 700, y: 20 } })
await page.keyboard.press('Tab')
await pause(900)
await page.keyboard.type('地點', { delay: 160 })
await pause(900)
await page.keyboard.press('Enter')
await pause(2000)

// 5) 在空白處雙擊：新增選單出現在游標旁，選「場」
// 找一個真的是空白處的點（沒有節點、連線、面板）
const spot = await page.evaluate(() => {
  for (let y = 700; y > 120; y -= 30) {
    for (let x = 1300; x > 700; x -= 30) {
      const el = document.elementFromPoint(x, y)
      if (el?.classList.contains('react-flow__pane')) return { x, y }
    }
  }
  return undefined
})
if (!spot) throw new Error('找不到空白處')
await page.mouse.move(spot.x, spot.y, { steps: 20 })
await pause(400)
await page.mouse.dblclick(spot.x, spot.y)
await pause(1200)
await page.getByTestId('add-menu').getByRole('option', { name: /場/ }).first().click()
await pause(2200)

// 6) Cmd/Ctrl+Z 收回新增的場，再按一次收回新鏡頭
await page.keyboard.press('Control+z')
await pause(1500)
await page.keyboard.press('Control+z')
await pause(1500)

await stop()
