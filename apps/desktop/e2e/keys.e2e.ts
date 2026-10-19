import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from './fixtures'
import { launchApp } from './launch'

const SECRET = 'sk-e2e-SECRETVALUE-abcd'

test.describe('服務金鑰保管', () => {
  test('填 Key → 重開 App → 狀態仍是已設定（末四碼），且明文不會出現在任何回傳', async ({
    userDataDir,
  }) => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'svs-e2e-vault-'))
    const vaultFile = join(vaultDir, 'vault.json')
    try {
      const first = await launchApp({ userDataDir, env: { SVS_TEST_VAULT_FILE: vaultFile } })
      const page1 = await first.app.firstWindow()
      await page1.waitForLoadState('domcontentloaded')
      const set = await page1.evaluate(
        (key) => window.svs.invoke('keys.set', { provider: 'fal', key }),
        SECRET,
      )
      expect(set).toEqual({ ok: true, data: { provider: 'fal', configured: true, last4: 'abcd' } })
      await first.app.close()

      const second = await launchApp({ userDataDir, env: { SVS_TEST_VAULT_FILE: vaultFile } })
      const page2 = await second.app.firstWindow()
      await page2.waitForLoadState('domcontentloaded')
      const listed = await page2.evaluate(() => window.svs.invoke('keys.list', {}))
      expect(listed).toMatchObject({
        ok: true,
        data: {
          keys: [
            { provider: 'fal', configured: true, last4: 'abcd' },
            { provider: 'openrouter', configured: false },
          ],
        },
      })
      expect(JSON.stringify(listed)).not.toContain('SECRETVALUE')

      const removed = await page2.evaluate(() =>
        window.svs.invoke('keys.delete', { provider: 'fal' }),
      )
      expect(removed).toEqual({ ok: true, data: { provider: 'fal', configured: false } })
      await second.app.close()
    } finally {
      rmSync(vaultDir, { recursive: true, force: true })
    }
  })

  test('格式不對的 Key 被拒絕，錯誤訊息不含 Key 內容', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.svs.invoke('keys.set', { provider: 'fal', key: 'has spaces SECRETVALUE' }),
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'key_invalid' } })
    expect(JSON.stringify(result)).not.toContain('SECRETVALUE')
  })
})
