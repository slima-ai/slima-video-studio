import { centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

test.describe('成品的聲音（示範模式）', () => {
  test('兩下加上旁白與配樂：預估花費 → 開始 → 出現音量調整；改音量會自動重混，成品變成有聲的新版本', async ({
    page,
  }, testInfo) => {
    await generateAndOpenCanvas(page)
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-panel')).toBeVisible()
    await expect(page.getByTestId('final-cut-video')).toBeVisible()

    const panel = page.getByTestId('sound-panel')
    await panel.scrollIntoViewIfNeeded()
    await expect(page.getByTestId('sound-add')).toBeVisible()
    await page.getByTestId('sound-add').click()
    await expect(page.getByTestId('sound-add-confirm')).toContainText('預估約')
    await page.screenshot({ path: testInfo.outputPath('sound-confirm.png') })

    await page.getByTestId('sound-add-go').click()
    await expect(page.getByTestId('sound-mixer')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('sound-music-mid')).toHaveAttribute('aria-pressed', 'true')
    await panel.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('sound-mixer.png') })

    // 成品變成有聲音的新版本
    const finalVersion = async (): Promise<number | undefined> => {
      const result = await page.evaluate(() => window.svs.invoke('sound.get', {}))
      return result.ok ? result.data.final?.version : undefined
    }
    const mixed = await page.evaluate(() => window.svs.invoke('sound.get', {}))
    expect(mixed.ok && mixed.data.final?.hasSound).toBe(true)
    const before = await finalVersion()

    // 改配樂音量：自動重混，成品再多一個版本
    await page.getByTestId('sound-music-low').click()
    await expect(page.getByTestId('sound-music-low')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(finalVersion, { timeout: 60_000 }).toBeGreaterThan(before ?? 0)
    await panel.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('sound-remixed.png') })
  })
})
