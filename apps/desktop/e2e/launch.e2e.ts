import { expect, test } from './fixtures'

test.describe('App 啟動', () => {
  test('啟動後看到導覽、中央與底部佇列；沒有選取時不佔右側面板', async ({ page }) => {
    await expect(page.getByTestId('layout-nav')).toBeVisible()
    await expect(page.getByTestId('layout-main')).toBeVisible()
    await expect(page.getByTestId('layout-panel')).toHaveAttribute('data-open', 'false')
    await expect(page.getByTestId('layout-queue')).toBeVisible()
    // 首頁是畫布
    await expect(page.getByTestId('canvas-root')).toBeVisible()
  })

  test('生成佇列平常收起（只留標題），可以展開與再收合', async ({ page }) => {
    const queue = page.getByTestId('queue-panel')
    await expect(queue).toHaveAttribute('data-collapsed', 'true')
    await expect(page.getByTestId('layout-queue')).toBeVisible()
    await page.getByRole('button', { name: '展開生成佇列' }).click()
    await expect(queue).toHaveAttribute('data-collapsed', 'false')
    await page.getByRole('button', { name: '收合生成佇列' }).click()
    await expect(queue).toHaveAttribute('data-collapsed', 'true')
  })

  test('主行程寫 log 且沒有 CSP 違規', async ({ page, readMainLog }) => {
    await expect(page.getByTestId('app-layout')).toBeVisible()
    await expect.poll(readMainLog).toContain('啟動')
    expect(readMainLog()).not.toContain('[CSP-VIOLATION]')
  })

  test('E2E 的 App 一定用記憶體金庫：絕不碰作業系統的鑰匙圈（macOS 會跳密碼視窗打擾使用者）', async ({
    page,
  }) => {
    await expect(page.getByTestId('app-layout')).toBeVisible()
    const listed = await page.evaluate(() => window.svs.invoke('keys.list', {}))
    expect(listed).toMatchObject({
      ok: true,
      data: { storage: { available: true, kind: 'memory' } },
    })
  })

  test('renderer 拿不到 Node / ipcRenderer', async ({ page }) => {
    const exposed = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      ipcRenderer: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
      svs: typeof (window as unknown as { svs?: unknown }).svs,
    }))
    expect(exposed).toEqual({
      require: 'undefined',
      process: 'undefined',
      ipcRenderer: 'undefined',
      svs: 'object',
    })
  })

  test('CSP 會擋下 inline script', async ({ page }) => {
    const violation = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener('securitypolicyviolation', (e) => {
            resolve(e.violatedDirective)
          })
          const script = document.createElement('script')
          script.textContent = 'window.__pwned = true'
          document.head.append(script)
        }),
    )
    expect(violation).toContain('script-src')
    expect(await page.evaluate(() => '__pwned' in window)).toBe(false)
  })

  test('關閉視窗後 App 結束（macOS 照慣例留在 Dock，點 Dock 圖示會重開視窗）', async ({
    app,
    page,
  }) => {
    await expect(page.getByTestId('app-layout')).toBeVisible()
    if (process.platform === 'darwin') {
      await page.close()
      await expect.poll(() => app.windows().length).toBe(0)
      // 主行程還活著；Dock 圖示被點時（activate）會重開視窗
      await app.evaluate(({ app: electronApp }) => {
        electronApp.emit('activate')
      })
      const reopened = await app.waitForEvent('window')
      await expect(reopened.getByTestId('app-layout')).toBeVisible()
      return
    }
    const closed = app.waitForEvent('close')
    await page.close()
    await closed
  })

  test('結束時主行程丟出沒接住的錯誤：照樣關得掉（不跳錯誤視窗），錯誤寫進 log', async ({
    app,
    page,
    readMainLog,
  }) => {
    await expect(page.getByTestId('app-layout')).toBeVisible()
    // 以前這種錯誤會讓 Electron 跳出錯誤視窗擋住結束（E2E 偶爾卡在關 App 就是這樣）
    await app.evaluate(({ app: electronApp }) => {
      electronApp.on('before-quit', () => {
        setTimeout(() => {
          throw new Error('結束時故意丟的錯誤')
        }, 0)
        void Promise.reject(new Error('結束時故意被拒的 Promise'))
      })
    })
    await app.close()
    const log = readMainLog()
    expect(log).toContain('主行程沒接住的錯誤：Error: 結束時故意丟的錯誤')
    expect(log).toContain('主行程沒接住的 Promise 錯誤：Error: 結束時故意被拒的 Promise')
    expect(log).toContain('結束：視窗都關了')
  })
})
