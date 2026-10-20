import type { Page } from '@playwright/test'

import { expect, test } from './fixtures'
import { pick } from './pick'

/** 工作區的焦點離開輸入框（Cmd/Ctrl+Z 才會是「復原整個動作」，而不是輸入框自己的文字復原）。 */
async function clickAway(page: Page): Promise<void> {
  await page.getByRole('heading', { level: 1 }).click()
}

test.describe('復原與重做', () => {
  test('大綱：Ctrl+Z 復原新增與刪除，重做回來；提示上有「重做」，按鈕與快捷鍵一致', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '大綱' }).click()
    await expect(page.getByTestId('history-undo')).toBeDisabled()

    await page.getByTestId('act-add').click()
    await expect(page.getByTestId('act-card')).toHaveCount(1)
    await expect(page.getByTestId('history-undo')).toBeEnabled()
    await expect(page.getByTestId('history-undo')).toHaveAttribute('aria-label', '復原：新增一幕')

    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByTestId('act-card')).toHaveCount(0)
    await expect(page.getByTestId('toast').last()).toContainText('已復原：新增一幕')
    await expect(page.getByTestId('history-redo')).toBeEnabled()

    // 提示上的「重做」
    await page.getByTestId('toast-action').last().click()
    await expect(page.getByTestId('act-card')).toHaveCount(1)

    // 加一個場、改名，再刪掉那一幕：一路復原回來
    // 新的一幕本來就有一個場，再加一個就是兩個
    await page.getByTestId('act-add-scene').click()
    await expect(page.getByTestId('scene-card')).toHaveCount(2)
    const secondTitle = page.getByTestId('scene-title').nth(1)
    await secondTitle.fill('街角')
    await clickAway(page)
    await expect(page.getByTestId('history-undo')).toHaveAttribute('aria-label', '復原：修改這個場')
    await page.getByTestId('act-delete').click()
    await page.getByTestId('act-delete-confirm').click()
    await expect(page.getByTestId('act-card')).toHaveCount(0)

    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByTestId('act-card')).toHaveCount(1)
    await expect(secondTitle).toHaveValue('街角')

    // 再復原一次：場名回到沒改之前，重做後又改回來（Ctrl+Shift+Z）
    await page.keyboard.press('ControlOrMeta+z')
    await expect(secondTitle).not.toHaveValue('街角')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(secondTitle).toHaveValue('街角')
  })

  test('輸入框裡剛打的字用輸入框自己的復原；存好離開之後 Ctrl+Z 才復原整個動作', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '大綱' }).click()
    await page.getByTestId('act-add').click()
    await expect(page.getByTestId('act-card')).toHaveCount(1)
    const title = page.getByTestId('act-title')
    const original = await title.inputValue()
    await title.fill('序幕')
    // 還在輸入框裡：交給輸入框自己的復原（只退回剛打的字），大綱沒有被復原
    await page.keyboard.press('ControlOrMeta+z')
    await expect(title).toHaveValue(original)
    await expect(page.getByTestId('act-card')).toHaveCount(1)
    await expect(page.getByTestId('history-undo')).toHaveAttribute('aria-label', '復原：新增一幕')

    // 存好離開輸入框之後，Ctrl+Z 才是復原整個動作
    await title.fill('序幕')
    await clickAway(page)
    await expect(page.getByTestId('history-undo')).toHaveAttribute('aria-label', '復原：修改這一幕')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(title).toHaveValue(original)
  })

  test('分鏡表：刪除鏡頭後復原，鏡頭與順序都回來；改欄位也能復原', async ({ page }) => {
    await page.getByRole('button', { name: '分鏡表' }).click()
    await page.getByTestId('storyboard-add').click()
    await expect(page.getByTestId('shot-row')).toHaveCount(1)
    await page.getByTestId('storyboard-add').click()
    await expect(page.getByTestId('shot-row')).toHaveCount(2)

    const description = page.getByTestId('cell-description').first()
    const before = await description.inputValue()
    await description.fill('一隻貓走過雨夜')
    await description.blur()
    await expect(page.getByTestId('history-undo')).toHaveAttribute(
      'aria-label',
      '復原：修改鏡頭的畫面描述',
    )
    await clickAway(page)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(description).toHaveValue(before)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(description).toHaveValue('一隻貓走過雨夜')

    // 刪除第一個鏡頭
    await page.getByTestId('row-select').first().check()
    await page.getByTestId('storyboard-delete').click()
    await page.getByTestId('storyboard-delete-confirm').click()
    await expect(page.getByTestId('shot-row')).toHaveCount(1)
    await expect(page.getByTestId('toast')).toHaveCount(0)

    await page.getByTestId('history-undo').click()
    await expect(page.getByTestId('shot-row')).toHaveCount(2)
    await expect(page.getByTestId('toast').last()).toContainText('已復原：刪除鏡頭')
    await expect(page.getByTestId('cell-description').first()).toHaveValue('一隻貓走過雨夜')
    await expect(page.getByTestId('shot-row').first()).toHaveAttribute('data-number', '1')
  })

  test('換頁不會丟掉歷史（按鈕狀態跟著目前專案）', async ({ page }) => {
    await page.getByRole('button', { name: '大綱' }).click()
    await page.getByTestId('act-add').click()
    await expect(page.getByTestId('history-undo')).toBeEnabled()
    await page.getByRole('button', { name: '檔案' }).click()
    await page.getByRole('button', { name: '大綱' }).click()
    // 換頁不會丟掉歷史
    await expect(page.getByTestId('history-undo')).toBeEnabled()
  })
})

test.describe('Esc 與對話框的鍵盤操作', () => {
  test('畫布一句話的確認面板：焦點在「確認」；Esc 關閉、不會開始生成；焦點回到「先產生分鏡」', async ({
    page,
  }) => {
    await page.getByTestId('empty-add-oneliner').click()
    await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
    await page.getByTestId('oneliner-story').blur()
    await pick(page, 'oneliner-shots', '3')
    await page.getByTestId('oneliner-storyboard').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toBeVisible()
    await expect(page.getByTestId('run-confirm-ok')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    // 沒有開始生成
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false')
    await expect(page.getByTestId('run-progress')).toHaveCount(0)
    await expect(page.getByTestId('oneliner-storyboard')).toBeFocused()
  })

  test('「確定刪除這一幕？」按 Esc 等於不刪；側面板也還在', async ({ page }) => {
    await page.getByRole('button', { name: '大綱' }).click()
    await page.getByTestId('act-add').click()
    await page.getByTestId('act-delete').click()
    await expect(page.getByTestId('act-delete-confirm')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('act-delete-confirm')).toHaveCount(0)
    await expect(page.getByTestId('act-card')).toHaveCount(1)
  })
})
