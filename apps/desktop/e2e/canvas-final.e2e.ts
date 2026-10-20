import type { Page } from '@playwright/test'

import { canvasNodes, centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'
import { launchApp } from './launch'

/** 剪輯卡上的成品（版本與長度），從 `canvas.get` 讀。 */
async function finalOf(page: Page) {
  const result = await page.evaluate(() => window.svs.invoke('canvas.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data.nodes.find((n) => n.kind === 'cut')?.final
}

test.describe('剪輯與成品', () => {
  test('關掉 App 再開，成品還在：剪輯卡顯示同一版、可以播放', async ({
    page,
    app,
    userDataDir,
  }) => {
    await generateAndOpenCanvas(page)
    const before = await finalOf(page)
    expect(before?.version).toBe(1)
    expect(before?.durationSec ?? 0).toBeGreaterThan(0)

    await app.close()
    const again = await launchApp({ userDataDir })
    try {
      const next = await again.app.firstWindow()
      await next.waitForLoadState('domcontentloaded')
      await next.getByRole('button', { name: '畫布', exact: true }).click()
      await expect(next.getByTestId('canvas-root')).toBeVisible()
      await expect.poll(async () => (await finalOf(next))?.assetHash).toBe(before?.assetHash)
      await centerOn(next, 'cut')
      await expect(next.getByTestId('cut-footer')).toContainText('成品 v1')
      const video = next.getByTestId('cut-final-video')
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1)
    } finally {
      await again.app.close().catch(() => undefined)
    }
  })

  test('少放一鏡進成品，按剪輯卡的「接成成品」：成品少一鏡的長度、變成第 2 版', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const before = await finalOf(page)
    const [, second] = (await canvasNodes(page)).filter((n) => n.data.kind === 'video')
    if (!second || !before?.durationSec) throw new Error('沒有成品')
    await centerOn(page, second.id)
    await page.getByTestId(`incut-${second.id}`).click()
    // 沒放進成品的影片格子是淡色
    await expect(page.getByTestId(`node-${second.id}`).locator('.svs-card')).toHaveCSS(
      'opacity',
      '0.55',
    )

    await centerOn(page, 'cut')
    await page.getByTestId('cut-rejoin').click()
    await expect(page.getByTestId('toast').filter({ hasText: '成品接好了' })).toBeVisible({
      timeout: 60_000,
    })
    await expect.poll(async () => (await finalOf(page))?.version).toBe(2)
    const after = await finalOf(page)
    // 每鏡 3 秒：少一鏡就短大約 3 秒（接片有一點誤差）
    expect(before.durationSec - (after?.durationSec ?? before.durationSec)).toBeGreaterThan(2)
    await expect(page.getByTestId('cut-footer')).toContainText('成品 v2')
  })

  test('剪輯卡的「匯出 MP4」：存到專案的「匯出」資料夾，提示可以打開資料夾', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await centerOn(page, 'cut')
    await page.getByTestId('cut-export').click()
    const toast = page.getByTestId('toast').filter({ hasText: '已匯出到專案的「匯出」資料夾' })
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('.mp4')
    await expect(toast.getByRole('button', { name: '打開資料夾' })).toBeVisible()
    const files = await page.evaluate(() => window.svs.invoke('files.list', {}))
    if (!files.ok) throw new Error('讀不到檔案')
    expect(files.data.exports.length).toBe(1)
  })

  test('還沒接過成品：「接成成品」「匯出 MP4」按不了，要先按 ▶', async ({ page }) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    // 有場才有剪輯：新增一場、一個鏡頭（都還沒生成）
    await page.getByTestId('palette-scene').click()
    await expect
      .poll(async () => (await canvasNodes(page)).some((n) => n.data.kind === 'scene'))
      .toBe(true)
    await page.getByTestId('palette-shot').click()
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === 'cut')).toBe(true)
    await centerOn(page, 'cut')
    await expect(page.getByTestId('cut-rejoin')).toBeDisabled()
    await expect(page.getByTestId('cut-export')).toBeDisabled()
  })
})
