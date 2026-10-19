import { createProject, openProject } from '@svs/db'
import { makePng } from '@svs/test-utils'
import { join } from 'node:path'

import { expect, test } from './fixtures'

/** 在測試行程（純 Node）裡先建好專案與素材，再讓 App 開啟它。 */
async function prepareProject(dir: string): Promise<{ projectDir: string; hash: string }> {
  const projectDir = join(dir, '素材測試.svsproj')
  const handle = createProject({ dir: projectDir, name: '素材測試' }, { appVersion: 'e2e' })
  const { hash } = await handle.assets.put(makePng({ width: 48, height: 24 }), 'image/png')
  handle.close()
  return { projectDir, hash }
}

test.describe('素材庫與 svs-asset:// 協定', () => {
  test('renderer 能顯示素材庫裡的圖片', async ({ page, projectDir }) => {
    const { projectDir: dir, hash } = await prepareProject(projectDir)
    const opened = await page.evaluate((d) => window.svs.invoke('project.open', { dir: d }), dir)
    expect(opened).toMatchObject({ ok: true, data: { name: '素材測試' } })

    const size = await page.evaluate(
      (h) =>
        new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new Image()
          img.onload = () => {
            resolve({ w: img.naturalWidth, h: img.naturalHeight })
          }
          img.onerror = () => {
            reject(new Error('圖片載入失敗'))
          }
          img.src = `svs-asset://asset/${h}`
        }),
      hash,
    )
    expect(size).toEqual({ w: 48, h: 24 })
  })

  test('路徑穿越、不合法的網址與不存在的素材都被拒絕', async ({ app, page, projectDir }) => {
    const { projectDir: dir, hash } = await prepareProject(projectDir)
    await page.evaluate((d) => window.svs.invoke('project.open', { dir: d }), dir)

    // -1：Chromium 在網址解析階段就拒絕了（根本到不了我們的 handler）
    const statusOf = (url: string): Promise<number> =>
      app.evaluate(async ({ net }, u) => {
        try {
          return (await net.fetch(u)).status
        } catch {
          return -1
        }
      }, url)
    const rejected = [-1, 400]

    expect(await statusOf(`svs-asset://asset/${hash}`)).toBe(200)
    expect(rejected).toContain(await statusOf('svs-asset://../../etc/passwd'))
    expect(rejected).toContain(await statusOf('svs-asset://..%2F..%2Fetc%2Fpasswd'))
    expect(rejected).toContain(await statusOf(`svs-asset://asset/${hash}/../../etc/passwd`))
    expect(rejected).toContain(await statusOf(`svs-asset://asset/${hash}/x.png`))
    expect(rejected).toContain(await statusOf(`svs-asset://asset/${hash}.png`))
    expect(await statusOf(`svs-asset://asset/${'0'.repeat(64)}`)).toBe(404)
  })

  test('沒有開啟專案時所有素材請求都是 404', async ({ app, page }) => {
    const current = await page.evaluate(() => window.svs.invoke('project.current', {}))
    expect(current).toEqual({ ok: true, data: null })
    const status = await app.evaluate(
      async ({ net }) => (await net.fetch(`svs-asset://asset/${'a'.repeat(64)}`)).status,
    )
    expect(status).toBe(404)
  })

  test('專案 IPC：建立、取得目前專案、關閉；同一專案不能被開兩次', async ({ page, projectDir }) => {
    const dir = join(projectDir, '新專案.svsproj')
    const created = await page.evaluate(
      (d) => window.svs.invoke('project.create', { dir: d, name: '新專案' }),
      dir,
    )
    expect(created).toMatchObject({ ok: true, data: { name: '新專案', dir } })
    expect(await page.evaluate(() => window.svs.invoke('project.current', {}))).toMatchObject({
      ok: true,
      data: { name: '新專案' },
    })

    // 專案被 App 自己開著，測試行程這邊再開會被鎖擋下
    expect(() => openProject(dir, { appVersion: 'e2e' })).toThrow(/另一個視窗/)

    expect(await page.evaluate(() => window.svs.invoke('project.close', {}))).toEqual({
      ok: true,
      data: {},
    })
    expect(await page.evaluate(() => window.svs.invoke('project.current', {}))).toEqual({
      ok: true,
      data: null,
    })
    // 關閉後鎖釋放
    openProject(dir, { appVersion: 'e2e' }).close()
  })

  test('開啟不存在的專案回傳型別化錯誤', async ({ page, projectDir }) => {
    const result = await page.evaluate(
      (d) => window.svs.invoke('project.open', { dir: d }),
      join(projectDir, '不存在.svsproj'),
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'project_not_found' } })
  })
})
