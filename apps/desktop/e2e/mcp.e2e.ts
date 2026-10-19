import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { expect, test } from './fixtures'

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const address = s.address()
      const port = typeof address === 'object' && address ? address.port : 0
      s.close(() => {
        resolve(port)
      })
    })
  })

test.describe('AI 工具連線（MCP）', () => {
  test('預設關閉；在設定頁打開後，AI 工具可以連上來建專案，App 的視窗跟著更新；關掉就斷線', async ({
    page,
    userDataDir,
  }, testInfo) => {
    await page.getByRole('button', { name: '設定' }).click()
    const section = page.getByTestId('mcp-section')
    await section.scrollIntoViewIfNeeded()
    await expect(page.getByTestId('mcp-enabled')).not.toBeChecked()
    await expect(page.getByTestId('mcp-allowance')).toHaveValue('0')
    await expect(page.getByTestId('mcp-connect')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('mcp-off.png') })

    // 先換一個不會跟別的程式撞的埠，再打開
    const port = await freePort()
    await page.getByTestId('mcp-port').fill(String(port))
    await section.getByRole('button', { name: '儲存' }).first().click()
    await expect(page.getByTestId('mcp-port')).toHaveValue(String(port))
    await page.getByTestId('mcp-enabled').check()
    await expect(page.getByTestId('mcp-connect')).toBeVisible()
    const shown = (await page.getByTestId('mcp-command').textContent()) ?? ''
    expect(shown).toContain(`http://127.0.0.1:${String(port)}/mcp`)
    const token = readFileSync(join(userDataDir, 'mcp-token'), 'utf8').trim()
    expect(shown).not.toContain(token) // 畫面上預設是遮蔽的
    await page.screenshot({ path: testInfo.outputPath('mcp-on.png') })

    // 沒帶 token 連不上
    const url = new URL(`http://127.0.0.1:${String(port)}/mcp`)
    const anonymous = await fetch(url, { method: 'POST', body: '{}' })
    expect(anonymous.status).toBe(401)

    // 帶 token：用 MCP 用戶端連上來，建一個專案
    const client = new Client({ name: 'e2e', version: '1' })
    // @ts-expect-error SDK 的 Transport 型別與 exactOptionalPropertyTypes 不相容（sessionId 等欄位）
    const transport: Transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
    await client.connect(transport)
    const created = await client.callTool({
      name: 'create_project',
      arguments: { name: '黑藤裂谷' },
    })
    expect(JSON.stringify(created)).toContain('黑藤裂谷')
    expect(JSON.stringify(created)).not.toContain(token)

    // App 的視窗：專案頁看得到它是現在開著的專案（不用重開 App）
    await page.getByRole('button', { name: '專案', exact: true }).click()
    await expect(page.getByTestId('project-current')).toContainText('黑藤裂谷')
    await page.screenshot({ path: testInfo.outputPath('mcp-project-created.png') })
    await client.close()

    // 關掉：連線立刻中斷
    await page.getByRole('button', { name: '設定' }).click()
    await page.getByTestId('mcp-enabled').uncheck()
    await expect(page.getByTestId('mcp-connect')).toHaveCount(0)
    await expect(fetch(url, { method: 'POST', body: '{}' })).rejects.toThrow()
  })
})
