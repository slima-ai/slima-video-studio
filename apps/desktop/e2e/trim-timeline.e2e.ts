import type { Page } from '@playwright/test'
import { pseudoLocalize } from '@svs/schema'

import { centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'
import { pick } from './pick'

const soundOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('sound.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data
}

async function openCutPanel(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await centerOn(page, 'cut')
  await page.getByTestId('open-cut').click()
  await expect(page.getByTestId('final-cut-panel')).toBeVisible()
  await page.getByTestId('sound-panel').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('sound-timeline')).toBeVisible()
}

test.describe('成品面板的時間軸：秒數尺與拖格子邊緣剪頭尾（示範模式，每鏡 3 秒的假影片）', () => {
  test('秒數尺在、每格寫秒數；真的拖鏡 2 的出點邊緣，鏡頭面板、成品長度都跟著變，剪掉的部分出現在「剪掉」那排', async ({
    page,
  }, testInfo) => {
    await generateAndOpenCanvas(page)
    await openCutPanel(page)
    await expect(page.getByTestId('timeline-ruler')).toBeVisible()
    await expect(page.getByTestId('timeline-tick-0')).toBeVisible()
    await expect(page.getByTestId('timeline-secs-2')).toHaveText('3.0')
    await expect(page.getByTestId('timeline-cut-2')).toHaveCount(0)
    await page.getByTestId('sound-timeline').screenshot({
      path: testInfo.outputPath('timeline-before.png'),
    })

    const before = await soundOf(page)
    const second = before.shots[1]
    if (!second?.trim) throw new Error('鏡 2 應該帶影片長度')
    const total = before.totalSec

    // 真的拖：出點邊緣往左拖到鏡 2 這一格的一半（3 秒 → 約 1.5 秒）
    const cell = await page.getByTestId('timeline-shot-2').boundingBox()
    const edge = await page.getByTestId('timeline-edge-out-2').boundingBox()
    if (!cell || !edge) throw new Error('時間軸沒有畫出來')
    const y = edge.y + edge.height / 2
    await page.mouse.move(edge.x + edge.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(cell.x + cell.width * 0.5, y, { steps: 10 })
    // 還沒放開：只預覽，沒有存
    await expect(page.getByTestId('timeline-edge-readout')).toContainText('鏡 2：留下 0.0–')
    expect((await soundOf(page)).shots[1]?.trim?.trimmed).toBe(false)
    await page.screenshot({ path: testInfo.outputPath('timeline-dragging.png') })
    await page.mouse.up()

    await expect.poll(async () => (await soundOf(page)).shots[1]?.trim?.trimmed).toBe(true)
    const after = await soundOf(page)
    const trimmed = after.shots[1]
    expect(trimmed?.trim?.inSec).toBe(0)
    expect(trimmed?.trim?.outSec).toBeGreaterThan(1.2)
    expect(trimmed?.trim?.outSec).toBeLessThan(1.8)
    // 這一鏡變短、後面各鏡的起點往前移，總長剛好少了被剪掉的秒數
    expect(trimmed?.durationSec).toBeCloseTo(trimmed?.trim?.outSec ?? 0, 5)
    expect(after.totalSec).toBeCloseTo(total - (3 - (trimmed?.trim?.outSec ?? 0)), 3)
    await expect(page.getByTestId('timeline-secs-2')).toHaveText(
      (trimmed?.durationSec ?? 0).toFixed(1),
    )
    await expect(page.getByTestId('timeline-cut-2')).toBeVisible()
    await page.getByTestId('sound-timeline').screenshot({
      path: testInfo.outputPath('timeline-after.png'),
    })

    // 鏡頭面板（同一份資料）讀到的出點一樣
    await page.keyboard.press('Escape')
    const shotId = after.shots[1]?.shotId
    if (!shotId) throw new Error('沒有鏡 2')
    await centerOn(page, `shot:${shotId}`)
    await page.getByTestId(`open-shot:${shotId}`).click()
    await expect(page.getByTestId('trim-control')).toBeVisible()
    await expect
      .poll(async () => Number(await page.getByTestId('trim-out').inputValue()))
      .toBeCloseTo(trimmed?.trim?.outSec ?? 0, 3)
  })

  test('鍵盤：聚焦入點邊緣按 → 逐格往後；存起來之後鏡 1 不受影響', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await openCutPanel(page)
    await page.getByTestId('timeline-edge-in-2').focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(async () => (await soundOf(page)).shots[1]?.trim?.inSec ?? 0)
      .toBeCloseTo(1 / 24, 3)
    const state = await soundOf(page)
    expect(state.shots[0]?.trim?.trimmed).toBe(false)
    expect(state.shots[1]?.durationSec).toBeCloseTo(3 - 1 / 24, 3)
  })
})

const BAD_HAN = /[㐀-鿿，。：；（）、！？「」・]/u

for (const locale of ['en', 'en-XA'] as const) {
  test.describe(`英文介面（${locale}）的時間軸`, () => {
    test.use({ appEnv: { SVS_LOCALE: locale } })

    test('秒數尺、剪掉那排、拖的提示都是英文，沒有中文與全形標點；格子與把手不破版', async ({
      page,
    }, testInfo) => {
      await page
        .getByRole('button', {
          name: locale === 'en' ? 'Canvas' : pseudoLocalize('Canvas'),
          exact: true,
        })
        .click()
      await expect(page.getByTestId('canvas-root')).toBeVisible()
      await page.getByTestId('empty-add-oneliner').click()
      await page.getByTestId('oneliner-story').fill('A cat finds a warm home on a rainy night')
      await page.getByTestId('oneliner-story').blur()
      await pick(page, 'oneliner-shots', '3')
      await pick(page, 'oneliner-duration', '3')
      for (const key of ['native', 'narration', 'music']) {
        await page.getByTestId(`oneliner-sound-${key}`).uncheck()
      }
      await page.getByTestId('oneliner-generate').click()
      await page.getByTestId('run-confirm-ok').click()
      await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'true')
      await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
        timeout: 60_000,
      })
      await openCutPanel(page)

      // 鍵盤剪一下鏡 2 的出點（逐格退一格），讓「剪掉」那排出現
      await page.getByTestId('timeline-edge-out-2').focus()
      await page.keyboard.press('ArrowLeft')
      await expect(page.getByTestId('timeline-cut-2')).toBeVisible()

      const scan = await page.getByTestId('sound-panel').evaluate((root, source) => {
        const copy = root.cloneNode(true) as HTMLElement
        const attrs = [...copy.querySelectorAll('*')]
          .flatMap((el) => ['aria-label', 'title', 'aria-valuetext'].map((n) => el.getAttribute(n)))
          .join(' | ')
        const all = `${copy.textContent} | ${attrs}`
        return { hits: all.match(new RegExp(source, 'gu')) ?? [], length: all.length }
      }, BAD_HAN.source)
      expect(scan.length).toBeGreaterThan(100)
      expect(scan.hits).toEqual([])
      await expect(page.getByTestId('timeline-ruler')).toHaveAttribute(
        'aria-label',
        locale === 'en' ? 'Seconds ruler' : /.+/,
      )

      // 版面：每一格都在時間軸裡，鏡號與秒數沒有被切成空白；把手各自在自己那一格裡面
      const geometry = await page.evaluate(() => {
        const rect = (id: string) =>
          document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect()
        const lane = document.querySelector('[data-testid="timeline-shot-1"]')?.parentElement
        const laneBox = lane?.getBoundingClientRect()
        return {
          lane: laneBox && { left: laneBox.left, right: laneBox.right },
          cells: [1, 2, 3].map((n) => rect(`timeline-shot-${String(n)}`)),
          edgesIn: [1, 2, 3].map((n) => rect(`timeline-edge-in-${String(n)}`)),
          edgesOut: [1, 2, 3].map((n) => rect(`timeline-edge-out-${String(n)}`)),
        }
      })
      geometry.cells.forEach((cell, index) => {
        const lane = geometry.lane
        if (!cell || !lane) throw new Error('時間軸沒有畫出來')
        expect(cell.left).toBeGreaterThanOrEqual(lane.left - 1)
        expect(cell.right).toBeLessThanOrEqual(lane.right + 1)
        const inEdge = geometry.edgesIn[index]
        const outEdge = geometry.edgesOut[index]
        expect(inEdge?.left).toBeGreaterThanOrEqual(cell.left - 1)
        expect(outEdge?.right).toBeLessThanOrEqual(cell.right + 1)
      })
      await page.getByTestId('sound-timeline').screenshot({
        path: testInfo.outputPath(`timeline-${locale}.png`),
      })
    })
  })
}
