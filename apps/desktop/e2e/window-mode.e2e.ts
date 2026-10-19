import { expect, test } from './fixtures'

test.describe('測試用的 App 視窗（安靜模式）', () => {
  // 不管在哪裡跑，這個測試都明確開安靜模式（CI 預設不開）
  test.use({ appEnv: { SVS_QUIET_WINDOWS: '1' } })

  test('E2E 預設開出的視窗：看不到（透明）、不能拿焦點，但照常繪製（截圖是真的畫面）', async ({
    app,
    page,
  }, testInfo) => {
    const windowInfo = () =>
      app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) return undefined
        return {
          focusable: win.isFocusable(),
          visible: win.isVisible(),
          opacity: win.getOpacity(),
        }
      })
    // ready-to-show 之後才會顯示（showInactive）
    await expect.poll(async () => (await windowInfo())?.visible).toBe(true)
    const info = await windowInfo()
    // 視窗存在、顯示中，但完全透明（看不到）、不能拿焦點（macOS 會把視窗夾回螢幕內，所以不能靠「放到螢幕外」）
    expect(info?.focusable).toBe(false)
    expect(info?.opacity).toBe(0)
    // 繪製沒有停：畫面載入完成、截圖不是空白
    await expect(page.getByTestId('app-layout')).toBeVisible()
    const shot = await page.screenshot({ path: testInfo.outputPath('quiet-window.png') })
    expect(shot.length).toBeGreaterThan(5_000)
  })
})
