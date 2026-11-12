import { FAKE_OPENROUTER_KEY, startFakeOpenRouter, type FakeOpenRouter } from '@svs/test-utils'
import type { Page, TestInfo } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { closeApp, expect, test as base } from './fixtures'
import { launchApp } from './launch'

// 真的走供應商（本機假 OpenRouter，每次文字請求回報 US$0.37），寫預告片腳本被檢查器擋下：
// 兩次呼叫的錢要記帳，剛建的空專案刪掉之後錢還在，「已花」算得到。
const COST = 0.37

const test = base.extend<{ fake: FakeOpenRouter }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture 一定要用解構參數
  fake: async ({}, use) => {
    const fake = await startFakeOpenRouter({ chatCostUsd: COST })
    await use(fake)
    await fake.close()
  },
  app: async ({ userDataDir, fake }, use, testInfo) => {
    const { app } = await launchApp({
      userDataDir,
      env: { SVS_PROVIDER_MODE: 'live', SVS_OPENROUTER_BASE_URL: fake.url },
    })
    await use(app)
    await closeApp(app, userDataDir, testInfo)
  },
})

/** 截圖與回覆原文存在 test-results；有設 SVS_SCREENSHOT_DIR 就另外複製一份到那個資料夾（用自己指定的檔名）。 */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name)
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
  await page.screenshot({ path })
  copyOut(path, name)
}

function copyOut(path: string, name: string): void {
  const dir = process.env.SVS_SCREENSHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  copyFileSync(path, join(dir, name))
}

const statusReply = (page: Page) => page.evaluate(() => window.svs.invoke('project.status', {}))

test.describe('寫預告片腳本失敗也要記帳（假的 OpenRouter，每次文字請求 US$0.37）', () => {
  test('沒有專案時被擋下：兩次呼叫的錢記在 App 層帳本，空專案刪掉後還在，之後開的專案「已花」算進去', async ({
    page,
    fake,
    userDataDir,
  }, testInfo) => {
    await page.getByRole('button', { name: '設定' }).click()
    await page.getByLabel('OpenRouter 的服務金鑰').fill(FAKE_OPENROUTER_KEY)
    await page.getByTestId('key-openrouter').getByRole('button', { name: '儲存' }).click()
    await expect(page.getByTestId('key-openrouter-status')).toContainText('已設定')
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('trailer-start')).toBeVisible()

    await page
      .getByTestId('trailer-text')
      .fill('黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。')
    await expect(page.getByTestId('trailer-go')).toBeEnabled()
    await page.getByTestId('trailer-go').click()
    await expect(page.getByTestId('trailer-error')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('trailer-error')).toContainText('專案沒有被改')

    // 真的打了兩次文字模型（寫、退回重寫），每次 US$0.37
    const scriptCalls = fake.requests.filter(
      (r) => r.method === 'POST' && r.path === '/chat/completions',
    )
    expect(scriptCalls.length).toBe(2)

    // 空專案不留下
    expect(await page.evaluate(() => window.svs.invoke('project.current', {}))).toMatchObject({
      ok: true,
      data: null,
    })
    // 錢在 App 層的帳本檔裡（不在已經刪掉的專案裡）
    const ledgerFile = join(userDataDir, 'spend-ledger.json')
    expect(existsSync(ledgerFile)).toBe(true)
    const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8')) as {
      entries: { amountUsd: number; provider: string }[]
    }
    expect(ledger.entries).toHaveLength(2)
    expect(ledger.entries.reduce((sum, e) => sum + e.amountUsd, 0)).toBeCloseTo(2 * COST, 9)
    expect(new Set(ledger.entries.map((e) => e.provider))).toEqual(new Set(['openrouter']))
    await shoot(page, testInfo, '01-failed-no-project-left.png')

    // 之後開一個專案：「已花」算進那一筆，說明寫出其中多少是沒做成的專案花的
    await page.getByTestId('empty-manual').click()
    const spent = page.getByTestId('spent')
    await expect(spent).toHaveText('已花 US$0.74')
    await expect(spent).toHaveAttribute(
      'title',
      /其中 US\$0\.74 是之前沒做成、已經刪掉的空專案花的/,
    )
    const reply = await statusReply(page)
    const replyFile = testInfo.outputPath('project-status-reply.json')
    writeFileSync(replyFile, JSON.stringify(reply, null, 2))
    copyOut(replyFile, 'project-status-reply.json')
    expect(reply).toMatchObject({
      ok: true,
      data: { spentUsd: 2 * COST, discardedSpentUsd: 2 * COST },
    })
    await shoot(page, testInfo, '02-spent-counts-failed-call.png')

    // 這個專案裡再失敗一次：專案還在（已有鏡頭），錢記在專案自己的帳本上；「已花」再加 0.74
    // 空畫布的卡片已經不在：用 IPC 再寫一次
    const again = await page.evaluate(() =>
      window.svs.invoke('trailer.plan', { text: '又一段文字。她一個人守著燈。' }),
    )
    expect(again.ok).toBe(false)
    await expect(spent).toHaveText('已花 US$1.48')
    expect(await page.evaluate(() => window.svs.invoke('project.current', {}))).toMatchObject({
      ok: true,
      data: { name: expect.any(String) as unknown },
    })
    await shoot(page, testInfo, '03-failed-again-in-open-project.png')
  })
})
