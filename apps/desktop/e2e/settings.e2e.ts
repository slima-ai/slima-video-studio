import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from './fixtures'
import { launchApp } from './launch'

test.describe('第一次使用的引導與設定頁', () => {
  test('先試玩看看 → 進主畫面；設定頁是示範模式，模型選單只有示範模型', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'svs-e2e-onboarding-'))
    try {
      const { app } = await launchApp({
        userDataDir,
        // 空字串 = 不略過引導；SVS_PROVIDER_MODE 空字串 = 不預設示範模式
        env: { SVS_DISABLE_ONBOARDING: '', SVS_PROVIDER_MODE: '' },
      })
      const page = await app.firstWindow()
      await expect(page.getByTestId('setup-wizard')).toBeVisible()
      await page.screenshot({ path: join(userDataDir, 'wizard.png') })

      await page.getByTestId('wizard-demo').click()
      await expect(page.getByTestId('app-layout')).toBeVisible()

      await page.getByRole('button', { name: '設定' }).click()
      await expect(page.getByTestId('demo-mode')).toBeChecked()
      await expect(page.getByTestId('model-llm')).toHaveAttribute('data-value', 'mock/llm')
      await expect(page.getByTestId('model-t2i')).toHaveAttribute('data-value', 'mock/image')
      await expect(page.getByTestId('model-i2v')).toHaveAttribute('data-value', 'mock/video')
      await page.screenshot({ path: join(userDataDir, 'settings-demo.png') })

      // 重開 App：引導不會再出現，設定還在
      await app.close()
      const second = await launchApp({
        userDataDir,
        env: { SVS_DISABLE_ONBOARDING: '', SVS_PROVIDER_MODE: '' },
      })
      const page2 = await second.app.firstWindow()
      await expect(page2.getByTestId('app-layout')).toBeVisible()
      await expect(page2.getByTestId('setup-wizard')).toHaveCount(0)
      await page2.getByRole('button', { name: '設定' }).click()
      await expect(page2.getByTestId('demo-mode')).toBeChecked()
      await second.app.close()
    } finally {
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('旁白與配樂：填 OpenRouter 金鑰後各有一列，旁白底下可以選聲音；換旁白模型聲音跟著換', async ({
    page,
  }, testInfo) => {
    await page.getByRole('button', { name: '設定' }).click()
    await page.getByTestId('demo-mode').uncheck()
    await page.getByLabel('OpenRouter 的服務金鑰').fill('sk-or-e2e-SECRETVALUE-wxyz')
    await page.getByTestId('key-openrouter').getByRole('button', { name: '儲存' }).click()
    await expect(page.getByTestId('key-openrouter-status')).toHaveText('已設定（結尾 wxyz）')

    await expect(page.getByTestId('model-tts')).toHaveAttribute(
      'data-value',
      'openrouter/minimax-speech-2.8-hd',
    )
    await expect(page.getByTestId('model-music')).toHaveAttribute(
      'data-value',
      'openrouter/lyria-3-pro',
    )
    await expect(page.getByTestId('voice-tts')).toContainText('青澀青年男聲')
    await page.getByTestId('model-tts').scrollIntoViewIfNeeded()
    await page.getByTestId('models-section').screenshot({
      path: testInfo.outputPath('settings-tts-music-voice.png'),
    })

    // 換成備案的旁白模型：聲音清單跟著換
    await page.getByTestId('model-tts').click()
    await page.getByRole('option', { name: /ElevenLabs Eleven v3/ }).click()
    await expect(page.getByTestId('model-tts')).toHaveAttribute(
      'data-value',
      'openrouter/eleven-v3',
    )
    await expect(page.getByTestId('voice-tts')).toContainText('Adam')
    expect(await page.content()).not.toContain('SECRETVALUE')
  })

  test('在設定頁填服務金鑰：顯示已設定與末四碼、模型選單出現對應模型、關掉示範模式', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '設定' }).click()
    await expect(page.getByTestId('key-fal-status')).toHaveText('尚未設定')
    // 測試模式預設是示範模式：先關掉
    await page.getByTestId('demo-mode').uncheck()
    await expect(page.getByTestId('models-empty')).toBeVisible()

    await page.getByLabel('fal.ai 的服務金鑰').fill('fal-e2e-SECRETVALUE-wxyz')
    await page.getByTestId('key-fal').getByRole('button', { name: '儲存' }).click()
    await expect(page.getByTestId('key-fal-status')).toHaveText('已設定（結尾 wxyz）')
    await expect(page.getByTestId('model-t2i')).toHaveAttribute('data-value', 'fal/nano-banana-2')
    await expect(page.getByTestId('model-i2v')).toHaveAttribute(
      'data-value',
      'fal/kling-3.0-standard',
    )
    // 沒有 OpenRouter 的金鑰 → 沒有文字模型
    await expect(page.getByText(/目前沒有可用的文字模型/)).toBeVisible()
    // 明文不會留在畫面上
    expect(await page.content()).not.toContain('SECRETVALUE')

    // 移除金鑰：不跳確認框，直接移除
    // 移除、測試連線收在卡片的「更多」裡
    await page.getByTestId('key-fal').getByTestId('setting-card-more').click()
    await page.getByTestId('key-fal').getByRole('button', { name: '移除金鑰' }).click()
    await expect(page.getByTestId('key-fal-status')).toHaveText('尚未設定')
    await page.getByLabel('fal.ai 的服務金鑰').fill('fal-e2e-SECRETVALUE-wxyz')
    await page.getByTestId('key-fal').getByRole('button', { name: '儲存' }).click()
    await expect(page.getByTestId('key-fal-status')).toHaveText('已設定（結尾 wxyz）')

    // 換成經濟實惠的圖片模型
    await page.getByTestId('model-t2i').click()
    await page.getByTestId('model-t2i-option-fal/seedream-5.0').click()
    await expect(page.getByTestId('model-t2i')).toHaveAttribute('data-value', 'fal/seedream-5.0')
  })

  test('兩家的金鑰都填：同一個模型只列一次，寫出走哪家；Seedance 2.0 走比較便宜的 OpenRouter', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '設定' }).click()
    await page.getByTestId('demo-mode').uncheck()
    for (const [label, id, value] of [
      ['fal.ai 的服務金鑰', 'fal', 'fal-e2e-SECRETVALUE-wxyz'],
      ['OpenRouter 的服務金鑰', 'openrouter', 'sk-or-e2e-SECRETVALUE-abcd'],
    ] as const) {
      await page.getByLabel(label).fill(value)
      await page.getByTestId(`key-${id}`).getByRole('button', { name: '儲存' }).click()
      await expect(page.getByTestId(`key-${id}-status`)).toContainText('已設定')
    }
    // 預設的 Kling 3.0 Standard 兩家同價：走 fal.ai，並說 OpenRouter 也有
    await expect(page.getByTestId('model-i2v')).toHaveAttribute(
      'data-value',
      'fal/kling-3.0-standard',
    )
    await expect(page.getByTestId('model-i2v-channel')).toHaveText(
      '透過 fal.ai（OpenRouter 也有，會自動走比較便宜的那家）',
    )

    await page.getByTestId('model-i2v').click()
    const list = page.getByRole('listbox')
    await expect(list.getByRole('option', { name: /^Seedance 2\.0/ })).toHaveCount(1)
    await expect(page.getByTestId('model-i2v-option-fal/seedance-2.0')).toHaveCount(0)
    await page.getByTestId('model-i2v-option-openrouter/seedance-2.0').click()
    await expect(page.getByTestId('model-i2v')).toHaveAttribute(
      'data-value',
      'openrouter/seedance-2.0',
    )
    await expect(page.getByTestId('model-i2v-channel')).toHaveText(
      '透過 OpenRouter（fal.ai 也有，會自動走比較便宜的那家）',
    )
  })

  test('外觀：選淺色立刻換，重開 App 還是淺色；改回跟隨系統就拿掉設定', async ({
    page,
    app,
    userDataDir,
  }) => {
    const html = page.locator('html')
    await page.getByRole('button', { name: '設定' }).click()
    await expect(page.getByTestId('theme-system')).toBeChecked()
    await page.getByTestId('general-section').getByText('淺色', { exact: true }).click()
    await expect(html).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 245, 248)')

    await app.close()
    const again = await launchApp({ userDataDir })
    try {
      const next = await again.app.firstWindow()
      await next.waitForLoadState('domcontentloaded')
      await expect(next.locator('html')).toHaveAttribute('data-theme', 'light')
      await next.getByRole('button', { name: '設定' }).click()
      await expect(next.getByTestId('theme-light')).toBeChecked()
      await next.getByTestId('general-section').getByText('跟隨系統', { exact: true }).click()
      await expect(next.locator('html')).not.toHaveAttribute('data-theme', /.+/)
    } finally {
      await again.app.close()
    }
  })

  test('花費上限可以修改並保存', async ({ page }) => {
    await page.getByRole('button', { name: '設定' }).click()
    await page.getByTestId('per-run-limit').fill('8')
    await page.getByTestId('general-section').getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('status')).toHaveText('已儲存。')
    const settings = await page.evaluate(() => window.svs.invoke('settings.get', {}))
    expect(settings).toMatchObject({ ok: true, data: { budget: { perRunLimitUsd: 8 } } })
  })

  test('頂端小標籤：捲到哪一區亮哪一個（含很長的區的中段與最底），點標籤捲到對的區', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '設定' }).click()
    await expect(page.getByTestId('settings-tags')).toBeVisible()
    const ids = ['general', 'connections', 'keys', 'models', 'experiments']
    const lit = async (): Promise<string[]> =>
      page
        .locator('[data-testid^="settings-tag-"][aria-current="true"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''))
    /** 內容區的捲動容器（設定頁外面那一層）。 */
    const scrollTo = (id: string, offsetPx: number): Promise<void> =>
      page.evaluate(
        ([target, offset]) => {
          const el = document.getElementById(String(target))
          if (!el) throw new Error('找不到區')
          let node = el.parentElement
          while (
            node &&
            !(
              node.scrollHeight > node.clientHeight &&
              /auto|scroll/.test(getComputedStyle(node).overflowY)
            )
          ) {
            node = node.parentElement
          }
          if (!node) throw new Error('找不到捲動容器')
          const delta = el.getBoundingClientRect().top - 64 + Number(offset)
          node.scrollTop += delta
        },
        [id, offsetPx],
      )

    // 一開始：一般
    await expect.poll(lit).toEqual(['settings-tag-general'])
    // 依序捲到五區（區的頂端剛好在標題列下面）：每一次亮的都是那一區
    for (const id of ids) {
      await scrollTo(id, 0)
      await expect.poll(lit, { message: `捲到 ${id}` }).toEqual([`settings-tag-${id}`])
    }
    // 倒著捲回來也一樣
    for (const id of [...ids].reverse()) {
      await scrollTo(id, 0)
      await expect.poll(lit, { message: `倒捲到 ${id}` }).toEqual([`settings-tag-${id}`])
    }
    // 很長的區（AI 工具連線）捲到中段：還是它，不是上一區也不是下一區
    await scrollTo('connections', 300)
    await expect.poll(lit).toEqual(['settings-tag-connections'])
    // 捲到整頁最底：最後一區（它很短，頂端碰不到線）
    await page.evaluate(() => {
      const el = document.getElementById('experiments')
      let node = el?.parentElement ?? null
      while (
        node &&
        !(
          node.scrollHeight > node.clientHeight &&
          /auto|scroll/.test(getComputedStyle(node).overflowY)
        )
      ) {
        node = node.parentElement
      }
      if (node) node.scrollTop = node.scrollHeight
    })
    await expect.poll(lit).toEqual(['settings-tag-experiments'])

    // 點標籤：捲到那一區（頂端在標題列下面），而且亮的是它
    await page.getByTestId('settings-tag-general').click()
    for (const id of ['keys', 'connections', 'models', 'general']) {
      await page.getByTestId(`settings-tag-${id}`).click()
      await expect
        .poll(async () =>
          page.evaluate(
            (target) => document.getElementById(target)?.getBoundingClientRect().top ?? 9999,
            id,
          ),
        )
        .toBeLessThan(110)
      await expect
        .poll(async () =>
          page.evaluate(
            (target) => document.getElementById(target)?.getBoundingClientRect().top ?? -9999,
            id,
          ),
        )
        .toBeGreaterThan(40)
      await expect.poll(lit).toEqual([`settings-tag-${id}`])
      // 平滑捲動結束、鎖放掉之後還是它（頁面捲到底、這一區頂端碰不到上緣時，亮的不能退回上一區）
      await page.waitForTimeout(1200)
      expect(await lit()).toEqual([`settings-tag-${id}`])
    }
  })
})
