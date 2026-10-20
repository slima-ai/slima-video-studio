import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from './fixtures'
import { launchApp } from './launch'

const FAKE_TOKEN = 'slima_fake_valid_token_0000'

test.describe('Slima 連線（假伺服器）', () => {
  test('貼上 Token → 已連線並列出三本書；重開 App 自動連線；中斷後清掉 Token', async ({
    app,
    userDataDir,
  }) => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'svs-e2e-slima-'))
    const vaultFile = join(vaultDir, 'vault.json')
    try {
      // 這個測試要用有持久化金鑰庫的 App，所以關掉預設啟動的那個
      await app.close()
      const first = await launchApp({ userDataDir, env: { SVS_TEST_VAULT_FILE: vaultFile } })
      const page1 = await first.app.firstWindow()
      await page1.waitForLoadState('domcontentloaded')
      await page1.getByRole('button', { name: '設定' }).click()
      await expect(page1.getByTestId('slima-status')).toHaveText('尚未連線')
      await expect(page1.getByTestId('diagram-slima-status')).toHaveText('尚未連線')

      await page1.getByTestId('slima-token').fill(FAKE_TOKEN)
      await page1.getByTestId('slima-connect').click()
      await expect(page1.getByTestId('slima-status')).toHaveText('已連線（Token 結尾 0000）', {
        timeout: 30_000,
      })
      await expect(page1.getByTestId('slima-book')).toHaveCount(3)
      await expect(page1.getByTestId('slima-book').first()).toContainText('雨夜的貓')
      await expect(page1.getByTestId('slima-book').nth(1)).toContainText('劇本')
      // Token 明文不會出現在畫面上
      await expect(page1.locator('body')).not.toContainText(FAKE_TOKEN)
      await first.app.close()

      // 重開 App：金鑰庫裡的 Token 讓它自動連線，不用再貼
      const second = await launchApp({ userDataDir, env: { SVS_TEST_VAULT_FILE: vaultFile } })
      const page2 = await second.app.firstWindow()
      await page2.waitForLoadState('domcontentloaded')
      await page2.getByRole('button', { name: '設定' }).click()
      await expect(page2.getByTestId('slima-status')).toHaveText('已連線（Token 結尾 0000）', {
        timeout: 30_000,
      })

      await page2.getByTestId('slima-section').getByTestId('setting-card-more').click()
      await page2.getByTestId('slima-disconnect').click()
      await expect(page2.getByTestId('slima-status')).toHaveText('尚未連線')
      await expect(page2.getByTestId('slima-books')).toHaveCount(0)
      const listed = await page2.evaluate(() => window.svs.invoke('keys.list', {}))
      expect(JSON.stringify(listed)).not.toContain('"slima"')
      await second.app.close()
    } finally {
      rmSync(vaultDir, { recursive: true, force: true })
    }
  })

  test('Token 不對：說明 Token 無效，其他功能照常；換成正確的就連上', async ({ page }) => {
    await page.getByRole('button', { name: '設定' }).click()
    await page.getByTestId('slima-token').fill('slima_wrong_token_9999')
    await page.getByTestId('slima-connect').click()
    await expect(page.getByTestId('slima-message')).toContainText('Token', { timeout: 30_000 })
    await expect(page.getByTestId('slima-status')).toHaveAttribute('data-tone', 'error')
    await expect(page.getByTestId('slima-status')).toHaveText('連不上')
    await expect(page.getByTestId('slima-book')).toHaveCount(0)

    await page.getByTestId('slima-token').fill(FAKE_TOKEN)
    await page.getByTestId('slima-connect').click()
    await expect(page.getByTestId('slima-status')).toHaveAttribute('data-tone', 'ok', {
      timeout: 30_000,
    })
    await expect(page.getByTestId('slima-book')).toHaveCount(3)
  })
})

test.describe('從 Slima 匯入（假伺服器、示範模式）', () => {
  test('沒連線時沒有入口；連線後匯入劇本書的角色、地點、場', async ({ page }) => {
    await expect(page.getByRole('button', { name: '從 Slima 匯入' })).toHaveCount(0)
    await page.getByRole('button', { name: '設定' }).click()
    await page.getByTestId('slima-token').fill(FAKE_TOKEN)
    await page.getByTestId('slima-connect').click()
    await expect(page.getByTestId('slima-status')).toHaveAttribute('data-tone', 'ok', {
      timeout: 30_000,
    })

    await page.getByRole('button', { name: '從 Slima 匯入' }).click()
    await page.getByTestId('slima-import-book').filter({ hasText: '鐵與花' }).click()
    await expect(page.getByTestId('slima-import-file')).toHaveCount(4)
    // 預設用途依檔案猜好了
    await expect(page.getByTestId('slima-import-use').first()).toHaveValue('character')

    for (const box of await page.getByRole('checkbox').all()) await box.check()
    await page.getByTestId('slima-import-run').click()
    const check = page.getByTestId('slima-import-check')
    await expect(check).toContainText('新增角色：小花、阿鐵')
    await expect(check).toContainText('新增地點：廢料場')
    await expect(check).toContainText('新增場：雨中相遇')
    await page.getByTestId('slima-import-confirm').click()
    await expect(page.getByTestId('slima-import-summary')).toHaveText(
      '新增：2 個角色、1 個地點、1 場戲。',
    )

    await page.getByTestId('slima-go-characters').click()
    await expect(page.getByTestId('character-item-小花')).toBeVisible()
    await expect(page.getByTestId('character-item-阿鐵')).toBeVisible()

    await page.getByRole('button', { name: '大綱' }).click()
    await expect(page.getByTestId('act-title')).toHaveValue('從 Slima 匯入')
    await expect(page.getByTestId('scene-title')).toHaveValue('雨中相遇')

    await page.getByRole('button', { name: '場景卡' }).click()
    await expect(page.getByTestId('location-item-廢料場')).toBeVisible()
  })

  test('小說書：章節拆成分場，角色與地點檔案一起匯入', async ({ page }) => {
    await page.getByRole('button', { name: '設定' }).click()
    await page.getByTestId('slima-token').fill(FAKE_TOKEN)
    await page.getByTestId('slima-connect').click()
    await expect(page.getByTestId('slima-status')).toHaveAttribute('data-tone', 'ok', {
      timeout: 30_000,
    })

    await page.getByRole('button', { name: '從 Slima 匯入' }).click()
    await page.getByTestId('slima-import-book').filter({ hasText: '雨夜的貓' }).click()
    await expect(page.getByTestId('slima-import-file')).toHaveCount(4)
    await page.getByLabel('選取 chapter-01.md').check()
    await page.getByLabel('選取 chapter-02.md').check()
    await page.getByLabel('選取 world/舊倉庫.md').check()
    await page.getByTestId('slima-import-run').click()
    await expect(page.getByTestId('slima-import-story')).toContainText('2 個檔案')
    await expect(page.getByTestId('slima-import-story')).toContainText('示範模式不花錢')
    await expect(page.getByTestId('slima-import-check')).toContainText('新增地點：舊倉庫')
    await page.getByTestId('slima-import-confirm').click()
    await expect(page.getByTestId('slima-import-summary')).toContainText('拆出')

    await page.getByTestId('slima-go-outline').click()
    await expect(page.getByTestId('act-card').first()).toBeVisible()
    await page.getByRole('button', { name: '場景卡' }).click()
    await expect(page.getByTestId('location-item-舊倉庫')).toBeVisible()
  })
})
