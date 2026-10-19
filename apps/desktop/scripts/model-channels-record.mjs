// 錄一段約 30 秒的「一個模型多個管道」影片（M2-10，給審查用）：
// App 打開：選的影片模型（Veo 3.1 Lite）在 fal 下架、沒有別家可走，自動換成 Kling 3.0 Standard，提示說一次
// → 按「到設定」→ 填 fal.ai 與 OpenRouter 的金鑰 → 影片選單每個模型只列一次，下面寫「透過 fal.ai（OpenRouter 也有…）」
// → 選 Seedance 2.0：走比較便宜的 OpenRouter。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/model-channels-record.mjs <輸出資料夾>
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const NOTICE = '「Veo 3.1 Lite」已經下架，影片改用「Kling 3.0 Standard」。可以到設定換別的。'
const { page, pause, clickAt, record } = await prepare(outDir, {
  seed: false,
  // 模擬下架之後留下、還沒說過的通知（真實情況要等到 2026-10-22）
  settings: { onboardingDone: true, demoMode: false, modelNotices: [NOTICE] },
})
const stop = await record('model-channels-m2-10.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}

mark('下架通知')
await page.getByTestId('toast').waitFor()
await pause(2500)
mark('到設定、填兩把金鑰')
await clickAt(page.getByRole('button', { name: '到設定' }))
await pause(1000)
for (const [label, id, value] of [
  ['fal.ai 的服務金鑰', 'fal', 'fal-record-xxxxxxxx-wxyz'],
  ['OpenRouter 的服務金鑰', 'openrouter', 'sk-or-record-xxxxxxxx-abcd'],
]) {
  await clickAt(page.getByLabel(label))
  await page.keyboard.type(value, { delay: 25 })
  await clickAt(page.getByTestId(`key-${id}`).getByRole('button', { name: '儲存' }))
  await page.getByTestId(`key-${id}-status`).filter({ hasText: '已設定' }).waitFor()
  await pause(600)
}
mark('影片選單')
await page.getByTestId('model-i2v').scrollIntoViewIfNeeded()
await pause(1500)
await clickAt(page.getByTestId('model-i2v'))
await pause(2500)
mark('選 Seedance 2.0：走 OpenRouter')
await clickAt(page.getByTestId('model-i2v-option-openrouter/seedance-2.0'))
await pause(3000)
mark('結束')
await stop()
