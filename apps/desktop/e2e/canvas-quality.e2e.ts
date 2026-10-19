import type { Page } from '@playwright/test'

import { canvasNodes, centerOn, generateAndOpenCanvas, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'

/** 確認面板上的預估花費（數字）。 */
async function costOf(page: Page): Promise<number> {
  const text = (await page.getByTestId('run-confirm').textContent()) ?? ''
  const match = /US\$([\d.]+)/.exec(text)
  if (!match?.[1]) throw new Error(`面板上沒有花費：${text}`)
  return Number(match[1])
}

test.describe('生成鈕旁的品質：高品質／平衡／經濟', () => {
  test('換品質：用的模型與預估花費馬上跟著變；「全部生成」的估價也照這個等級', async ({ page }) => {
    await generateAndOpenCanvas(page)
    // 關掉示範模式、填 fal.ai 的金鑰：才有分等級的模型（示範模式只有一組示範模型）
    await page.evaluate(async () => {
      await window.svs.invoke('keys.set', { provider: 'fal', key: 'fal-e2e-quality-0123456789' })
      await window.svs.invoke('settings.update', { demoMode: false })
    })
    const added = await page.evaluate(() => window.svs.invoke('canvas.add', { kind: 'shot' }))
    if (!added.ok) throw new Error(added.error.userMessage)
    await expect.poll(() => kindCount(page, 'shot')).toBe(4)
    const video = `${added.data.key}:video`
    await centerOn(page, video)
    await page.getByTestId(`run-${video}`).click()
    const dialog = page.getByTestId('run-confirm')
    await expect(dialog).toContainText('Kling 3.0 Standard')
    await expect(page.getByTestId('quality-default')).toHaveAttribute('aria-checked', 'true')
    const balanced = await costOf(page)

    await page.getByTestId('quality-premium').click()
    await expect(dialog).toContainText('Kling 3.0 Pro')
    await expect(page.getByTestId('quality-premium')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => costOf(page)).toBeGreaterThan(balanced)

    await page.getByTestId('quality-balanced').click()
    await expect(dialog).toContainText('Kling 3.0 Standard')
    await expect.poll(() => costOf(page)).toBe(balanced)

    // 選了高品質再關掉：上方列「全部生成」的估價也照高品質算
    await page.getByTestId('quality-premium').click()
    await expect(dialog).toContainText('Kling 3.0 Pro')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    const premium = /US\$([\d.]+)/
    await expect
      .poll(async () =>
        Number(premium.exec((await page.getByTestId('run-all').textContent()) ?? '')?.[1]),
      )
      .toBeGreaterThan(balanced)
    // 下一次按 ▶ 沿用高品質
    await page.getByTestId(`run-${video}`).click()
    await expect(page.getByTestId('quality-premium')).toHaveAttribute('aria-checked', 'true')
    expect((await canvasNodes(page)).some((n) => n.id === video)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // 面板的「試跑」也有同一個切換（跟畫布上的共用）
    await page.getByTestId(`open-${video}`).click()
    await page.getByTestId('canvas-panel-tab-trial').click()
    await expect(page.getByTestId('quality-premium')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('trial-steps')).toContainText('Kling 3.0 Pro')
    await page.getByTestId('quality-default').click()
    await expect(page.getByTestId('trial-steps')).toContainText('Kling 3.0 Standard')
    await expect(page.getByTestId('trial-cost')).toContainText(`US$${balanced.toFixed(2)}`)
  })
})
