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
    await expect(page.getByTestId('new-project-dialog')).toBeVisible()
    await expect(page.getByTestId('new-project-name')).toHaveValue('我的短片')
    await page.getByTestId('new-project-create').click()
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await expect(page.getByTestId('project-name')).toHaveText('我的短片')

    // 之前那個在「其他專案」，打開就回到它的畫布
    await page.getByRole('button', { name: '專案', exact: true }).click()
    await expect(page.getByTestId('project-item')).toHaveCount(1)
    await page.getByTestId('project-open').click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
  })

  test('每一頁最上面的專案列：名字、已自動儲存的時間、模式、花費；點名字改名；選單一點就到最近的專案', async ({
    page,
  }) => {
    // 還沒有專案：寫「未命名專案」，沒有存檔狀態
    await expect(page.getByTestId('project-bar')).toBeVisible()
    await expect(page.getByTestId('project-name')).toHaveText('未命名專案')
    await expect(page.getByTestId('save-status')).toHaveCount(0)
    await expect(page.getByTestId('mode-badge')).toBeVisible()

    // 做一點事，專案就建好了；到別的頁，這一列還在
    await generateAndOpenCanvas(page)
    await expect(page.getByTestId('save-status')).toHaveText(/^已自動儲存・\d{2}:\d{2}$/)
    await expect(page.getByTestId('spent')).toHaveText(/^已花 US\$\d+\.\d{2}$/)
    await page.getByRole('button', { name: '設定', exact: true }).click()
    await expect(page.getByTestId('project-bar')).toBeVisible()
    await expect(page.getByTestId('save-status')).toBeVisible()
    await page.getByRole('button', { name: '畫布', exact: true }).click()

    // 點名字改名；專案頁上也是新名字
    await page.getByTestId('project-name').click()
    await page.getByTestId('project-rename').fill('雨夜的貓')
    await page.getByTestId('project-rename').press('Enter')
    await expect(page.getByTestId('project-name')).toHaveText('雨夜的貓')
    await page.getByRole('button', { name: '專案', exact: true }).click()
    await expect(page.getByTestId('project-current')).toContainText('雨夜的貓')

    // 專案選單：新專案；再打開選單，剛才那個在「最近的專案」，一點就開
    await page.getByTestId('project-menu-button').click()
    await page.getByTestId('menu-new').click()
    // 只問名字：改成自己的名字，Enter 就建；存放位置是預設的專案資料夾
    await expect(page.getByTestId('new-project-folder')).toContainText('存在：')
    await page.getByTestId('new-project-name').fill('雨夜的狗')
    await page.getByTestId('new-project-name').press('Enter')
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await expect(page.getByTestId('project-name')).toHaveText('雨夜的狗')
    await page.getByTestId('project-menu-button').click()
    await expect(page.getByTestId('menu-recent')).toHaveText(['雨夜的貓'])
    await page.getByTestId('menu-recent').click()
    await expect(page.getByTestId('project-name')).toHaveText('雨夜的貓')
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
  })
})
