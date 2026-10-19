/* global window */
// M2-8b 的深淺色截圖（給審查用）：只填 OpenRouter 時的圖片選單（灰色的 fal.ai 模型）、
// 選單下面的「填 fal.ai 的金鑰還能用」、第一次使用的引導只剩 OpenRouter。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/locked-models-shots.mjs <輸出資料夾>
import { join } from 'node:path'

import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { app, page, pause } = await prepare(outDir, { seed: false })
await page.getByTestId('demo-mode').uncheck()
await page.getByTestId('models-empty').waitFor()
await page.evaluate(() =>
  window.svs.invoke('keys.set', { provider: 'openrouter', key: 'sk-or-shots-0123456789' }),
)

for (const theme of ['light', 'dark']) {
  await page
    .getByTestId('general-section')
    .getByText(theme === 'light' ? '淺色' : '深色', { exact: true })
    .click()
  // 重新進設定頁讀金鑰與模型
  await page.getByRole('button', { name: '畫布', exact: true }).click()
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await page.getByTestId('model-t2i').scrollIntoViewIfNeeded()
  await page.getByTestId('model-t2i').click()
  await pause(400)
  await page.screenshot({ path: join(outDir, `settings-locked-${theme}.png`) })
  await page.keyboard.press('Escape')
}

// 第一次使用的引導（深色）
await page.evaluate(() => window.svs.invoke('settings.update', { onboardingDone: false }))
await page.reload()
await page.getByTestId('wizard-keys').click()
await pause(400)
await page.screenshot({ path: join(outDir, 'wizard-dark.png') })
await page.evaluate(() => window.svs.invoke('settings.update', { theme: 'light' }))
await page.reload()
await page.getByTestId('wizard-keys').click()
await pause(400)
await page.screenshot({ path: join(outDir, 'wizard-light.png') })
await app.close()
console.log(outDir)
