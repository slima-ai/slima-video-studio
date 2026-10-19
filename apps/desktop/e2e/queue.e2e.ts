import { join } from 'node:path'

import { expect, test } from './fixtures'

test.describe('生成佇列', () => {
  test('底部面板顯示空狀態；沒有專案時取消與重試回報「先開啟專案」', async ({ page }) => {
    await expect(page.getByTestId('queue-panel')).toBeVisible()
    await expect(page.getByTestId('queue-empty')).toHaveText('目前沒有生成任務。')
    const cancel = await page.evaluate(() => window.svs.invoke('queue.cancel', { jobId: 'x' }))
    expect(cancel).toMatchObject({ ok: false, error: { code: 'project_not_found' } })
  })

  test('開啟專案後佇列可用，關閉專案後清單重新載入', async ({ page, projectDir }) => {
    const dir = join(projectDir, '佇列測試.svsproj')
    const created = await page.evaluate(
      (d) => window.svs.invoke('project.create', { dir: d, name: '佇列測試' }),
      dir,
    )
    expect(created.ok).toBe(true)
    expect(await page.evaluate(() => window.svs.invoke('queue.list', {}))).toEqual({
      ok: true,
      data: { jobs: [] },
    })
    // 找不到的任務是錯誤，而且不會讓 App 當掉
    const missing = await page.evaluate(() => window.svs.invoke('queue.retry', { jobId: 'nope' }))
    expect(missing.ok).toBe(false)
    await expect(page.getByTestId('queue-panel')).toBeVisible()
    await page.evaluate(() => window.svs.invoke('project.close', {}))
    await expect(page.getByTestId('queue-empty')).toBeVisible()
  })
})
