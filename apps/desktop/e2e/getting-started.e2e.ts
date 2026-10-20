import { expect, test } from './fixtures'

test.describe('「？」選單：怎麼開始', () => {
  test('列出三個步驟，第二步的名字跟空白畫布三張卡的標題一樣；按「知道了」關掉', async ({
    page,
  }) => {
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    // 空白畫布上的三張卡
    const cards = page.getByTestId('canvas-empty')
    for (const title of ['自己一步一步來', '貼一段故事', '一句話']) {
      await expect(cards.getByRole('heading', { name: title })).toBeVisible()
    }

    await page.getByTestId('help-menu').click()
    await page.getByRole('menuitem', { name: '怎麼開始' }).click()
    const dialog = page.getByTestId('getting-started-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('getting-started-step')).toHaveCount(3)
    for (const title of ['自己一步一步來', '貼一段故事', '一句話']) {
      await expect(dialog).toContainText(title)
    }
    await dialog.getByRole('button', { name: '知道了' }).click()
    await expect(dialog).toBeHidden()

    // 「？」選單裡其他項目還在
    await page.getByTestId('help-menu').click()
    await expect(page.getByRole('menuitem', { name: '鍵盤快捷鍵' })).toBeVisible()
  })
})
