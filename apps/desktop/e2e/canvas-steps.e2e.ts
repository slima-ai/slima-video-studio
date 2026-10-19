import type { Page } from '@playwright/test'

import { canvasNodes, centerOn, generateAndOpenCanvas, viewportSettled } from './canvas-helpers'
import { expect, test } from './fixtures'

const graphOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('canvas.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data
}
const positionOf = async (page: Page, id: string) =>
  (await canvasNodes(page)).find((n) => n.id === id)?.position

test.describe('畫布：鏡頭的「展開步驟」', () => {
  test('展開一鏡：鏡頭下面多三格，下面的鏡頭往下讓開；收合回到原位', async ({ page }) => {
    await generateAndOpenCanvas(page)
    const shots = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    const [first, second] = shots
    if (!first || !second) throw new Error('鏡頭不夠')
    const before = await positionOf(page, second.id)
    await centerOn(page, first.id)
    await page.getByTestId(`steps-toggle-${first.id}`).click()
    // 畫布只畫看得到的格子；視窗內容區比較矮時（macOS 的標題列佔掉一截），第三格會掉到畫面外，
    // 所以把畫面移到中間那格，三格都在畫面內
    await centerOn(page, `${first.id}:step:refs`)

    for (const stage of ['prompt', 'refs', 'model']) {
      await expect(page.getByTestId(`node-${first.id}:step:${stage}`)).toBeVisible()
    }
    await expect(page.getByTestId(`steps-toggle-${first.id}`)).toHaveText(/收合步驟/)
    await expect
      .poll(async () => (await positionOf(page, second.id))?.y ?? 0)
      .toBeGreaterThan((before?.y ?? 0) + 200)
    await expect(page.getByTestId(`step-model-${first.id}`)).toContainText('示範圖片')
    // 每一段線都畫出來了（鏡頭 → 整理 Prompt → 挑參考圖 → 送出模型 → 第一張畫面）
    for (const [from, to] of [
      [first.id, `${first.id}:step:prompt`],
      [`${first.id}:step:prompt`, `${first.id}:step:refs`],
      [`${first.id}:step:refs`, `${first.id}:step:model`],
      [`${first.id}:step:model`, `${first.id}:image`],
    ] as const) {
      await expect(
        page.locator(`.react-flow__edge[data-id^="${from}:"][data-id*="->${to}:"] path`).first(),
      ).toHaveAttribute('d', /\d/)
    }

    await page.getByTestId(`steps-toggle-${first.id}`).click()
    await expect(page.getByTestId(`node-${first.id}:step:prompt`)).toHaveCount(0)
    await expect.poll(async () => (await positionOf(page, second.id))?.y).toBe(before?.y)
  })

  test('在「整理 Prompt」直接改送給模型的 Prompt：第一張畫面標需要重跑；可以回到自動整理的', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const [first] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!first) throw new Error('沒有鏡頭')
    await centerOn(page, first.id)
    await page.getByTestId(`steps-toggle-${first.id}`).click()
    const box = page.getByTestId(`step-prompt-${first.id}`)
    await expect(box).toBeVisible()
    await viewportSettled(page)
    await box.fill('一隻橘貓坐在窗台上，窗外下著雨，暖色燈光')
    await box.blur()
    await expect(
      page.getByTestId('toast').filter({ hasText: '已改送給模型的 Prompt' }),
    ).toBeVisible()
    await expect
      .poll(
        async () => (await graphOf(page)).nodes.find((n) => n.key === `${first.id}:image`)?.status,
      )
      .toBe('stale')
    await expect(page.getByTestId(`node-${first.id}:step:prompt`)).toContainText('你改過了')

    await page.getByTestId(`step-prompt-reset-${first.id}`).click()
    await expect(page.getByTestId(`node-${first.id}:step:prompt`)).toContainText('自動整理的')
    await expect
      .poll(
        async () => (await graphOf(page)).nodes.find((n) => n.key === `${first.id}:image`)?.status,
      )
      .toBe('done')
  })

  test('上方列「全部展開步驟」：每一鏡都展開；再按一次全部收合', async ({ page }) => {
    await generateAndOpenCanvas(page)
    const toggle = page.getByTestId('steps-all')
    await expect(toggle).toHaveText('全部展開步驟')
    await toggle.click()
    await expect
      .poll(async () => (await canvasNodes(page)).filter((n) => n.data.kind === 'step').length)
      .toBe(9)
    await expect(toggle).toHaveText('全部收合步驟')
    await toggle.click()
    await expect
      .poll(async () => (await canvasNodes(page)).filter((n) => n.data.kind === 'step').length)
      .toBe(0)
  })
})
