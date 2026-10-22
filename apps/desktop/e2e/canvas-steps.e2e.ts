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

  test('「挑參考圖」顯示實際會帶的圖；打開清單點一張改成手動指定（第一張畫面標需要重跑），恢復自動', async ({
    page,
  }, testInfo) => {
    await generateAndOpenCanvas(page)
    const [first] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!first) throw new Error('沒有鏡頭')
    const shotId = first.id.replace(/^shot:/, '')

    // 準備：新角色鎖定（有主圖），出場在第一鏡
    const name = await page.evaluate(async (id) => {
      const created = await window.svs.invoke('characters.create', { name: '阿鐵' })
      if (!created.ok) throw new Error('建不了角色')
      const person = created.data
      await window.svs.invoke('shots.update', { shotId: id, patch: { characters: [person.name] } })
      await window.svs.invoke('characters.generateConcepts', { characterId: person.id })
      for (let i = 0; i < 100; i++) {
        const state = await window.svs.invoke('characters.concepts', { characterId: person.id })
        if (state.ok && state.data.concepts.length >= 4 && !state.data.generating) {
          const concept = state.data.concepts[0]
          if (!concept) break
          await window.svs.invoke('characters.pickHero', {
            characterId: person.id,
            conceptId: concept.id,
          })
          // 另外一張概念圖當「臉」的參考圖：清單裡就有第二張可以挑
          const other = state.data.concepts[1]
          if (other) {
            await window.svs.invoke('characters.addReference', {
              characterId: person.id,
              assetHash: other.assetHash,
              purpose: 'face',
            })
          }
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      await window.svs.invoke('characters.setAnchor', { characterId: person.id, text: '短黑髮' })
      await window.svs.invoke('characters.lock', { characterId: person.id })
      return person.name
    }, shotId)

    await centerOn(page, first.id)
    await page.getByTestId(`steps-toggle-${first.id}`).click()
    await centerOn(page, `${first.id}:step:refs`)
    const refs = page.getByTestId(`step-refs-${first.id}`)
    await expect(refs).toContainText(name)
    await expect(refs).toContainText('主圖')
    await expect(page.getByTestId(`step-refs-mode-${first.id}`)).toContainText('自動挑的')

    await page.getByTestId(`step-refs-pick-${first.id}`).click()
    const panel = page.getByTestId(`step-refs-panel-${first.id}`)
    await expect(panel).toBeVisible()
    const options = panel.locator('[data-testid^="step-refs-option-"]')
    await expect(options).toHaveCount(2)
    await expect(options.and(panel.locator('[aria-pressed="true"]'))).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('refs-picker.png') })

    // 再點一張沒選的＝手動指定（原本自動挑的那張照舊在最前面，加上這一張）
    await options.and(panel.locator('[aria-pressed="false"]')).first().click()
    await expect(page.getByTestId(`step-refs-mode-${first.id}`)).toContainText('你指定的')
    await expect(page.getByTestId('toast').filter({ hasText: '已指定參考圖' })).toBeVisible()
    await expect(options.and(panel.locator('[aria-pressed="true"]'))).toHaveCount(2)
    await expect(page.getByTestId(`step-refs-${first.id}`)).toContainText('臉')
    await page.screenshot({ path: testInfo.outputPath('refs-pinned.png') })

    await page.getByTestId(`step-refs-auto-${first.id}`).click()
    await expect(page.getByTestId(`step-refs-mode-${first.id}`)).toContainText('自動挑的')
    await page.getByTestId(`step-refs-close-${first.id}`).click()
    await expect(panel).toHaveCount(0)
  })
})
