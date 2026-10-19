import { expect, test } from './fixtures'

test.describe('「？」選單', () => {
  test('鍵盤快捷鍵：列出 Ctrl+Z、Ctrl+C 等，按「知道了」關掉', async ({ page }) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await page.getByTestId('help-menu').click()
    await page.getByRole('menuitem', { name: '鍵盤快捷鍵' }).click()
    const dialog = page.getByTestId('shortcuts-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Ctrl+Z')
    await expect(dialog).toContainText('Mac 上把 Ctrl 換成 Cmd')
    await dialog.getByRole('button', { name: '知道了' }).click()
    await expect(dialog).toBeHidden()
  })
})
