import { centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

test.describe('成品的聲音（示範模式）', () => {
  test('快速開始的聲音勾選預設全開：生成完成後旁白與配樂自動加好，成品是有聲音的', async ({
    page,
  }, testInfo) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const empty = page.getByTestId('empty-add-oneliner')
    if (await empty.isVisible()) await empty.click()
    else await page.getByTestId('palette-oneliner').click()
    await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
    await page.getByTestId('oneliner-story').blur()
    for (const key of ['native', 'narration', 'music']) {
      await expect(page.getByTestId(`oneliner-sound-${key}`)).toBeChecked()
    }
    await page.getByTestId('oneliner-sound').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('oneliner-sound-checkboxes.png') })
    await page.getByTestId('oneliner-generate').click()
    // 確認面板的預估已經含聲音的花費
    await expect(page.getByTestId('run-confirm')).toBeVisible()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
      timeout: 60_000,
    })
    // 影片完成後自動加聲音：成品變成混好聲音的版本
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(() => window.svs.invoke('sound.get', {}))
          return result.ok ? result.data.final?.hasSound : undefined
        },
        { timeout: 60_000 },
      )
      .toBe(true)
  })

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

  test('一個鏡頭的聲音：寫台詞 → 念出這句台詞（先給預估、確認才開始）→ 成品自動重混；時間軸看得到旁白；關掉這一鏡的原聲', async ({
    page,
  }, testInfo) => {
    await generateAndOpenCanvas(page)
    // 第 1 鏡寫一句台詞（示範模式拆出來的鏡頭沒有台詞）
    const shots = await page.evaluate(() => window.svs.invoke('shots.list', {}))
    if (!shots.ok) throw new Error(shots.error.userMessage)
    const first = shots.data.shots[0]
    if (!first) throw new Error('沒有鏡頭')
    await page.evaluate(
      (id) =>
        window.svs.invoke('shots.update', { shotId: id, patch: { dialogue: '黑藤爬滿了斷橋。' } }),
      first.id,
    )
    const key = `shot:${first.id}`
    await centerOn(page, key)
    await page.getByTestId(`open-${key}`).click()
    await expect(page.getByTestId('shot-panel')).toBeVisible()
    await page.getByTestId('shot-sound').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('shot-sound-native')).toBeChecked()
    await page.getByTestId('shot-sound-narrate').click()
    await expect(page.getByTestId('shot-sound-confirm')).toContainText('預估約')
    await page.getByTestId('shot-sound-go').click()
    await expect(page.getByTestId('shot-sound-narration')).toContainText('第 1 版', {
      timeout: 60_000,
    })
    await page.getByTestId('shot-sound').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('shot-sound.png') })

    const soundOf = async () => {
      const result = await page.evaluate(() => window.svs.invoke('sound.get', {}))
      return result.ok ? result.data : undefined
    }
    // 念完自動重混：成品變成有聲音的新版本
    await expect
      .poll(async () => (await soundOf())?.final?.hasSound, { timeout: 60_000 })
      .toBe(true)
    const before = (await soundOf())?.final?.version ?? 0

    // 這一鏡的原聲關掉：靜音名單有它；成品再自動重混一版
    await page.getByTestId('shot-sound-native').uncheck()
    await expect
      .poll(async () => (await soundOf())?.settings.muteNativeShotIds, { timeout: 30_000 })
      .toEqual([first.id])
    await expect
      .poll(async () => (await soundOf())?.final?.version ?? 0, { timeout: 60_000 })
      .toBeGreaterThan(before)

    // 成品面板的時間軸：第 1 鏡有旁白、原聲標為靜音
    await page.keyboard.press('Escape')
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-panel')).toBeVisible()
    await page.getByTestId('sound-panel').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('sound-timeline')).toBeVisible()
    await expect(page.getByTestId('timeline-narration-1')).toBeVisible()
    await expect(page.getByTestId('timeline-native-1')).toHaveAttribute('data-muted', 'true')
    await page.screenshot({ path: testInfo.outputPath('sound-timeline.png') })
  })
})
