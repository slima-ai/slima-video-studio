import { expect, test } from './fixtures'
import { pick } from './pick'

test.describe('小視窗', () => {
  test('一句話節點的下拉選單往上展開時，不伸進上方列底下：每個選項都點得到', async ({
    app,
    page,
  }) => {
    // 視窗矮到下方放不下選單：往上展開，要停在上方列（專案列＋畫布上方列）的下面
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1280, 720)
    })
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThan(740)

    await page.getByTestId('empty-add-oneliner').click()
    await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
    await page.getByTestId('oneliner-story').blur()
    await pick(page, 'oneliner-shots', '3')

    await page.getByTestId('oneliner-duration').click()
    const list = page.getByTestId('oneliner-duration-list')
    await expect(list).toBeVisible()
    const box = await list.boundingBox()
    const topbar = await page.getByTestId('canvas-topbar').boundingBox()
    if (!box || !topbar) throw new Error('量不到選單或上方列')
    expect(box.y).toBeGreaterThanOrEqual(topbar.y + topbar.height)

    // 最上面的選項也點得到，選了之後選單收起、值換成它
    await page.getByTestId('oneliner-duration-option-3').click()
    await expect(page.getByTestId('oneliner-duration')).toContainText('每鏡 3 秒')
    await expect(list).toHaveCount(0)
  })
})
