import { canvasNodes, centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

test.describe('節點的耗時與重做（示範模式）', () => {
  test('一句話長完後：圖與影片節點底下有耗時與多久前；按 ▶ 重做要先確認，確定後生成紀錄多出新的一筆', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const video = (await canvasNodes(page)).find((n) => n.data.kind === 'video')
    if (!video) throw new Error('沒有影片節點')
    const image = video.id.replace(/:video$/, ':image')

    // 節點底下：耗時・多久前
    await centerOn(page, image)
    for (const id of [image, video.id]) {
      const usage = page.getByTestId(`node-${id}`).getByTestId('node-usage')
      await expect(usage).toContainText('秒')
      await expect(usage).toContainText('剛剛')
    }

    await page.getByRole('button', { name: '生成紀錄' }).click()
    await expect(page.getByTestId('record').first()).toBeVisible()
    const before = await page.getByTestId('record').count()

    // 回到畫布：先確認（取消不會動），再確定
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await centerOn(page, video.id)
    await page.getByTestId(`run-${video.id}`).click()
    await expect(page.getByTestId('run-confirm')).toContainText('重做')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('run-confirm')).toHaveCount(0)
    await page.getByTestId(`run-${video.id}`).click()
    await page.getByTestId('run-confirm-ok').click()

    await page.getByRole('button', { name: '生成紀錄' }).click()
    await expect
      .poll(async () => page.getByTestId('record').count(), { timeout: 60_000 })
      .toBeGreaterThan(before)
  })
})
