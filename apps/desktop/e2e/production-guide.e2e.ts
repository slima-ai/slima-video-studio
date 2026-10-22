import { DEFAULT_PRODUCTION_GUIDE, DEFAULT_STORYBOARD_GUIDE } from '@svs/schema'

import { expect, test } from './fixtures'
import { launchApp } from './launch'

test.describe('設定頁：製片與一致性指南', () => {
  test('看得到預設、改了存起來、重開還在；跟分鏡準則各存各的；恢復預設', async ({
    app,
    page,
    userDataDir,
  }, testInfo) => {
    await page.getByRole('button', { name: '設定' }).click()
    const section = page.getByTestId('production-guide-section')
    await section.getByTestId('setting-card-more').click()
    const box = page.getByTestId('production-guide')
    await expect(box).toHaveValue(DEFAULT_PRODUCTION_GUIDE)
    await section.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('production-guide-default.png') })

    await box.fill('臉先鎖定，再拍鏡頭。')
    await section.getByRole('button', { name: '儲存' }).click()
    await expect(section.getByRole('status')).toContainText('已儲存')
    await page.screenshot({ path: testInfo.outputPath('production-guide-saved.png') })

    // 重開 App：指南還在，分鏡準則沒被動到（還是預設）
    await app.close()
    const second = await launchApp({ userDataDir })
    try {
      const page2 = await second.app.firstWindow()
      await page2.getByRole('button', { name: '設定' }).click()
      const section2 = page2.getByTestId('production-guide-section')
      await section2.getByTestId('setting-card-more').click()
      await expect(page2.getByTestId('production-guide')).toHaveValue('臉先鎖定，再拍鏡頭。')
      await page2.getByTestId('storyboard-guide-section').getByTestId('setting-card-more').click()
      await expect(page2.getByTestId('storyboard-guide')).toHaveValue(DEFAULT_STORYBOARD_GUIDE)

      await section2.getByRole('button', { name: '恢復預設' }).click()
      await expect(page2.getByTestId('production-guide')).toHaveValue(DEFAULT_PRODUCTION_GUIDE)
      await expect(section2.getByRole('status')).toContainText('已恢復預設')
    } finally {
      await second.app.close()
    }
  })
})
