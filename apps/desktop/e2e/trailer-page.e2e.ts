import type { Page, TestInfo } from '@playwright/test'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from './fixtures'

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

/** 截圖存在 test-results；有設 SVS_SCREENSHOT_DIR 就另外複製一份到那個資料夾（用自己指定的檔名）。 */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name)
  await page.screenshot({ path })
  const dir = process.env.SVS_SCREENSHOT_DIR
  if (dir) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(path, join(dir, name))
  }
}

const statusOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('trailer.status', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data
}

const nav = (page: Page) => page.getByTestId('layout-nav').getByRole('button')

test.describe('預告片整頁：導覽、落點、腳本條、播放器（示範模式，不花錢）', () => {
  test.describe.configure({ timeout: 120_000 })

  test('寫完腳本落在「預告片」頁；腳本條的格數等於腳本的格數；點一格、方向鍵換格；導覽最前面是「預告片」', async ({
    page,
  }, testInfo) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await page.getByTestId('trailer-text').fill(STORY)
    await page.getByTestId('trailer-title').fill('斷橋')
    await page.getByTestId('trailer-go').click()

    // 1. 落在預告片頁：標題列、腳本條（整份腳本在一條上）、播放器、右邊的設定
    await expect(page.getByTestId('trailer-page')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('trailer-page-title')).toHaveText('斷橋')
    await expect(page.getByTestId('trailer-page-length')).toHaveText('30／30 秒')
    const status = await statusOf(page)
    await expect(page.locator('[data-testid^="strip-cell-"]')).toHaveCount(status.beatCount)
    await expect(page.getByTestId('strip-segment').first()).toBeVisible()
    await expect(page.getByTestId('trailer-panel-title')).toHaveValue('斷橋')
    await expect(nav(page).first()).toHaveAttribute('aria-label', '預告片')
    await expect(nav(page).first()).toHaveAttribute('aria-current', 'page')
    await shoot(page, testInfo, 'b1-01-script-written-trailer-page.png')

    // 2. 點第 2 格：選到、播放器換成那一格（還沒生成，顯示那一格的畫面描述）；← → 換格
    await page.getByTestId('strip-cell-1').click()
    await expect(page.getByTestId('strip-cell-1')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('trailer-player')).toHaveAttribute('data-source', 'beat')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('strip-cell-2')).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('strip-cell-1')).toHaveAttribute('aria-pressed', 'true')
    await shoot(page, testInfo, 'b1-02-beat-selected.png')

    // 預告片頁也有 Claude 的入口，按了抽屜滑出來
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-drawer')).toHaveAttribute('data-open', 'true')
    await page.getByTestId('chat-launcher').click()

    // 3. 到畫布、再回預告片頁：兩邊都在，畫布上的標籤還在
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('trailer-badge')).toHaveText('預告片 30／30 秒')
    await nav(page).first().click()
    await expect(page.getByTestId('trailer-page')).toBeVisible()
  })

  test('一般專案（沒有預告片設定）：導覽沒有「預告片」這一項，落點是畫布', async ({ page }) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('trailer-start')).toBeVisible()
    await expect(page.getByRole('button', { name: '預告片', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('trailer-page')).toHaveCount(0)
  })
})
