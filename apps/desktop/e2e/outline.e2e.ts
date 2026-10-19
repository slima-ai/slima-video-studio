import { launchApp } from './launch'
import { expect, test } from './fixtures'

test.describe('大綱', () => {
  test('自己寫：新增一幕、改名、新增地點並指定給場、調整順序；重開 App 後還在', async ({
    page,
    app,
    userDataDir,
  }) => {
    await page.getByRole('button', { name: '大綱' }).click()
    await expect(page.getByTestId('outline-empty')).toBeVisible()

    await page.getByTestId('act-add').click()
    await expect(page.getByTestId('act-card')).toHaveCount(1)
    await page.getByTestId('act-title').fill('雨夜相遇')
    await page.getByTestId('act-title').blur()
    await expect(page.getByTestId('act-title')).toHaveValue('雨夜相遇')

    await page.getByTestId('location-add').click()
    await page.getByTestId('location-name').fill('舊街')
    await page.getByTestId('location-name').blur()
    await expect(page.getByTestId('scene-location').locator('option')).toHaveCount(2)

    await page.getByTestId('scene-title').fill('街角')
    await page.getByTestId('scene-title').blur()
    await page.getByTestId('scene-location').selectOption({ label: '舊街' })
    await page.getByTestId('scene-time').fill('深夜')
    await page.getByTestId('scene-time').blur()

    await page.getByTestId('act-add-scene').click()
    await expect(page.getByTestId('scene-card')).toHaveCount(2)
    await page.getByTestId('scene-title').nth(1).fill('紙箱')
    await page.getByTestId('scene-title').nth(1).blur()
    await page.getByTestId('scene-move-up').nth(1).click()
    await expect(page.getByTestId('scene-title').first()).toHaveValue('紙箱')

    await app.close()
    const again = await launchApp({ userDataDir })
    try {
      const next = await again.app.firstWindow()
      await next.waitForLoadState('domcontentloaded')
      await next.getByRole('button', { name: '大綱' }).click()
      await expect(next.getByTestId('act-title')).toHaveValue('雨夜相遇')
      await expect(next.getByTestId('scene-title').first()).toHaveValue('紙箱')
      await expect(next.getByTestId('scene-title').nth(1)).toHaveValue('街角')
      await expect(next.getByTestId('scene-location').nth(1)).toHaveValue(/.+/)
      await expect(next.getByTestId('scene-time').nth(1)).toHaveValue('深夜')
      await expect(next.getByTestId('location-name')).toHaveValue('舊街')
    } finally {
      await again.app.close().catch(() => undefined)
    }
  })

  test('刪除一幕要先確認；刪掉地點後場只是不再指定地點', async ({ page }) => {
    await page.getByRole('button', { name: '大綱' }).click()
    await page.getByTestId('act-add').click()
    await page.getByTestId('location-add').click()
    await page.getByTestId('scene-location').selectOption({ index: 1 })
    await expect(page.getByTestId('scene-location')).not.toHaveValue('')

    await page.getByTestId('location-delete').click()
    await expect(page.getByTestId('location-card')).toHaveCount(0)
    await expect(page.getByTestId('scene-location')).toHaveValue('')

    await page.getByTestId('act-delete').click()
    await expect(page.getByTestId('act-card')).toHaveCount(1)
    await page.getByTestId('act-delete-confirm').click()
    await expect(page.getByTestId('act-card')).toHaveCount(0)
    await expect(page.getByTestId('outline-empty')).toBeVisible()
  })

  test('貼上故事讓 AI 拆成分場（示範模式）；再拆一次要先確認會換掉', async ({ page }) => {
    await page.getByRole('button', { name: '大綱' }).click()
    await expect(page.getByTestId('outline-split')).toBeDisabled()
    await page.getByTestId('outline-split-text').fill('雨夜，阿鐵在舊街撿到一隻小貓，把牠帶回家。')
    await expect(page.getByTestId('outline-split-cost')).toContainText('不會花錢')
    await page.getByTestId('outline-split').click()
    await expect(page.getByTestId('outline-split-result')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('act-card').first()).toBeVisible()
    await expect(page.getByTestId('scene-card').first()).toBeVisible()
    await expect(page.getByTestId('outline-split-text')).toHaveValue('')

    // 已經有大綱：先確認
    await page.getByTestId('outline-split-text').fill('另一個故事')
    await expect(page.getByTestId('outline-split-cost')).toContainText('不會花錢')
    await page.getByTestId('outline-split').click()
    await expect(page.getByTestId('outline-split-confirm')).toBeVisible()
    await page.getByTestId('outline-split-confirm-yes').click()
    await expect(page.getByTestId('outline-split-confirm')).toBeHidden()
    await expect(page.getByTestId('outline-split-text')).toHaveValue('', { timeout: 30_000 })
  })
})
