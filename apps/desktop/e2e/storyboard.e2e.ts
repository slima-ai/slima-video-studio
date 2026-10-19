import { launchApp } from './launch'
import { expect, test } from './fixtures'

import type { Page } from '@playwright/test'

/** 先在大綱新增一幕（附一個場）。 */
async function withScene(page: Page): Promise<void> {
  await page.getByRole('button', { name: '大綱' }).click()
  await page.getByTestId('act-add').click()
  await expect(page.getByTestId('scene-card')).toHaveCount(1)
  await page.getByTestId('scene-title').fill('街角')
  await page.getByTestId('scene-title').blur()
  await page.getByRole('button', { name: '分鏡表' }).click()
}

/**
 * 拖拉是不是已經真的把第一個項目和它的下一個項目互相讓開。剛拿起來時被拖的項目就已經有
 * translate(0, 0)，所以不能只看「有沒有 transform」；要等被讓開的第二個項目也開始位移，
 * 代表 dnd-kit 已經算出「要放在哪裡」，這時放手才不會落空。
 */
async function hasMoved(page: Page, testId: string): Promise<boolean> {
  const transforms = await page
    .getByTestId(testId)
    .evaluateAll((els) => els.slice(0, 2).map((el) => (el as HTMLElement).style.transform))
  return (
    transforms.length === 2 &&
    transforms.every((transform) => {
      const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(transform)
      return match !== null && (Number(match[1]) !== 0 || Number(match[2]) !== 0)
    })
  )
}

/**
 * 拿起之後按方向鍵移動一格，直到看到真的移動了。dnd-kit 在拿起後的下一個瞬間才開始聽方向鍵，
 * 太早按的那一下會被吞掉；沒有移動就再按一次（已經移動了就不會重複按）。
 */
async function nudge(page: Page, key: string, testId: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.keyboard.press(key)
    try {
      await expect.poll(() => hasMoved(page, testId), { timeout: 1500 }).toBe(true)
      return
    } catch {
      // 沒有移動：這一下被吞掉了，再按一次
    }
  }
  await expect.poll(() => hasMoved(page, testId)).toBe(true)
}

test.describe('分鏡表', () => {
  test('沒有場時引導去大綱；新增鏡頭、改欄位、重開 App 後還在', async ({
    page,
    app,
    userDataDir,
  }) => {
    await page.getByRole('button', { name: '分鏡表' }).click()
    await expect(page.getByTestId('storyboard-empty')).toBeVisible()
    await expect(page.getByTestId('storyboard-no-scenes')).toBeVisible()

    await page.getByTestId('storyboard-add').click()
    await expect(page.getByTestId('shot-row')).toHaveCount(1)
    const row = page.getByTestId('shot-row').first()
    await row.getByTestId('cell-description').fill('阿鐵走進雨裡')
    await row.getByTestId('cell-description').press('Enter')
    await row.getByTestId('cell-size').selectOption({ label: '近景' })
    await row.getByTestId('cell-angle').selectOption({ label: '側面' })
    await row.getByTestId('cell-camera').selectOption({ label: '推近' })
    await row.getByTestId('cell-characters').fill('阿鐵、小花')
    await row.getByTestId('cell-characters').blur()
    await row.getByTestId('cell-lighting').fill('昏黃路燈')
    await row.getByTestId('cell-lighting').blur()
    await row.getByTestId('cell-time').fill('深夜')
    await row.getByTestId('cell-time').blur()
    await row.getByTestId('cell-duration').fill('5')
    await row.getByTestId('cell-duration').blur()

    // 資料真的存進專案：離開再回來
    await page.getByRole('button', { name: '大綱' }).click()
    await page.getByRole('button', { name: '分鏡表' }).click()
    await expect(page.getByTestId('cell-description')).toHaveValue('阿鐵走進雨裡')

    await app.close()
    const again = await launchApp({ userDataDir })
    try {
      const next = await again.app.firstWindow()
      await next.waitForLoadState('domcontentloaded')
      await next.getByRole('button', { name: '分鏡表' }).click()
      const saved = next.getByTestId('shot-row').first()
      await expect(saved.getByTestId('cell-description')).toHaveValue('阿鐵走進雨裡')
      await expect(saved.getByTestId('cell-size')).toHaveValue('close_up')
      await expect(saved.getByTestId('cell-angle')).toHaveValue('side')
      await expect(saved.getByTestId('cell-camera')).toHaveValue('push_in')
      await expect(saved.getByTestId('cell-characters')).toHaveValue('阿鐵、小花')
      await expect(saved.getByTestId('cell-lighting')).toHaveValue('昏黃路燈')
      await expect(saved.getByTestId('cell-time')).toHaveValue('深夜')
      await expect(saved.getByTestId('cell-duration')).toHaveValue('5')
    } finally {
      await again.app.close().catch(() => undefined)
    }
  })

  test('鍵盤：Enter 跳到下一列同一欄；用鍵盤拖拉調整順序，鏡號跟著重排', async ({ page }) => {
    await page.getByRole('button', { name: '分鏡表' }).click()
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('storyboard-add').click()
      await expect(page.getByTestId('shot-row')).toHaveCount(i + 1)
    }
    const descriptions = page.getByTestId('cell-description')
    await descriptions.nth(0).fill('甲')
    await descriptions.nth(0).press('Enter')
    // Enter 存好並跳到下一列同一欄，直接用鍵盤接著打
    await expect(descriptions.nth(1)).toBeFocused()
    await page.keyboard.type('乙')
    await page.keyboard.press('Enter')
    await expect(descriptions.nth(2)).toBeFocused()
    await page.keyboard.type('丙')
    await page.keyboard.press('Enter')
    await expect(descriptions.nth(0)).toHaveValue('甲')
    await expect(descriptions.nth(2)).toHaveValue('丙')

    // 把第一列（甲）往下移一格：鍵盤焦點在把手上 → 空白鍵拿起 → 方向鍵 → 空白鍵放下
    const handle = page.getByTestId('row-handle').first()
    await handle.focus()
    await page.keyboard.press('Space')
    // 拿起來之後 dnd-kit 才開始聽方向鍵，要等它進入拖拉狀態
    await expect(handle).toHaveAttribute('aria-pressed', 'true')
    // 第一列已經被推到下面（有位移）才放下
    await nudge(page, 'ArrowDown', 'shot-row')
    await page.keyboard.press('Space')
    await expect(descriptions.nth(0)).toHaveValue('乙')
    await expect(descriptions.nth(1)).toHaveValue('甲')
    await expect(page.getByTestId('shot-row').nth(1)).toHaveAttribute('data-number', '2')
  })

  test('故事板：卡片顯示縮圖；在卡片改的內容表格同步，勾選與順序兩邊一致', async ({ page }) => {
    await page.getByRole('button', { name: '分鏡表' }).click()
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('storyboard-add').click()
      await expect(page.getByTestId('shot-row')).toHaveCount(i + 1)
    }
    await page.getByTestId('cell-description').nth(0).fill('甲')
    await page.getByTestId('cell-description').nth(0).blur()
    await page.getByTestId('row-select').nth(0).check()

    await page.getByTestId('storyboard-view-board').click()
    await expect(page.getByTestId('board-card')).toHaveCount(3)
    await expect(page.getByTestId('board-select').nth(0)).toBeChecked()
    await expect(page.getByTestId('board-description').nth(0)).toHaveValue('甲')

    // 在卡片上改，回表格就看到
    await page.getByTestId('board-description').nth(1).fill('乙')
    await page.getByTestId('board-description').nth(1).blur()
    await page.getByTestId('cell-board-size').nth(1).selectOption({ label: '特寫' })

    // 在卡片上生成第 3 鏡（示範模式）：縮圖出現在卡片上
    await page.getByTestId('board-select').nth(2).check()
    await page.getByTestId('storyboard-generate').click()
    await page.getByTestId('storyboard-generate-confirm').click()
    // 兩張都生成完（畫面不再變動）再拖拉，不然縮圖跳出來會改變版面
    await expect(page.getByTestId('board-status').nth(0)).toHaveText('已完成', { timeout: 60_000 })
    await expect(page.getByTestId('board-status').nth(2)).toHaveText('已完成', { timeout: 60_000 })
    await expect(page.getByTestId('board-card').nth(2).getByRole('img')).toBeVisible()

    // 卡片也能用鍵盤拖拉換順序
    const handle = page.getByTestId('board-handle').first()
    await handle.focus()
    await page.keyboard.press('Space')
    await expect(handle).toHaveAttribute('aria-pressed', 'true')
    // 視窗夠寬時卡片排成多欄，第二張在右邊；窄的時候排成一欄，第二張在下面
    const [first, second] = await page
      .getByTestId('board-card')
      .evaluateAll((els) => els.slice(0, 2).map((el) => el.getBoundingClientRect()))
    const sideBySide = (second?.left ?? 0) > (first?.left ?? 0)
    await nudge(page, sideBySide ? 'ArrowRight' : 'ArrowDown', 'board-card')
    await page.keyboard.press('Space')
    await expect(page.getByTestId('board-description').nth(0)).toHaveValue('乙')
    await expect(page.getByTestId('board-description').nth(1)).toHaveValue('甲')

    await page.getByTestId('storyboard-view-table').click()
    await expect(page.getByTestId('cell-description').nth(0)).toHaveValue('乙')
    await expect(page.getByTestId('cell-description').nth(1)).toHaveValue('甲')
    await expect(page.getByTestId('cell-size').nth(0)).toHaveValue('extreme_close_up')
    await expect(page.getByTestId('row-select').nth(1)).toBeChecked()
    await expect(page.getByTestId('shot-row').nth(0)).toHaveAttribute('data-number', '1')
  })

  test('多選：生成選取的鏡頭（示範模式）、刪除選取都要先確認', async ({ page }) => {
    await page.getByRole('button', { name: '分鏡表' }).click()
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('storyboard-add').click()
      await expect(page.getByTestId('shot-row')).toHaveCount(i + 1)
    }
    await expect(page.getByTestId('storyboard-generate')).toBeDisabled()
    await page.getByTestId('row-select').nth(0).check()
    await page.getByTestId('row-select').nth(2).check()
    await page.getByTestId('storyboard-generate').click()
    await expect(page.getByTestId('storyboard-generate-confirm')).toBeVisible()
    await page.getByTestId('storyboard-generate-confirm').click()
    await expect(page.getByTestId('storyboard-notice')).toHaveText('已開始生成 2 個鏡頭。')
    const status = page.getByTestId('shot-status')
    await expect(status.nth(0)).toHaveText('已完成', { timeout: 60_000 })
    await expect(status.nth(2)).toHaveText('已完成', { timeout: 60_000 })
    await expect(status.nth(1)).toHaveText('還沒生成')

    // 全選再生成：已經生成過的預設略過，只做還沒生成的那一個；示範模式不花錢
    await page.getByTestId('row-select').nth(1).check()
    await page.getByTestId('storyboard-generate').click()
    await expect(page.getByTestId('storyboard-batch-info')).toContainText(
      '會生成 1 個鏡頭（略過 2 個已經生成過）',
    )
    await expect(page.getByTestId('storyboard-batch-info')).toContainText('示範模式，不會花錢')
    await page.getByTestId('storyboard-batch-skip').uncheck()
    await expect(page.getByTestId('storyboard-batch-info')).toContainText('會生成 3 個鏡頭')
    await page.getByTestId('storyboard-batch-cancel').click()
    await expect(page.getByTestId('storyboard-batch')).toBeHidden()
    await page.getByTestId('row-select').nth(1).uncheck()

    await page.getByTestId('storyboard-delete').click()
    await expect(page.getByTestId('shot-row')).toHaveCount(3)
    await page.getByTestId('storyboard-delete-confirm').click()
    await expect(page.getByTestId('shot-row')).toHaveCount(1)
    await expect(page.getByTestId('shot-row').first()).toHaveAttribute('data-number', '1')
  })

  test('讓 AI 拆場（示範模式）：拆出鏡頭；再拆一次要先確認會換掉', async ({ page }) => {
    await withScene(page)
    await expect(page.getByTestId('storyboard-split-cost')).toContainText('不會花錢')
    await page.getByTestId('storyboard-split-run').click()
    await expect(page.getByTestId('shot-row').first()).toBeVisible({ timeout: 30_000 })
    const first = await page.getByTestId('shot-row').first().getAttribute('data-shot-id')

    await page.getByTestId('storyboard-split-run').click()
    await expect(page.getByTestId('storyboard-split-confirm')).toContainText('這個場目前有')
    await page.getByTestId('storyboard-split-confirm-yes').click()
    await expect(page.getByTestId('storyboard-split-confirm')).toBeHidden()
    await expect
      .poll(() => page.getByTestId('shot-row').first().getAttribute('data-shot-id'))
      .not.toBe(first)
    await expect(page.getByTestId('cell-scene').first()).toHaveValue(/.+/)
  })
})
