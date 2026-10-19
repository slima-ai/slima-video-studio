import { launchApp } from './launch'
import { expect, test } from './fixtures'

import type { Page } from '@playwright/test'

/** 從主行程讀鏡頭（含自動組出的 Prompt）；畫面上沒有顯示這個欄位。 */
async function autoPrompts(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const result = await window.svs.invoke('shots.list', {})
    return result.ok ? result.data.shots.map((shot) => shot.autoPrompt) : []
  })
}

test.describe('場景卡', () => {
  test('沒有地點時說明怎麼開始；新增、寫描述、存起來，重開 App 後還在', async ({
    page,
    app,
    userDataDir,
  }) => {
    await page.getByRole('button', { name: '場景卡' }).click()
    await expect(page.getByTestId('location-empty')).toBeVisible()

    await page.getByTestId('location-new-name').fill('舊倉庫')
    await page.getByTestId('location-add').click()
    await expect(page.getByTestId('location-card')).toBeVisible()
    await expect(page.getByTestId('location-status')).toContainText('草稿')
    await expect(page.getByTestId('location-lock')).toBeDisabled()

    await page.getByTestId('location-anchor').fill('潮濕的磚牆倉庫，天窗透進冷光')
    await page.getByTestId('location-anchor-save').click()
    await expect(page.getByTestId('location-anchor-save')).toBeDisabled()

    await app.close()
    const again = await launchApp({ userDataDir })
    try {
      const next = await again.app.firstWindow()
      await next.waitForLoadState('domcontentloaded')
      await next.getByRole('button', { name: '場景卡' }).click()
      await next.getByTestId('location-item-舊倉庫').click()
      await expect(next.getByTestId('location-anchor')).toHaveValue('潮濕的磚牆倉庫，天窗透進冷光')
    } finally {
      await again.app.close().catch(() => undefined)
    }
  })

  test('概念圖 → 挑主圖 → 另外兩個角度 → 鎖定；鎖定後鏡頭自動帶入場景，解除鎖定就不帶', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '場景卡' }).click()
    await page.getByTestId('location-new-name').fill('舊倉庫')
    await page.getByTestId('location-add').click()
    await page.getByTestId('location-anchor').fill('潮濕的磚牆倉庫，天窗透進冷光')
    await page.getByTestId('location-anchor-save').click()

    await expect(page.getByTestId('location-concepts-cost')).toContainText('不會花錢')
    await expect(page.getByTestId('location-angles-generate')).toHaveCount(0)
    await page.getByTestId('location-concepts-generate').click()
    const concepts = page.getByTestId('location-round-1').getByRole('button')
    await expect(concepts).toHaveCount(4, { timeout: 60_000 })
    await expect(page.getByTestId('location-progress')).toBeHidden()

    await concepts.nth(1).click()
    await expect(concepts.nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('location-main').getByRole('img')).toBeVisible()

    await page.getByTestId('location-angles-generate').click()
    await expect(page.getByTestId('location-reverse').getByRole('img')).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByTestId('location-wide').getByRole('img')).toBeVisible()

    // 鎖定前，鏡頭不帶場景描述
    await page.getByRole('button', { name: '分鏡表' }).click()
    await page.getByTestId('storyboard-add').click()
    await page.getByTestId('cell-location').selectOption({ label: '舊倉庫' })
    await expect.poll(() => autoPrompts(page)).toEqual([expect.not.stringContaining('磚牆倉庫')])

    await page.getByRole('button', { name: '場景卡' }).click()
    await page.getByTestId('location-lock').click()
    await expect(page.getByTestId('location-status')).toContainText('已鎖定')
    await expect(page.getByTestId('location-anchor')).toBeDisabled()
    await expect(concepts.first()).toBeDisabled()
    await expect
      .poll(() => autoPrompts(page))
      .toEqual([expect.stringContaining('場景（舊倉庫）——潮濕的磚牆倉庫，天窗透進冷光')])

    await page.getByTestId('location-unlock').click()
    await expect(page.getByTestId('location-anchor')).toBeEnabled()
    await expect.poll(() => autoPrompts(page)).toEqual([expect.not.stringContaining('磚牆倉庫')])
  })
})
