/* global window */
// 錄一段約 30 秒的「還沒解鎖的模型」影片（M2-8b，給審查用）：
// 關掉示範模式、沒有任何金鑰 → 設定頁說填 OpenRouter 一把就能開始 → 填 OpenRouter → 選單出現模型，
// 只有 fal.ai 才有的模型排在最後、灰色、點了不會選 → 選單下面「填 fal.ai 的金鑰還能用：…」→「去填金鑰」
// 跳到 fal.ai 的欄位 → 重新看一次第一次使用的引導：只引導 OpenRouter 一把。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/locked-models-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir, { seed: false })
// 畫面外：關掉示範模式（測試模式預設開著）
await page.getByTestId('demo-mode').uncheck()
await page.getByTestId('models-empty').waitFor()
await page.evaluate(() => window.scrollTo(0, 0))

const stop = await record('locked-models-m2-8b.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}

mark('沒有金鑰：說填 OpenRouter 一把就能開始')
await page.getByTestId('models-empty').scrollIntoViewIfNeeded()
await pause(2500)

mark('填 OpenRouter 的金鑰')
const input = page.getByLabel('OpenRouter 的服務金鑰')
await input.scrollIntoViewIfNeeded()
await clickAt(input)
await page.keyboard.type('sk-or-record-locked-0123456789', { delay: 25 })
await clickAt(page.getByTestId('key-openrouter').getByRole('button', { name: '儲存' }))
await page.getByTestId('model-t2i').waitFor()
await pause(1500)

mark('圖片選單：fal.ai 才有的模型灰色、排最後')
await page.getByTestId('model-t2i').scrollIntoViewIfNeeded()
await pause(800)
await clickAt(page.getByTestId('model-t2i'))
await pause(2500)
mark('點灰色的：不會選')
await clickAt(page.getByRole('option', { name: /需要 fal\.ai 金鑰/ }).first())
await pause(1800)
await page.keyboard.press('Escape')
await pause(1000)

mark('選單下面：填 fal.ai 的金鑰還能用…')
await page.getByTestId('model-t2i-unlock').scrollIntoViewIfNeeded()
await pause(2000)
mark('去填金鑰 → 跳到 fal.ai 的欄位')
await clickAt(page.getByTestId('model-t2i-unlock').getByRole('button', { name: '去填金鑰' }))
await pause(2500)

mark('第一次使用的引導：只引導 OpenRouter 一把')
await page.evaluate(() => window.svs.invoke('settings.update', { onboardingDone: false }))
await page.reload()
await page.getByTestId('setup-wizard').waitFor()
await pause(1500)
await clickAt(page.getByTestId('wizard-keys'))
await pause(3500)
mark('結束')
await stop()
