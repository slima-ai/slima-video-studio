import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { canvasNodes, centerOn } from './canvas-helpers'
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

/** 打開 App 的 MCP，用真的 MCP 用戶端連上來（＝AI 工具）。 */
async function connectAi(page: Page, userDataDir: string): Promise<Client> {
  const port = await freePort()
  const enabled = await page.evaluate(
    (p) => window.svs.invoke('settings.update', { mcp: { enabled: true, port: p } }),
    port,
  )
  expect(enabled.ok).toBe(true)
  const token = readFileSync(join(userDataDir, 'mcp-token'), 'utf8').trim()
  const client = new Client({ name: 'e2e-ai', version: '1' })
  // @ts-expect-error SDK 的 Transport 型別與 exactOptionalPropertyTypes 不相容（sessionId 等欄位）
  const transport: Transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${String(port)}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  )
  await client.connect(transport)
  return client
}

const idOf = (result: unknown): string => {
  const text = JSON.stringify(result).replaceAll('\\"', '"')
  const id = /"id":\s*"([^"]+)"/.exec(text)?.[1]
  if (!id) throw new Error('工具沒有回 id')
  return id
}

test.describe('畫布：AI 剛改過', () => {
  test('AI 工具（MCP）新增、修改鏡頭：節點亮一下、標「AI 剛改」；選取或滑過一下就收掉；刪了有提示可以復原', async ({
    page,
    userDataDir,
  }) => {
    const ai = await connectAi(page, userDataDir)
    await ai.callTool({ name: 'create_project', arguments: { name: 'AI 剛改' } })
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()

    // AI 新增一個鏡頭：鏡頭標「AI 剛改」、先亮一下；它的圖和影片不另外標
    const created = await ai.callTool({ name: 'create_shot', arguments: {} })
    const shotId = idOf(created)
    const shot = `shot:${shotId}`
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === shot)).toBe(true)
    const badge = page.getByTestId(`ai-badge-${shot}`)
    await expect(badge).toBeVisible()
    await expect(badge).toContainText('AI 剛改')
    await expect(page.getByTestId(`node-${shot}`)).toHaveAttribute('data-ai-flash', 'true')
    await expect(page.getByTestId(`ai-badge-${shot}:image`)).toHaveCount(0)
    await expect(page.getByTestId(`ai-badge-${shot}:video`)).toHaveCount(0)
    // 亮一下幾秒後停，小標記還在
    await expect(page.getByTestId(`node-${shot}`)).not.toHaveAttribute('data-ai-flash', 'true', {
      timeout: 6000,
    })
    await expect(badge).toBeVisible()

    // 使用者選取它＝看過了：標記收掉
    await centerOn(page, shot)
    await page.getByTestId(`node-${shot}`).click({ position: { x: 100, y: 16 } })
    await expect(badge).toHaveCount(0)

    // AI 改鏡頭描述：又標上；滑過一下（看過）就收掉
    await page.keyboard.press('Escape')
    await ai.callTool({
      name: 'update_shot',
      arguments: { shotId, description: '雨夜的屋簷下，貓縮成一團' },
    })
    await expect(badge).toBeVisible()
    await page.getByTestId(`node-${shot}`).hover({ position: { x: 100, y: 60 } })
    await expect(badge).toHaveCount(0, { timeout: 5000 })

    // AI 刪了這個鏡頭：提示寫「AI 刪了第 N 鏡，可以復原」；按復原就回來
    await ai.callTool({ name: 'delete_shots', arguments: { shotIds: [shotId] } })
    const toast = page.getByTestId('toast').filter({ hasText: 'AI 刪了' })
    await expect(toast).toContainText(/AI 刪了第 \d+ 鏡，可以復原/)
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === shot)).toBe(false)
    await toast.getByRole('button', { name: '復原' }).click()
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === shot)).toBe(true)
    await ai.close()
  })

  test('自己在畫布上做的事不會標「AI 剛改」', async ({ page, userDataDir }) => {
    const ai = await connectAi(page, userDataDir)
    await ai.callTool({ name: 'create_project', arguments: { name: '自己做' } })
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await page.getByTestId('empty-manual').click()
    await expect
      .poll(async () => (await canvasNodes(page)).some((n) => n.data.kind === 'shot'))
      .toBe(true)
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid^="ai-badge-"]')).toHaveCount(0)
    await ai.close()
  })
})
