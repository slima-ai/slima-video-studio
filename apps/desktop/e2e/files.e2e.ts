import { generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

test.describe('檔案紀錄（示範模式）', () => {
  test('一句話長完後：列出生成的圖片與影片、各自用在哪一鏡，可以篩選', async ({ page }) => {
    await page.getByRole('button', { name: '檔案' }).click()
    await expect(page.getByTestId('files-empty')).toBeVisible()

    await generateAndOpenCanvas(page)

    await page.getByRole('button', { name: '檔案' }).click()
    await expect(page.getByTestId('file').first()).toBeVisible()
    const total = await page.getByTestId('file').count()
    expect(total).toBeGreaterThanOrEqual(2)
    await expect(page.getByTestId('files-summary')).toContainText(`共 ${String(total)} 個檔案`)
    await expect(page.getByTestId('files-project-dir')).toBeVisible()

    // 只看圖片：每個都有縮圖、大小與用途（第 N 鏡・首幀圖）
    await page.getByTestId('files-filter-image').click()
    // 等篩選套用完（清單換掉之前還是全部的檔案），再一列一列看
    await expect(page.locator('[data-testid="file"]:not([data-kind="image"])')).toHaveCount(0)
    await expect(page.getByTestId('file').first()).toBeVisible()
    for (const row of await page.getByTestId('file').all()) {
      await expect(row).toHaveAttribute('data-kind', 'image')
      await expect(row.getByTestId('file-details')).toContainText('B')
      await expect(row.getByTestId('file-used-by')).toContainText(/第 [123] 鏡・第一張畫面 v1/)
      await expect(row.getByTestId('file-path')).toContainText('assets')
    }

    // 只看影片：每一鏡的影片，以及接好的成品影片
    await page.getByTestId('files-filter-video').click()
    await expect(page.locator('[data-testid="file"]:not([data-kind="video"])')).toHaveCount(0)
    await expect(page.getByTestId('file').first()).toBeVisible()
    for (const row of await page.getByTestId('file').all()) {
      await expect(row).toHaveAttribute('data-kind', 'video')
      await expect(row.getByTestId('file-used-by')).toContainText(
        /第 [123] 鏡・影片 v1|接好的成品影片/,
      )
    }

    // 剛生成完，沒有沒被使用的檔案
    await page.getByTestId('files-filter-unused').click()
    await expect(page.getByTestId('files-empty')).toBeVisible()
  })
})
