import type { Page, TestInfo } from '@playwright/test'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'
import { pick } from './pick'

// 畫面文字的改前、改後對照用：把有文案的幾個畫面各拍一張（空白畫布四張卡、預告片設定面板、成品面板、聲音區、新增面板）。
// 拍完存在測試自己的路徑；有設 SVS_SCREENSHOT_DIR 就用 SVS_SHOT_PREFIX（例如 before／after）加在檔名前面另存一份。
// 平常跑整套時不設環境變數，只是多拍幾張圖、不比對內容。

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name)
  await page.screenshot({ path })
  const dir = process.env.SVS_SCREENSHOT_DIR
  if (dir) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(path, join(dir, `${process.env.SVS_SHOT_PREFIX ?? ''}${name}`))
  }
}

test.describe('文案截圖（改前改後對照）', () => {
  test.describe.configure({ timeout: 240_000 })

  test('空白畫布四張卡、預告片設定面板、成品面板', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await page.getByTestId('canvas-empty').evaluate((el) => {
      el.scrollTop = 0
    })
    await shoot(page, testInfo, '01-empty-canvas-four-cards.png')

    await page.getByTestId('trailer-text').fill(STORY)
    await page.getByTestId('trailer-title').fill('斷橋')
    await page.getByTestId('trailer-go').click()
    await expect(page.getByTestId('trailer-badge')).toHaveText('預告片 30／30 秒', {
      timeout: 30_000,
    })
    await page.getByRole('button', { name: '全部顯示' }).click()
    await shoot(page, testInfo, '02-trailer-script-written.png')

    await page.getByTestId('trailer-badge').click()
    await expect(page.getByTestId('trailer-panel')).toBeVisible()
    await shoot(page, testInfo, '03-trailer-panel.png')
    // 改成 15 秒：13 格塞進 15 秒，旁白念不完的提醒會出現
    await pick(page, 'trailer-panel-length', '15')
    await expect(page.getByTestId('trailer-badge')).toHaveText('預告片 15／15 秒')
    await shoot(page, testInfo, '04-trailer-panel-15s-reminder.png')
    await page.getByTestId('trailer-rewrite').click()
    await expect(page.getByTestId('trailer-rewrite-confirm')).toBeVisible()
    await shoot(page, testInfo, '05-trailer-rewrite-confirm.png')
    await page.keyboard.press('Escape')

    await page.getByTestId('run-all').click()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('run-all')).toHaveText('全部都生成好了', { timeout: 120_000 })
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-length')).toBeVisible({ timeout: 30_000 })
    await shoot(page, testInfo, '06-final-cut-panel.png')
    await page.getByTestId('sound-panel').scrollIntoViewIfNeeded()
    await shoot(page, testInfo, '07-sound-area-trailer.png')
  })

  test('聲音區（一般專案）：還沒有聲音、做好之後；新增面板', async ({ page }, testInfo) => {
    await generateAndOpenCanvas(page)
    await shoot(page, testInfo, '08-add-panel-and-topbar.png')
    await page.getByTestId('palette-close').click()
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-panel')).toBeVisible()
    await page.getByTestId('sound-panel').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('sound-add')).toBeVisible()
    await shoot(page, testInfo, '09-sound-area-empty.png')
    await page.getByTestId('sound-add').click()
    await expect(page.getByTestId('sound-add-confirm')).toBeVisible()
    await shoot(page, testInfo, '10-sound-add-confirm.png')
    await page.getByTestId('sound-add-go').click()
    await expect(page.getByTestId('sound-mixer')).toBeVisible({ timeout: 60_000 })
    await page.getByTestId('sound-panel').scrollIntoViewIfNeeded()
    await shoot(page, testInfo, '11-sound-area-mixer.png')
  })
})
