import { FAKE_OPENROUTER_KEY, startFakeOpenRouter, type FakeOpenRouter } from '@svs/test-utils'
import { existsSync, statSync } from 'node:fs'

import { centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { closeApp, expect, test as base } from './fixtures'
import { launchApp } from './launch'

// 只填 OpenRouter 一把 Key（真的走金庫、真的走 driver 與網路請求），對著本機的假 OpenRouter 出一支片。
// 證明 App 這一側的接線與流程；回應長相是照文件寫的，真實 API 要真的 Key 才驗得到。
const test = base.extend<{ fake: FakeOpenRouter }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture 一定要用解構參數
  fake: async ({}, use) => {
    const fake = await startFakeOpenRouter()
    await use(fake)
    await fake.close()
  },
  // 不是示範模式（SVS_PROVIDER_MODE 不是 mock）：走真的供應商，只是 OpenRouter 換成本機的假伺服器
  app: async ({ userDataDir, fake }, use, testInfo) => {
    const { app } = await launchApp({
      userDataDir,
      env: { SVS_PROVIDER_MODE: 'live', SVS_OPENROUTER_BASE_URL: fake.url },
    })
    await use(app)
    await closeApp(app, userDataDir, testInfo)
  },
})

test.describe('只填 OpenRouter 一把 Key（假的 OpenRouter 伺服器）', () => {
  test('填 Key → 一句話 → 拆鏡、圖片、影片都走 OpenRouter 的網路請求 → 接成成品 → 匯出 MP4', async ({
    page,
    fake,
  }) => {
    await page.getByRole('button', { name: '設定' }).click()
    await expect(page.getByTestId('demo-mode')).not.toBeChecked()
    await page.getByLabel('OpenRouter 的服務金鑰').fill(FAKE_OPENROUTER_KEY)
    await page.getByTestId('key-openrouter').getByRole('button', { name: '儲存' }).click()
    await expect(page.getByTestId('key-openrouter-status')).toContainText('已設定')

    // 只有 OpenRouter 時，文字、圖片、影片三種模型都選得到（不用 fal）
    for (const id of ['model-llm', 'model-t2i', 'model-i2v']) {
      await expect(page.getByTestId(id)).not.toHaveAttribute('data-value', '')
    }

    await generateAndOpenCanvas(page)

    // 每一種請求都真的送到了假伺服器：1 次拆鏡（文字）、3 張圖、3 支影片（送出＋下載）
    const post = (path: string) =>
      fake.requests.filter((r) => r.method === 'POST' && r.path === path)
    const chats = post('/chat/completions').map((r) => r.body as Record<string, unknown>)
    expect(chats.filter((b) => b.response_format !== undefined)).toHaveLength(1)
    expect(chats.filter((b) => b.modalities !== undefined)).toHaveLength(3)
    expect(post('/videos')).toHaveLength(3)
    expect(fake.requests.filter((r) => r.path.endsWith('/content'))).toHaveLength(3)
    // 沒有請求漏到別處（全部是 App 該打的那幾條路）
    expect(
      fake.requests.filter((r) => r.path === '/chat/completions' && r.method !== 'POST'),
    ).toEqual([])

    // 畫布上長出 3 鏡，花費是假伺服器回報的（不是 0，也不是示範模式的估算）
    await expect(page.getByTestId('spent')).not.toHaveText(/US\$0\.00$/)

    // 成品預覽、匯出
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    const video = page.getByTestId('final-cut-video')
    await expect(video).toBeVisible()
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)
    // 3 支 2 秒的假影片接起來，約 6 秒
    const duration = await video.evaluate((v: HTMLVideoElement) => v.duration)
    expect(duration).toBeGreaterThan(5)
    expect(duration).toBeLessThan(7.5)
    await page.getByTestId('final-cut-export').click()
    const exported = page.getByTestId('final-cut-exported')
    await expect(exported).toContainText('已匯出到')
    const path = (await exported.innerText()).replace('已匯出到 ', '').trim()
    expect(path).toMatch(/exports[\\/].+\.mp4$/)
    expect(existsSync(path)).toBe(true)
    expect(statSync(path).size).toBeGreaterThan(1000)
  })

  test('Key 填錯：假伺服器回 401，畫面給白話提示，不會把 Key 或供應商原始錯誤丟到畫面上', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '設定' }).click()
    await page.getByLabel('OpenRouter 的服務金鑰').fill('sk-or-wrong-SECRETVALUE-1234')
    await page.getByTestId('key-openrouter').getByRole('button', { name: '儲存' }).click()
    await expect(page.getByTestId('key-openrouter-status')).toContainText('已設定')

    await page.getByTestId('key-openrouter').getByRole('button', { name: '測試連線' }).click()
    await expect(page.getByText('金鑰無效或已被停用，請重新複製一次。')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('SECRETVALUE')
    await expect(page.locator('body')).not.toContainText('No auth credentials found')
  })
})
