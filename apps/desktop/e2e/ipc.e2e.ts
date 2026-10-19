import { expect, test } from './fixtures'

test.describe('型別化 IPC', () => {
  test('app.ping 往返，並收到 app.pinged 事件', async ({ page }) => {
    const { result, event } = await page.evaluate(async () => {
      const received = new Promise<{ message: string }>((resolve) => {
        const off = window.svs.on('app.pinged', (payload) => {
          off()
          resolve(payload)
        })
      })
      const result = await window.svs.invoke('app.ping', { message: 'hello' })
      return { result, event: await received }
    })
    expect(result).toMatchObject({ ok: true, data: { pong: 'hello' } })
    expect(event.message).toBe('hello')
  })

  test('app.getInfo 回傳應用資訊', async ({ page }) => {
    const result = await page.evaluate(() => window.svs.invoke('app.getInfo', {}))
    expect(result).toMatchObject({
      ok: true,
      data: { name: 'Slima Video Studio', packaged: false },
    })
  })

  test('payload 格式錯誤回傳型別化錯誤，主行程不會 crash', async ({ page, app }) => {
    const bad = await page.evaluate(() =>
      (window.svs.invoke as (c: string, p: unknown) => Promise<unknown>)('app.ping', {
        message: 123,
      }),
    )
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_request' } })

    // 之後還能正常呼叫，且主行程仍然活著
    const ok = await page.evaluate(() => window.svs.invoke('app.ping', { message: 'still alive' }))
    expect(ok).toMatchObject({ ok: true })
    expect(await app.evaluate(({ app: a }) => a.isReady())).toBe(true)
  })

  test('沒有在合約定義的 channel 無法呼叫', async ({ page }) => {
    const result = await page.evaluate(() =>
      (window.svs.invoke as (c: string, p: unknown) => Promise<unknown>)('fs.readFile', {
        path: '/etc/passwd',
      }),
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown_channel' } })
  })

  test('renderer 只拿得到 invoke 與 on', async ({ page }) => {
    const keys = await page.evaluate(() => Object.keys(window.svs).sort())
    expect(keys).toEqual(['invoke', 'on'])
  })
})
