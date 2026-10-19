/* global window */
// M2-8c 的深淺色截圖（給審查用）：設定頁「這個專案預設用什麼」表格，影片那一列的選單打開。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/project-models-shots.mjs <輸出資料夾>
import { join } from 'node:path'

import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { app, page, pause } = await prepare(outDir)
await page.evaluate(async () => {
  await window.svs.invoke('keys.set', { provider: 'fal', key: 'fal-shots-project-0123456789' })
  await window.svs.invoke('settings.update', { demoMode: false })
  await window.svs.invoke('models.setProject', { models: { t2i: 'fal/seedream-5.0' } })
})

for (const theme of ['light', 'dark']) {
  await page
    .getByTestId('general-section')
    .getByText(theme === 'light' ? '淺色' : '深色', { exact: true })
    .click()
  await page.getByRole('button', { name: '畫布', exact: true }).click()
  await page.getByRole('button', { name: '設定', exact: true }).click()
  const section = page.getByTestId('project-models-section')
  await section.waitFor()
  await section.scrollIntoViewIfNeeded()
  await page.getByTestId('project-model-i2v').click()
  await pause(400)
  await page.screenshot({ path: join(outDir, `project-models-${theme}.png`) })
  await page.keyboard.press('Escape')
}
await app.close()
console.log(outDir)
