import { generateAndOpenCanvas, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'

test.describe('專案頁', () => {
  test('還沒有專案時說明怎麼開始；開新專案回到空的畫布；之前的專案在清單裡，打開就回來', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '專案', exact: true }).click()
    await expect(page.getByRole('button', { name: '專案', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByTestId('project-none')).toBeVisible()

    // 用一句話做一支短片（會自動建專案），再回到專案頁：它就是現在開著的
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    await page.getByRole('button', { name: '專案', exact: true }).click()
    await expect(page.getByTestId('project-current')).toBeVisible()
    await expect(page.getByTestId('project-others-empty')).toBeVisible()

    // 開新專案：回到畫布，是空的
    await page.getByTestId('project-new').click()
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await expect(page.getByTestId('project-name')).toHaveText('我的短片')

    // 之前那個在「其他專案」，打開就回到它的畫布
    await page.getByRole('button', { name: '專案', exact: true }).click()
    await expect(page.getByTestId('project-item')).toHaveCount(1)
    await page.getByTestId('project-open').click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
  })
})
