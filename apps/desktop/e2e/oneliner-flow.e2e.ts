import { existsSync, statSync } from 'node:fs'

import { centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

// 以前獨立的「快速開始」頁（M3）已經移除，整條流程改在畫布上的一句話節點完成（M6-8c-3）。
// 一句話節點本身的細節（確認面板、停止、取代全部）在 canvas-grow.e2e.ts。
test.describe('一句話做一支短片（示範模式）', () => {
  test('一句話 → 畫布長完 → 剪輯的 ↗ 預覽成品 → 匯出 MP4；佇列看得到這次的任務', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)

    // 底部佇列看得到這次的任務，全部完成
    await expect(page.getByTestId('queue-panel').getByRole('listitem').first()).toBeAttached()
    await expect(page.getByTestId('queue-active-count')).toHaveCount(0)

    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    // 成品預覽載入，3 鏡 × 3 秒，時長約 9 秒
    const video = page.getByTestId('final-cut-video')
    await expect(video).toBeVisible()
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)
    const duration = await video.evaluate((v: HTMLVideoElement) => v.duration)
    expect(duration).toBeGreaterThan(8)
    expect(duration).toBeLessThan(10)

    // 匯出 MP4 → 檔案存在專案的 exports/ 資料夾
    await page.getByTestId('final-cut-export').click()
    const exported = page.getByTestId('final-cut-exported')
    await expect(exported).toContainText('已匯出到')
    const path = (await exported.innerText()).replace('已匯出到 ', '').trim()
    expect(path).toMatch(/exports[\\/].+\.mp4$/)
    expect(existsSync(path)).toBe(true)
    expect(statSync(path).size).toBeGreaterThan(1000)
  })

  test('一句話長出的場與鏡頭，大綱與分鏡表也看得到（同一份資料，不用另外「升級成專案」）', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)

    await page.getByRole('button', { name: '大綱' }).click()
    await expect(page.getByTestId('act-card')).toHaveCount(1)
    await expect(page.getByTestId('scene-card')).toHaveCount(1)

    await page.getByRole('button', { name: '分鏡表' }).click()
    await expect(page.getByTestId('shot-row')).toHaveCount(3)
    const sceneName = await page
      .getByTestId('cell-scene')
      .first()
      .locator('option:checked')
      .innerText()
    expect(sceneName).not.toBe('')
    for (const scene of await page.getByTestId('cell-scene').all()) {
      await expect(scene.locator('option:checked')).toHaveText(sceneName)
    }
    for (const status of await page.getByTestId('shot-status').all()) {
      await expect(status).toHaveText('已完成')
    }
  })
})
