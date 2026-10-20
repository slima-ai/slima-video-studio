import { DEFAULT_STORYBOARD_GUIDE } from '@svs/schema'

import { expect, test } from './fixtures'
import { launchApp } from './launch'

test.describe('設定頁：分鏡準則', () => {
  test('看得到預設、改了存起來、重開還在；存準則不會動到花費上限；恢復預設', async ({
    app,
    page,
    userDataDir,
  }, testInfo) => {
    await page.getByRole('button', { name: '設定' }).click()
    // 準則的編輯區收在卡片的「更多」裡
    await page.getByTestId('storyboard-guide-section').getByTestId('setting-card-more').click()
    const box = page.getByTestId('storyboard-guide')
    await expect(box).toHaveValue(DEFAULT_STORYBOARD_GUIDE)
    await page.getByTestId('storyboard-guide-section').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('guide-default.png') })

    // 先把花費上限改成 12.5，等一下存準則時它不能被蓋回預設的 5
    await page.getByTestId('per-run-limit').fill('12.5')
    await page.getByTestId('general-section').getByRole('button', { name: '儲存' }).click()
    await expect(page.getByTestId('general-section').getByRole('status')).toHaveText('已儲存。')

    await box.fill('每個場一定要有一個遠景。')
    await page.getByTestId('storyboard-guide-section').getByRole('button', { name: '儲存' }).click()
    await expect(page.getByTestId('storyboard-guide-section').getByRole('status')).toContainText(
      '已儲存',
    )
    await page.screenshot({ path: testInfo.outputPath('guide-saved.png') })

    // 重開 App：準則與花費上限都還在
    await app.close()
    const second = await launchApp({ userDataDir })
    try {
      const page2 = await second.app.firstWindow()
      await page2.getByRole('button', { name: '設定' }).click()
      await page2.getByTestId('storyboard-guide-section').getByTestId('setting-card-more').click()
      await expect(page2.getByTestId('storyboard-guide')).toHaveValue('每個場一定要有一個遠景。')
      await expect(page2.getByTestId('per-run-limit')).toHaveValue('12.5')

      await page2
        .getByTestId('storyboard-guide-section')
        .getByRole('button', { name: '恢復預設' })
        .click()
      await expect(page2.getByTestId('storyboard-guide')).toHaveValue(DEFAULT_STORYBOARD_GUIDE)
      await expect(page2.getByTestId('storyboard-guide-section').getByRole('status')).toContainText(
        '已恢復預設',
      )
      await expect(page2.getByTestId('per-run-limit')).toHaveValue('12.5')
    } finally {
      await second.app.close()
    }
  })
})
