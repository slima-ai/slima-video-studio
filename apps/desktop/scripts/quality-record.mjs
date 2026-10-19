/* global window */
// 錄一段約 35 秒的「生成鈕旁的品質」影片（M2-8a，給審查用）：
// 填了 fal.ai 金鑰、關掉示範模式 → 新鏡頭的影片按 ▶ → 確認面板換「高品質／平衡／經濟」：
// 用的模型與預估花費馬上跟著變 → 關掉之後上方列「全部生成」的估價也照選的等級
// → 分鏡表「生成選取的鏡頭」勾「先出草稿」：整批改用經濟組重新估價。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/quality-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
// 畫面外：填 fal.ai 金鑰、關掉示範模式（才有分等級的模型），再加一個還沒生成的鏡頭
await page.evaluate(async () => {
  await window.svs.invoke('keys.set', { provider: 'fal', key: 'fal-record-quality-0123456789' })
  await window.svs.invoke('settings.update', { demoMode: false })
  await window.svs.invoke('canvas.add', { kind: 'shot' })
})
const stop = await record('quality-m2-8a.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}

await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
await page.getByTestId('canvas-root').waitFor()
await pause(800)
const video = await page.evaluate(() => {
  const shots = window.__svsCanvas.getNodes().filter((n) => n.data.kind === 'shot')
  const last = shots.at(-1).id
  const node = window.__svsCanvas.getNode(`${last}:video`)
  window.__svsCanvas.setCenter(node.position.x + 120, node.position.y + 80, {
    zoom: 1,
    duration: 600,
  })
  return `${last}:video`
})
await pause(1200)

mark('▶ → 確認面板（預設）')
await clickAt(page.getByTestId(`run-${video}`))
await pause(2500)
for (const [id, label] of [
  ['quality-premium', '高品質'],
  ['quality-budget', '經濟（先出草稿）'],
  ['quality-balanced', '平衡'],
]) {
  mark(label)
  await clickAt(page.getByTestId(id))
  await pause(2200)
}
mark('高品質，關掉：上方列的估價跟著')
await clickAt(page.getByTestId('quality-premium'))
await pause(1200)
await page.keyboard.press('Escape')
await pause(2500)

mark('分鏡表：先出草稿')
await clickAt(page.getByRole('button', { name: '分鏡表' }))
await pause(1500)
// 選還沒生成的新鏡頭（最後一列）
await clickAt(page.getByTestId('row-select').last())
await pause(500)
await clickAt(page.getByTestId('storyboard-generate'))
await pause(2000)
await clickAt(page.getByTestId('storyboard-batch-draft'))
await pause(3000)
mark('結束')
await stop()
