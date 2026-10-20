import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

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

test.describe('首頁（不帶 SVS_DISABLE_HOME、不跳過引導：真正的第一次開啟）', () => {
  test.use({ appEnv: { SVS_DISABLE_HOME: '', SVS_DISABLE_ONBOARDING: '' } })

  test('第一次開啟：引導之後先到首頁，建新專案進畫布；專案選單的「首頁」回得來，最近的專案找不到時標出來並可以移除', async ({
    page,
    userDataDir,
  }) => {
    await page.getByTestId('wizard-demo').click()
    await expect(page.getByTestId('home-page')).toBeVisible()
    await expect(page.getByTestId('home-new')).toBeVisible()
    await expect(page.getByTestId('home-open')).toBeVisible()
    await expect(page.getByTestId('home-recent-empty')).toBeVisible()
    // 最上面的專案列在首頁也在：還沒有專案
    await expect(page.getByTestId('project-name')).toHaveText('未命名專案')

    await page.getByTestId('home-new').click()
    await page.getByTestId('new-project-name').fill('第一支')
    await page.getByTestId('new-project-name').press('Enter')
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await expect(page.getByTestId('project-name')).toHaveText('第一支')

    await page.getByTestId('project-menu-button').click()
    await page.getByTestId('menu-new').click()
    await page.getByTestId('new-project-name').fill('第二支')
    await page.getByTestId('new-project-name').press('Enter')
    await expect(page.getByTestId('project-name')).toHaveText('第二支')

    // 從專案選單回首頁：現在開著的是第二支，最近的專案有第一支
    await page.getByTestId('project-menu-button').click()
    await page.getByTestId('menu-home').click()
    await expect(page.getByTestId('home-current')).toContainText('第二支')
    await expect(page.getByTestId('home-recent')).toHaveCount(1)
    await expect(page.getByTestId('home-recent')).toContainText('第一支')

    // 第一支的資料夾被搬走：回到首頁，它標「找不到」、不能打開，可以從清單移除
    const projects = join(userDataDir, 'projects')
    const first = readdirSync(projects).find((name) => name.startsWith('第一支-'))
    if (!first) throw new Error('找不到第一支的資料夾')
    const moved = join(userDataDir, 'moved-away')
    mkdirSync(moved)
    renameSync(join(projects, first), join(moved, first))
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await page.getByTestId('project-menu-button').click()
    await page.getByTestId('menu-home').click()
    await expect(page.getByTestId('home-recent')).toContainText('找不到')
    await expect(page.getByTestId('home-recent-open')).toHaveCount(0)
    await page.getByTestId('home-forget').click()
    await expect(page.getByTestId('home-recent-empty')).toBeVisible()

    // 先不建專案、直接進畫布；回到有專案的畫布
    await page.getByTestId('home-skip').click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await expect(page.getByTestId('project-name')).toHaveText('第二支')
  })
})
