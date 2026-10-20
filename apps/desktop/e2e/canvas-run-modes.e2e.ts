import type { Page } from '@playwright/test'

import { canvasNodes, centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

const shotsOf = async (page: Page) => {
  const listed = await page.evaluate(() => window.svs.invoke('shots.list', {}))
  if (!listed.ok) throw new Error(listed.error.userMessage)
  return listed.data.shots
}
const firstShot = async (page: Page) => {
  const node = (await canvasNodes(page)).find((n) => n.data.kind === 'shot')
  if (!node) throw new Error('沒有鏡頭')
  return node
}

test.describe('畫布：▶ 旁的「只跑這個／這個和後面的／整條」', () => {
  test('滑過 ▶ 就看到預估；▾ 列出三種跑法各自的花費；選「只跑這個」只多一版影片、圖不變', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const shot = await firstShot(page)
    const video = `${shot.id}:video`
    await centerOn(page, video)

    // 滑過 ▶：說明裡多一句預估
    await page.getByTestId(`run-${video}`).hover()
    await expect(page.getByTestId('hover-tip')).toContainText('預估約 US$')

    // ▾：三列，各有花費
    await page.getByTestId(`run-mode-${video}`).click()
    const menu = page.getByTestId('run-mode-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveCount(3)
    for (const scope of ['this', 'from-here', 'chain']) {
      await expect(menu.getByTestId(`run-mode-${scope}`)).toContainText('約 US$')
    }
    await expect(menu.getByTestId('run-mode-chain')).toContainText('第一張畫面、影片，再接成品')

    // 只跑這個：確認面板只有這支影片（重做）
    const before = (await shotsOf(page)).find((s) => `shot:${s.id}` === shot.id)
    await menu.getByTestId('run-mode-this').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('影片（重做')
    await expect(confirm).not.toContainText('第一張畫面')
    await expect(confirm).not.toContainText('接成成品')
    await page.getByTestId('run-confirm-ok').click()
    await expect
      .poll(
        async () => (await shotsOf(page)).find((s) => `shot:${s.id}` === shot.id)?.videos.length,
      )
      .toBe((before?.videos.length ?? 0) + 1)
    const after = (await shotsOf(page)).find((s) => `shot:${s.id}` === shot.id)
    expect(after?.firstFrames.length).toBe(before?.firstFrames.length)
  })

  test('圖的 ▾ 只有兩列；「這個和後面的」列出圖、影片、接成品', async ({ page }) => {
    await generateAndOpenCanvas(page)
    const shot = await firstShot(page)
    const image = `${shot.id}:image`
    await centerOn(page, image)
    await page.getByTestId(`run-mode-${image}`).click()
    const menu = page.getByTestId('run-mode-menu')
    await expect(menu.getByRole('menuitem')).toHaveCount(2)
    await menu.getByTestId('run-mode-from-here').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('第一張畫面（重做')
    await expect(confirm).toContainText('影片（重做')
    await expect(confirm).toContainText('接成成品')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('run-confirm')).toHaveCount(0)
  })

  test('影片還沒有第一張畫面：「只跑這個」灰掉並寫「還不能跑：先要有第一張畫面」；「整條」可以', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const created = await page.evaluate(() => window.svs.invoke('shots.create', {}))
    if (!created.ok) throw new Error(created.error.userMessage)
    const video = `shot:${created.data.id}:video`
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === video)).toBe(true)
    await centerOn(page, video)

    // 滑過 ▶ 的說明就是補跑到影片（先補第一張畫面），不是「還不能跑」
    await page.getByTestId(`run-mode-${video}`).click()
    const menu = page.getByTestId('run-mode-menu')
    // 「只跑這個」「這個和後面的」都要有第一張畫面才能做影片；「整條」會連第一張畫面一起做
    await expect(menu.getByTestId('run-mode-issue')).toHaveCount(2)
    await expect(menu.getByTestId('run-mode-issue').first()).toContainText(
      '還不能跑：先要有第一張畫面',
    )
    await expect(menu.getByTestId('run-mode-this')).toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByTestId('run-mode-from-here')).toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByTestId('run-mode-chain')).not.toHaveAttribute('aria-disabled', 'true')
    await menu.getByTestId('run-mode-this').click({ force: true })
    await expect(page.getByTestId('run-confirm')).toHaveCount(0)
    await expect(menu).toBeVisible()

    // 整條：圖、影片、接成品
    await menu.getByTestId('run-mode-chain').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('第一張畫面')
    await expect(confirm).toContainText('影片')
    await expect(confirm).toContainText('接成成品')
  })
})
