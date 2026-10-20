import { canvasNodes, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

test.describe('畫布：走查二的小修', () => {
  test('滑過說明：鏡頭標題說鏡頭號是自動編的、「整理」說它做什麼；一句話的說明寫了會花錢', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const shot = (await canvasNodes(page)).find((n) => n.data.kind === 'shot')
    if (!shot) throw new Error('沒有鏡頭')
    // 側欄的一句話：先說會花錢
    await expect(page.getByTestId('palette-oneliner')).toContainText('會花錢，按之前先給預估')

    // 上方列的「整理」
    await page.getByTestId('tidy').hover()
    await expect(page.getByTestId('hover-tip')).toContainText('排回自動排好的位置')

    // 鏡頭標題
    const title = page.locator(`.react-flow__node[data-id="${shot.id}"] b`).first()
    await title.hover()
    await expect(page.getByTestId('hover-tip')).toHaveText('鏡頭號是自動編的；雙擊打開設定')
  })

  test('接點說明不重複：圖片的參考點寫「參考圖」，不是「參考・參考」', async ({ page }) => {
    await generateAndOpenCanvas(page)
    const image = (await canvasNodes(page)).find((n) => n.data.kind === 'image')
    if (!image) throw new Error('沒有圖')
    const labels = await page
      .locator(`.react-flow__node[data-id="${image.id}"] .port-label`)
      .allTextContents()
    expect(labels.some((text) => text.includes('參考'))).toBe(true)
    expect(labels.filter((text) => text.includes('參考・參考'))).toEqual([])
  })
})
