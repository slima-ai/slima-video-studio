/* global window */
// 錄一段約 35 秒的「這個專案預設用什麼」影片（M2-8c，給審查用）：
// 填了 fal.ai 金鑰、關掉示範模式 → 設定頁的表格：每列「跟著預設（X）」→ 影片改 Kling 3.0 Pro，
// 上面所有專案的預設不變 → 回畫布按 ▶：確認面板用的是這個專案選的 → 改回「跟著預設」→ 又照上面的。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/project-models-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
// 畫面外：填 fal.ai 金鑰、關掉示範模式（才有好幾個影片模型），再加一個還沒生成的鏡頭
await page.evaluate(async () => {
  await window.svs.invoke('keys.set', { provider: 'fal', key: 'fal-record-project-0123456789' })
  await window.svs.invoke('settings.update', { demoMode: false })
  await window.svs.invoke('canvas.add', { kind: 'shot' })
})
// 重新打開設定頁（讀到剛填的金鑰）
await page.getByRole('button', { name: '畫布', exact: true }).click()
await page.getByRole('button', { name: '設定', exact: true }).click()
await page.getByTestId('project-models-section').waitFor()

const stop = await record('project-models-m2-8c.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}

/** 把畫面帶到最後一個鏡頭的影片，按 ▶ 打開確認面板。 */
const runLastVideo = async () => {
  await clickAt(page.getByRole('button', { name: '畫布', exact: true }))
  await page.getByTestId('canvas-root').waitFor()
  await pause(600)
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
  await pause(1000)
  await clickAt(page.getByTestId(`run-${video}`))
}

mark('設定頁：這個專案預設用什麼，每列跟著預設')
await page.getByTestId('project-models-section').scrollIntoViewIfNeeded()
await pause(2500)
mark('影片改 Kling 3.0 Pro')
await clickAt(page.getByTestId('project-model-i2v'))
await pause(1500)
await clickAt(page.getByTestId('project-model-i2v-option-fal/kling-3.0-pro'))
await pause(1500)
mark('上面所有專案的預設不變')
await page.getByTestId('model-i2v').scrollIntoViewIfNeeded()
await pause(2500)

mark('回畫布按 ▶：用這個專案選的')
await runLastVideo()
await pause(3500)
await page.keyboard.press('Escape')
await pause(800)

mark('改回跟著預設')
await clickAt(page.getByRole('button', { name: '設定', exact: true }))
await page.getByTestId('project-models-section').waitFor()
await page.getByTestId('project-models-section').scrollIntoViewIfNeeded()
await pause(1500)
await clickAt(page.getByTestId('project-model-i2v'))
await pause(1200)
await clickAt(page.getByTestId('project-model-i2v-option-follow-app'))
await pause(1500)
mark('回畫布按 ▶：又照上面的')
await runLastVideo()
await pause(3500)
mark('結束')
await stop()
