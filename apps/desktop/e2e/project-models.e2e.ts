import { centerOn, generateAndOpenCanvas, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'

test.describe('設定頁：這個專案預設用什麼', () => {
  test('專案換影片模型：只影響這個專案、生成時用它；改回「跟著預設」就照上面的設定', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    // 關掉示範模式、填 fal.ai 的金鑰：才有好幾個影片模型可以選
    await page.evaluate(async () => {
      await window.svs.invoke('keys.set', { provider: 'fal', key: 'fal-e2e-project-0123456789' })
      await window.svs.invoke('settings.update', { demoMode: false })
    })
    const added = await page.evaluate(() => window.svs.invoke('canvas.add', { kind: 'shot' }))
    if (!added.ok) throw new Error(added.error.userMessage)
    await expect.poll(() => kindCount(page, 'shot')).toBe(4)
    const video = `${added.data.key}:video`

    await page.getByRole('button', { name: '設定' }).click()
    const section = page.getByTestId('project-models-section')
    await expect(section).toBeVisible()
    // 每一列一開始都跟著上面選的模型
    const row = page.getByTestId('project-model-i2v')
    await expect(row).toHaveAttribute('data-value', 'follow-app')
    await expect(row).toContainText('跟著預設（Kling 3.0 Standard）')

    await row.click()
    await page.getByTestId('project-model-i2v-option-fal/kling-3.0-pro').click()
    await expect(row).toHaveAttribute('data-value', 'fal/kling-3.0-pro')
    // 上面「使用的模型」（所有專案的預設）不變
    await expect(page.getByTestId('model-i2v')).toHaveAttribute(
      'data-value',
      'fal/kling-3.0-standard',
    )

    // 回畫布按 ▶：預設品質用的是這個專案選的
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await centerOn(page, video)
    await page.getByTestId(`run-${video}`).click()
    const dialog = page.getByTestId('run-confirm')
    await expect(page.getByTestId('quality-default')).toHaveAttribute('aria-checked', 'true')
    await expect(dialog).toContainText('Kling 3.0 Pro')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // 改回「跟著預設」：又照上面的設定
    await page.getByRole('button', { name: '設定' }).click()
    await expect(row).toHaveAttribute('data-value', 'fal/kling-3.0-pro')
    await row.click()
    await page.getByTestId('project-model-i2v-option-follow-app').click()
    await expect(row).toHaveAttribute('data-value', 'follow-app')
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await centerOn(page, video)
    await page.getByTestId(`run-${video}`).click()
    await expect(dialog).toContainText('Kling 3.0 Standard')
  })

  test('每個專案各記各的：換到另一個專案是跟著預設；開回原本的專案還是剛才選的', async ({
    page,
    projectDir,
  }) => {
    await page.evaluate(async (dir) => {
      await window.svs.invoke('keys.set', { provider: 'fal', key: 'fal-e2e-project-0123456789' })
      await window.svs.invoke('settings.update', { demoMode: false })
      await window.svs.invoke('project.create', { dir: `${dir}/甲.svsproj`, name: '甲' })
      await window.svs.invoke('models.setProject', { models: { i2v: 'fal/kling-3.0-pro' } })
      await window.svs.invoke('project.create', { dir: `${dir}/乙.svsproj`, name: '乙' })
    }, projectDir)
    const section = page.getByTestId('project-models-section')
    const row = page.getByTestId('project-model-i2v')

    await page.getByRole('button', { name: '設定' }).click()
    await expect(section).toContainText('只套用在「乙」')
    await expect(row).toHaveAttribute('data-value', 'follow-app')

    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await page.evaluate(
      (dir) => window.svs.invoke('project.open', { dir: `${dir}/甲.svsproj` }),
      projectDir,
    )
    await page.getByRole('button', { name: '設定' }).click()
    await expect(section).toContainText('只套用在「甲」')
    await expect(row).toHaveAttribute('data-value', 'fal/kling-3.0-pro')
  })

  test('沒開專案時不出現這個表格', async ({ page }) => {
    await page.evaluate(() => window.svs.invoke('project.close', {}))
    await page.getByRole('button', { name: '設定' }).click()
    await expect(page.getByTestId('models-section')).toBeVisible()
    await expect(page.getByTestId('project-models-section')).toHaveCount(0)
  })
})
