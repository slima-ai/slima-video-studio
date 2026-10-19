/* global window */
// 錄一段約 35 秒的「畫布與表單頁同步」影片（M6-10c，給審查用）：
// 畫布：新增角色、選它按 Enter 打開面板、改名字儲存 → 到「角色」頁：名字已經是新的
// → 角色頁開著時（例如另一個面板）改了名字：清單馬上更新 → 回畫布：角色卡也是新名字
// → 分鏡表刪掉第 1 鏡 → 回畫布：那一鏡不見了。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/sync-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('sync-m6-10c.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const graph = async () => (await page.evaluate(() => window.svs.invoke('canvas.get', {}))).data

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)

// 1) 畫布上改角色名字
mark('畫布上改角色名字')
await clickAt(page.getByTestId('palette-character'))
await pause(1500)
// 點新角色的標題列選它，再按 Enter 打開面板
const hero = (await graph()).nodes.find((n) => n.kind === 'character')
const card = await page.locator(`.react-flow__node[data-id="${hero.key}"]`).boundingBox()
await page.mouse.move(card.x + 60, card.y + 14, { steps: 15 })
await page.mouse.click(card.x + 60, card.y + 14)
await pause(400)
await page.keyboard.press('Enter')
await pause(1500)
const name = page.getByTestId('character-name')
await clickAt(name)
await page.keyboard.press('Control+a')
await page.keyboard.type('阿鐵', { delay: 150 })
await clickAt(page.getByTestId('character-save'))
await pause(1500)

// 2) 角色頁：名字已經是新的
mark('角色頁看到新名字')
await clickAt(page.getByRole('button', { name: '角色', exact: true }))
await pause(2000)

// 3) 角色頁開著時，別的地方改了名字（這裡直接呼叫，等於畫布的面板改了）：清單馬上更新
mark('別處改名，角色頁馬上更新')
await page.evaluate(async () => {
  const list = await window.svs.invoke('characters.list', {})
  const id = list.data.characters[0].id
  await window.svs.invoke('characters.update', { characterId: id, patch: { name: '阿鐵（主角）' } })
})
await pause(2500)

// 4) 分鏡表刪第 1 鏡 → 畫布那一鏡不見了
mark('分鏡表刪第 1 鏡')
await clickAt(page.getByRole('button', { name: '分鏡表' }))
await pause(1500)
const first = (await graph()).nodes.find((n) => n.kind === 'shot' && n.title === '第 1 鏡')
await clickAt(page.getByTestId('row-select').first())
await pause(500)
await clickAt(page.getByTestId('storyboard-delete'))
await pause(800)
await clickAt(page.getByTestId('storyboard-delete-confirm'))
await pause(1500)
mark('回畫布')
await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await pause(1500)
await page.evaluate(() => window.__svsCanvas.fitView({ duration: 400, maxZoom: 0.8 }))
await pause(2500)
console.log(
  `第 1 鏡 ${first ? first.key : '找不到'} 在畫布上：${String((await graph()).nodes.some((n) => n.key === first?.key))}`,
)
mark('結束')

await stop()
