import { generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

test.describe('生成紀錄（示範模式）', () => {
  test('一句話長完後：每次生成都有紀錄，看得到 prompt；改 prompt 重新生成會多一個新版本', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '生成紀錄' }).click()
    await expect(page.getByTestId('records-empty')).toBeVisible()

    await generateAndOpenCanvas(page)

    await page.getByRole('button', { name: '生成紀錄' }).click()
    // 拆鏡頭的文字生成，加上每個鏡頭的圖和影片（內容一樣的鏡頭會沿用，不會多花一次）
    await expect(page.getByTestId('record').first()).toBeVisible()
    const total = await page.getByTestId('record').count()
    expect(total).toBeGreaterThanOrEqual(5)
    await expect(page.getByTestId('records-summary')).toContainText(`共 ${String(total)} 筆`)

    // 只看圖片
    await page.getByTestId('records-kind-image').click()
    // 等篩選套用完（清單換掉之前還是全部的紀錄），再一列一列看
    await expect(page.locator('[data-testid="record"]:not([data-kind="image"])')).toHaveCount(0)
    await expect(page.getByTestId('record').first()).toBeVisible()
    const images = await page.getByTestId('record').count()
    expect(images).toBeGreaterThanOrEqual(2)
    for (const row of await page.getByTestId('record').all()) {
      await expect(row.getByTestId('record-status')).toHaveText('成功')
      await expect(row.getByTestId('record-target')).toHaveText(/^第 [123] 鏡$/)
      await expect(row.getByTestId('record-usage')).toContainText('秒')
      await expect(row.getByRole('img')).toBeVisible()
    }

    // 打開某一筆：看到完整 prompt，改一改重新生成
    const first = page.getByTestId('record').first()
    const label = await first.getByTestId('record-target').innerText()
    await first.getByTestId('record-toggle').click()
    await expect(first.getByTestId('record-draft')).not.toHaveValue('')
    await first.getByTestId('record-draft').fill('貓咪蜷縮在窗邊看雨，溫暖的燈光')
    await first.getByTestId('record-redo').click()
    await expect(first.getByTestId('record-confirm-note')).toContainText('舊的版本都會保留')
    await first.getByTestId('record-redo-confirm').click()
    await expect(page.getByTestId('records-notice')).toContainText(`已開始重新生成${label}`)

    // 生成完成後紀錄多一筆，prompt 就是剛剛改的那一段
    await expect(page.getByTestId('record')).toHaveCount(images + 1, { timeout: 60_000 })
    await expect(
      page.getByTestId('record-prompt').filter({ hasText: '貓咪蜷縮在窗邊看雨' }),
    ).toHaveCount(1)
  })
})
