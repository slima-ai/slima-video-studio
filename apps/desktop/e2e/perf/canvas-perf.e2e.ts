import { canvasNodes, centerOn } from '../canvas-helpers'
import { expect, test } from '../fixtures'

// 量 fps 的測試要獨佔 CPU：playwright.config 的 perf 專案等其他測試都跑完才跑，一次一個
test.describe('效能自測', () => {
  test('效能自測：產生 250 鏡示範專案，畫布上 750 格以上；量讀取時間、自動平移 fps', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await page.getByTestId('help-menu').click()
    await page.getByRole('menuitem', { name: /效能自測/ }).click()
    const overlay = page.getByTestId('perf-overlay')
    await expect(overlay).toBeVisible()
    // 現在每秒幾格會一直更新
    await expect(page.getByTestId('perf-fps')).not.toHaveText('0 格')

    // 產生前要先確認（會開新的專案）
    await page.getByTestId('perf-seed').click()
    await expect(page.getByTestId('perf-seed-confirm')).toContainText('現在的專案會留著')
    await page.getByTestId('perf-seed-ok').click()
    await expect(page.getByTestId('perf-message')).toContainText('250 個鏡頭', {
      timeout: 120_000,
    })
    await expect(page.getByTestId('project-name')).toHaveText('效能測試（250 鏡）')
    await expect
      .poll(async () => (await canvasNodes(page)).filter((n) => n.data.kind === 'shot').length)
      .toBe(250)
    // 每鏡有鏡頭、第一張畫面、影片三格，再加場、角色、地點與剪輯
    expect((await canvasNodes(page)).length).toBeGreaterThan(750)
    await expect(page.getByTestId('perf-counts')).toHaveText(/^\d{3,} 格、\d{3,} 條線$/)

    // 全部顯示時縮到最小：只畫色塊，省掉看不到的東西（平移才順）
    const root = page.getByTestId('canvas-root')
    await expect(root).toHaveAttribute('data-many', 'true')
    await expect(root).toHaveAttribute('data-lod', 'low')
    await expect(root.locator('.react-flow__background')).toHaveCount(0)
    await expect(root.locator('.react-flow__node video')).toHaveCount(0)
    // 格子很多時只畫主線：沒選取時，角色、地點的參考線一條都不畫
    await expect(root.locator('.svs-edge-ref')).toHaveCount(0)
    await expect(root.locator('.svs-edge-flow').first()).toBeAttached()

    await page.getByTestId('perf-measure-load').click()
    await expect(page.getByTestId('perf-load')).toHaveText(/^\d+ 毫秒$/)

    await page.getByTestId('perf-pan').click()
    const result = page.getByTestId('perf-pan-result')
    await expect(result).toBeVisible({ timeout: 15_000 })
    // 雲端沒有顯示卡（軟體繪圖）：15 fps 是回歸警戒線（uiux-spec §12.13）；
    // 50 fps 的目標要在有顯示卡的電腦上用這個選單看
    const fps = Number(/平移平均 ([\d.]+) fps/.exec((await result.textContent()) ?? '')?.[1])
    expect(fps).toBeGreaterThanOrEqual(15)
    await expect(result).toContainText('最慢一格')

    // 選了角色：它的參考線才畫出來
    const hero = (await canvasNodes(page)).find((n) => n.data.kind === 'character')
    if (!hero) throw new Error('沒有角色')
    await centerOn(page, hero.id)
    await expect(root.locator('.react-flow__background')).toHaveCount(1)
    await page.getByTestId(`node-${hero.id}`).click({ position: { x: 60, y: 14 } })
    await expect(root.locator('.svs-edge-ref').first()).toBeAttached()

    await overlay.getByRole('button', { name: '關閉' }).click()
    await expect(overlay).toBeHidden()
  })
})
