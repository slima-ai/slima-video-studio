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

  test('另外加的參考圖（俯視、縱深感）：列在場景卡上、可以拿掉也能復原；鎖定後不能動', async ({
    page,
  }, testInfo) => {
    await page.getByRole('button', { name: '場景卡' }).click()
    await page.getByTestId('location-new-name').fill('舊倉庫')
    await page.getByTestId('location-add').click()
    await page.getByTestId('location-anchor').fill('潮濕的磚牆倉庫，天窗透進冷光')
    await page.getByTestId('location-anchor-save').click()
    await page.getByTestId('location-concepts-generate').click()
    const concepts = page.getByTestId('location-round-1').getByRole('button')
    await expect(concepts).toHaveCount(4, { timeout: 60_000 })
    await expect(page.getByTestId('location-extras')).toHaveCount(0)

    // 示範模式的概念圖是真的檔案：拿其中兩張當俯視圖與縱深感的環境圖
    const hashes = await page.evaluate(async () => {
      const list = await window.svs.invoke('locations.list', {})
      if (!list.ok) throw new Error('讀不到場景卡')
      const id = list.data.locations[0]?.id ?? ''
      const state = await window.svs.invoke('locations.images', { locationId: id })
      if (!state.ok) throw new Error('讀不到概念圖')
      const [a, b] = state.data.concepts
      if (!a || !b) throw new Error('概念圖不夠')
      for (const [hash, purpose, label] of [
        [a.assetHash, 'top_down', '從上面看的格局'],
        [b.assetHash, 'depth', ''],
      ] as const) {
        const added = await window.svs.invoke('locations.addReference', {
          locationId: id,
          assetHash: hash,
          purpose,
          label,
        })
        if (!added.ok) throw new Error('加不進去')
      }
      return { id }
    })
    const extras = page.getByTestId('location-extras')
    await expect(extras).toBeVisible()
    await expect(extras).toContainText('俯視・從上面看的格局')
    await expect(extras).toContainText('縱深感')
    await expect(extras.getByRole('img')).toHaveCount(2)
    await extras.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('location-extras.png') })

    // 拿掉一張，再復原
    await extras.getByRole('button', { name: '拿掉' }).first().click()
    await expect(extras.getByRole('img')).toHaveCount(1)
    await page.evaluate(() => window.svs.invoke('history.undo', {}))
    await expect(extras.getByRole('img')).toHaveCount(2)

    // 鎖定後不能拿掉
    await concepts.first().click()
    await page.getByTestId('location-lock').click()
    await expect(page.getByTestId('location-status')).toContainText('已鎖定')
    await expect(extras.getByRole('button', { name: '拿掉' }).first()).toBeDisabled()
    expect(hashes.id).not.toBe('')
  })
})
