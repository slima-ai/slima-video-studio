import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { canvasNodes, centerOn, clickEmpty, viewportOf, viewportSettled } from './canvas-helpers'
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
    // 滑鼠先離開再滑進來（上面點選時滑鼠就在那一格裡，不離開就不算「滑過」）
    await clickEmpty(page)
    await page.getByTestId(`node-${shot}`).hover({ position: { x: 100, y: 60 } })
    await expect(badge).toHaveCount(0, { timeout: 5000 })

    // AI 刪了這個鏡頭：提示寫「AI 刪了第 N 鏡「描述開頭」，按「復原」可以找回來」；按復原就回來
    await ai.callTool({ name: 'delete_shots', arguments: { shotIds: [shotId] } })
    const toast = page.getByTestId('toast').filter({ hasText: 'AI 刪了' })
    await expect(toast).toContainText(/AI 刪了第 \d+ 鏡「雨夜的屋簷下，貓…」，按「復原」可以找回來/)
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === shot)).toBe(false)
    await toast.getByRole('button', { name: '復原' }).click()
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === shot)).toBe(true)
    await ai.close()
  })

  test('使用者按 ⌘Z 退掉 Claude 的改動：那一格的「AI 剛改」一起拿掉；重做也不再標', async ({
    page,
    userDataDir,
  }) => {
    const ai = await connectAi(page, userDataDir)
    await ai.callTool({ name: 'create_project', arguments: { name: '復原拿掉標記' } })
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const shotId = idOf(await ai.callTool({ name: 'create_shot', arguments: {} }))
    const shot = `shot:${shotId}`
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === shot)).toBe(true)
    // 使用者看過新增的那一格（標記收掉）；Claude 再改描述：又標上
    await centerOn(page, shot)
    await page.getByTestId(`node-${shot}`).click({ position: { x: 100, y: 16 } })
    await expect(page.getByTestId(`ai-badge-${shot}`)).toHaveCount(0)
    // 點空白處取消選取：選取中的格子在畫面重新載入時會被當成「看過」，標記會被順手收掉，測不到復原這條
    await clickEmpty(page)
    await expect(page.getByTestId(`node-${shot}`)).not.toHaveClass(/selected/)
    await ai.callTool({
      name: 'update_shot',
      arguments: { shotId, description: '雨夜的屋簷下，貓縮成一團' },
    })
    await expect(page.getByTestId(`ai-badge-${shot}`)).toBeVisible()

    // 使用者按 ⌘Z（Ctrl+Z）：描述退回去，標記一起拿掉
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByTestId('toast').filter({ hasText: '已復原' })).toBeVisible()
    await expect(page.getByTestId(`node-${shot}`)).not.toContainText('雨夜的屋簷下')
    // 標記要靠「復原」拿掉，不是等它自己消失：等 3 秒，比任何計時都久
    await expect(page.getByTestId(`ai-badge-${shot}`)).toHaveCount(0, { timeout: 3000 })

    // 重做：描述回來，但那是使用者自己要的，不再標
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(page.getByTestId(`node-${shot}`)).toContainText('雨夜的屋簷下')
    await page.waitForTimeout(800)
    await expect(page.getByTestId(`ai-badge-${shot}`)).toHaveCount(0)
    await ai.close()
  })

  test('使用者看過那一格（滑過、點選）之後 Claude 又改：新的標記不會被先前滑過的計時收掉', async ({
    page,
    userDataDir,
  }) => {
    const ai = await connectAi(page, userDataDir)
    await ai.callTool({ name: 'create_project', arguments: { name: '舊計時' } })
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const shotId = idOf(await ai.callTool({ name: 'create_shot', arguments: {} }))
    const shot = `shot:${shotId}`
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === shot)).toBe(true)
    await expect(page.getByTestId(`ai-badge-${shot}`)).toBeVisible()
    // 滑鼠移進去（開始 1.2 秒的「滑過算看過」計時），馬上點選：標記收掉、移開
    await centerOn(page, shot)
    await page.getByTestId(`node-${shot}`).click({ position: { x: 100, y: 16 } })
    await expect(page.getByTestId(`ai-badge-${shot}`)).toHaveCount(0)
    await clickEmpty(page)
    // Claude 再改：標記重新標上，之後 3 秒（比 1.2 秒的計時久很多）都要還在
    await ai.callTool({
      name: 'update_shot',
      arguments: { shotId, description: '雨夜的屋簷下，貓縮成一團' },
    })
    await expect(page.getByTestId(`ai-badge-${shot}`)).toBeVisible()
    await page.waitForTimeout(3000)
    await expect(page.getByTestId(`ai-badge-${shot}`)).toBeVisible()
    await ai.close()
  })

  test('Claude 刪掉第 3 鏡：原本的第 4 鏡只是編號往前變成第 3 鏡，不標「AI 剛改」', async ({
    page,
    userDataDir,
  }, testInfo) => {
    const ai = await connectAi(page, userDataDir)
    await ai.callTool({ name: 'create_project', arguments: { name: '編號變了' } })
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      ids.push(idOf(await ai.callTool({ name: 'create_shot', arguments: {} })))
    }
    const keys = ids.map((id) => `shot:${id}`)
    await expect
      .poll(async () => (await canvasNodes(page)).filter((n) => keys.includes(n.id)).length)
      .toBe(4)
    // 使用者把每一格都看過（標記都收掉），Claude 才刪第 3 鏡
    for (const key of keys) {
      await centerOn(page, key)
      await page.getByTestId(`node-${key}`).click({ position: { x: 100, y: 16 } })
    }
    await clickEmpty(page)
    for (const key of keys) await expect(page.getByTestId(`ai-badge-${key}`)).toHaveCount(0)

    await ai.callTool({ name: 'delete_shots', arguments: { shotIds: [ids[2] ?? ''] } })
    await expect(page.getByTestId('toast').filter({ hasText: 'AI 刪了' })).toContainText(
      '1 個空的鏡頭',
    )
    const fourth = keys[3] ?? ''
    // 原本的第 4 鏡現在叫第 3 鏡，內容沒被改
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === fourth)?.data.title)
      .toContain('第 3 鏡')
    await page.waitForTimeout(800)
    await centerOn(page, fourth)
    await page.screenshot({ path: testInfo.outputPath('renumbered-not-marked.png') })
    for (const suffix of ['', ':image', ':video']) {
      await expect(page.getByTestId(`ai-badge-${fourth}${suffix}`)).toHaveCount(0)
    }
    await ai.close()
  })

  test('外面的 AI 工具連刪三個空鏡頭：不合成，每次一則；最後那則只說最後刪的那一個，按「復原」也只回來那一個', async ({
    page,
    userDataDir,
  }, testInfo) => {
    const ai = await connectAi(page, userDataDir)
    await ai.callTool({ name: 'create_project', arguments: { name: '空鏡頭' } })
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const keys: string[] = []
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const id = idOf(await ai.callTool({ name: 'create_shot', arguments: {} }))
      ids.push(id)
      keys.push(`shot:${id}`)
    }
    const present = async (): Promise<number> =>
      (await canvasNodes(page)).filter((n) => keys.includes(n.id)).length
    await expect.poll(present).toBe(3)
    // 三次呼叫、各刪一個
    for (const id of ids) await ai.callTool({ name: 'delete_shots', arguments: { shotIds: [id] } })
    await expect.poll(present).toBe(0)
    // 不是 Claude 對話那一輪：復原只退最後一步，提示只說最後刪的那一個，也沒有「這一輪」那句
    const toast = page.getByTestId('toast').filter({ hasText: 'AI 刪了' })
    await expect(toast).toHaveText(/^AI 刪了 1 個空的鏡頭，按「復原」可以找回來復原$/)
    await expect(toast).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('removed-toast.png') })
    await toast.getByRole('button', { name: '復原' }).click()
    await expect.poll(present).toBe(1)
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

  test('跟著 AI：AI 改到畫面外的東西，畫面平順移過去；可以關掉；使用者按著滑鼠時不搶畫面', async ({
    page,
    userDataDir,
  }) => {
    const ai = await connectAi(page, userDataDir)
    await ai.callTool({ name: 'create_project', arguments: { name: '跟著 AI' } })
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const shotId = idOf(await ai.callTool({ name: 'create_shot', arguments: {} }))
    const shot = `shot:${shotId}`
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === shot)).toBe(true)
    // AI 動過之後，右下角才出現「跟著 AI」開關，預設開
    const toggle = page.getByTestId('follow-ai')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')

    const awayFromShot = async (): Promise<void> => {
      await page.evaluate(() => {
        const rf = (
          window as unknown as {
            __svsCanvas?: { setViewport: (v: object) => Promise<boolean> }
          }
        ).__svsCanvas
        void rf?.setViewport({ x: -6000, y: -6000, zoom: 1 })
      })
      await viewportSettled(page)
    }

    // 開著：AI 改了這個鏡頭，畫面移過去，鏡頭看得到
    await awayFromShot()
    await expect(page.getByTestId(`node-${shot}`)).not.toBeInViewport()
    await ai.callTool({
      name: 'update_shot',
      arguments: { shotId, description: '貓跳上窗台' },
    })
    await expect(page.getByTestId(`node-${shot}`)).toBeInViewport({ ratio: 0.9 })
    await viewportSettled(page)

    // 使用者按著滑鼠的時候不搶畫面
    await awayFromShot()
    const before = await viewportOf(page)
    await page.mouse.move(700, 500)
    await page.mouse.down()
    await ai.callTool({
      name: 'update_shot',
      arguments: { shotId, description: '貓跳上窗台，看著雨' },
    })
    await page.waitForTimeout(1200)
    expect(await viewportOf(page)).toEqual(before)
    await page.mouse.up()

    // 關掉：AI 改了也不動
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await page.waitForTimeout(1700)
    await awayFromShot()
    const parked = await viewportOf(page)
    await ai.callTool({
      name: 'update_shot',
      arguments: { shotId, description: '貓睡著了' },
    })
    await page.waitForTimeout(1200)
    expect(await viewportOf(page)).toEqual(parked)
    await ai.close()
  })

  test.describe('跟著 AI：使用者在做事就不搶畫面', () => {
    /** 開專案、建 7 個鏡頭：第一個在畫面中央，最後一個在畫面外。 */
    const prepare = async (page: Page, userDataDir: string) => {
      const ai = await connectAi(page, userDataDir)
      await ai.callTool({ name: 'create_project', arguments: { name: '跟著 AI' } })
      await page.getByRole('button', { name: '畫布', exact: true }).click()
      await expect(page.getByTestId('canvas-root')).toBeVisible()
      const ids: string[] = []
      for (let i = 0; i < 7; i++) {
        ids.push(idOf(await ai.callTool({ name: 'create_shot', arguments: {} })))
      }
      const keys = ids.map((id) => `shot:${id}`)
      await expect
        .poll(async () => (await canvasNodes(page)).filter((n) => keys.includes(n.id)).length)
        .toBe(7)
      const [first] = keys
      const last = keys[keys.length - 1]
      if (!first || !last) throw new Error('沒有鏡頭')
      await centerOn(page, first)
      await viewportSettled(page)
      await expect(page.getByTestId(`node-${last}`)).not.toBeInViewport()
      return { ai, first, last, lastId: ids[ids.length - 1] ?? '' }
    }

    test('拖一個節點拖超過 2 秒，AI 在這時改畫面外的東西：畫面不動；放開再等一下才會跟著移', async ({
      page,
      userDataDir,
    }) => {
      const { ai, first, last, lastId } = await prepare(page, userDataDir)
      const box = await page.getByTestId(`node-${first}`).boundingBox()
      if (!box) throw new Error('找不到第一個鏡頭')
      const before = await viewportOf(page)
      await page.mouse.move(box.x + box.width / 2, box.y + 12)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 30, box.y + 12 + 20, { steps: 5 })
      // 拖到一半停很久（超過 1.5 秒），AI 才改畫面外那一鏡
      await page.waitForTimeout(2200)
      await ai.callTool({
        name: 'update_shot',
        arguments: { shotId: lastId, description: '拖到一半' },
      })
      await page.waitForTimeout(1200)
      expect(await viewportOf(page)).toEqual(before)
      await page.mouse.up()
      // 放開後還要再等 1.5 秒：馬上改也不動
      await ai.callTool({
        name: 'update_shot',
        arguments: { shotId: lastId, description: '剛放開' },
      })
      await page.waitForTimeout(800)
      expect(await viewportOf(page)).toEqual(before)
      // 等夠了就會跟過去
      await page.waitForTimeout(1500)
      await ai.callTool({
        name: 'update_shot',
        arguments: { shotId: lastId, description: '放開很久了' },
      })
      await expect(page.getByTestId(`node-${last}`)).toBeInViewport({ ratio: 0.9 })
      await ai.close()
    })

    test('使用者正在改鏡頭描述（打字），AI 改畫面外的東西：畫面不動、打的字不丟；寫完離開輸入框再等一下才會跟著移', async ({
      page,
      userDataDir,
    }) => {
      const { ai, first, last, lastId } = await prepare(page, userDataDir)
      const card = page.getByTestId(`node-${first}`)
      await card.getByTestId('shot-desc').dblclick()
      const edit = card.getByTestId('shot-desc-edit')
      await edit.fill('貓跳上窗台，')
      const before = await viewportOf(page)
      // 打字的時候停很久，AI 才改畫面外那一鏡
      await page.waitForTimeout(2200)
      await ai.callTool({
        name: 'update_shot',
        arguments: { shotId: lastId, description: '打字時' },
      })
      await page.waitForTimeout(1200)
      expect(await viewportOf(page)).toEqual(before)
      await page.keyboard.type('看著雨')
      await expect(edit).toHaveValue('貓跳上窗台，看著雨')
      // 離開輸入框（存檔）：馬上改還是不動，等夠了才跟過去
      await edit.press('Tab')
      await ai.callTool({
        name: 'update_shot',
        arguments: { shotId: lastId, description: '剛離開' },
      })
      await page.waitForTimeout(800)
      expect(await viewportOf(page)).toEqual(before)
      await page.waitForTimeout(1500)
      await ai.callTool({
        name: 'update_shot',
        arguments: { shotId: lastId, description: '離開很久了' },
      })
      await expect(page.getByTestId(`node-${last}`)).toBeInViewport({ ratio: 0.9 })
      await ai.close()
    })
  })
})

// 生成要一段時間（示範模式每一步慢 1.5 秒）：誰叫的生成，做完才有沒有「AI 剛改」
test.describe('畫布：背景生成做完，誰叫的就標誰', () => {
  test.use({ appEnv: { SVS_MOCK_LATENCY_MS: '1500' } })

  test('AI 改描述、叫首幀圖：生成中不標，做完只標有新結果的圖那一格；還沒生成的影片那一格不標；使用者自己按 ▶ 的不標', async ({
    page,
    userDataDir,
  }, testInfo) => {
    const ai = await connectAi(page, userDataDir)
    await ai.callTool({ name: 'create_project', arguments: { name: '背景生成' } })
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const shotId = idOf(
      await ai.callTool({
        name: 'create_shot',
        arguments: { description: '雨夜的屋簷下，貓縮成一團' },
      }),
    )
    const image = `shot:${shotId}:image`
    const video = `shot:${shotId}:video`
    await expect.poll(async () => (await canvasNodes(page)).some((n) => n.id === image)).toBe(true)
    await centerOn(page, image)
    await viewportSettled(page)

    // AI 改鏡頭描述：鏡頭那一格是 AI 直接改的，照標
    await ai.callTool({
      name: 'update_shot',
      arguments: { shotId, description: '小機器人坐在生鏽的旋轉木馬旁' },
    })
    await expect(page.getByTestId(`ai-badge-shot:${shotId}`)).toBeVisible()
    // AI 叫它生首幀圖：背景在做，圖那一格顯示進行中、影片那一格排隊等它
    await ai.callTool({ name: 'generate_first_frames', arguments: {} })
    const card = page.getByTestId(`node-${image}`)
    await expect(card.getByTestId('node-working')).toBeVisible()
    // 只是狀態跟著變（進行中、排隊中）的格子不標：圖還沒有結果，影片是因為上游在生成才變狀態
    await expect(page.getByTestId(`ai-badge-${image}`)).toHaveCount(0)
    await expect(page.getByTestId(`ai-badge-${video}`)).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('ai-generating.png') })

    // 做完：圖那一格有新結果，標「AI 剛改」、亮一下；影片那一格還是「還沒生成」，不標
    await expect(card.getByTestId('node-working')).toHaveCount(0, { timeout: 30_000 })
    const badge = page.getByTestId(`ai-badge-${image}`)
    await expect(badge).toBeVisible()
    await expect(badge).toContainText('AI 剛改')
    await expect(page.getByTestId(`node-${video}`)).toContainText('還沒生成')
    await expect(page.getByTestId(`ai-badge-${video}`)).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('ai-generated-marked.png') })

    // 使用者看過、再自己按 ▶ 重新生成：做完不標
    await card.click({ position: { x: 100, y: 16 } })
    await expect(badge).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByTestId(`run-${image}`).click()
    await page.getByTestId('run-confirm-ok').click()
    await expect(card.getByTestId('node-working')).toBeVisible()
    await expect(card.getByTestId('node-working')).toHaveCount(0, { timeout: 30_000 })
    await page.waitForTimeout(800)
    // 使用者自己叫的生成，圖那一格做完不標
    await expect(page.getByTestId(`ai-badge-${image}`)).toHaveCount(0)
    await ai.close()
  })
})

// 右下角的 Claude 對話（假的 claude）：焦點停在對話框時，AI 改畫面外的東西，畫面要跟過去
test.describe('跟著 AI：焦點在右下角的對話框', () => {
  test.use({ appEnv: { SVS_CLAUDE_BIN: join(__dirname, 'fake-claude/claude.mjs') } })

  test('使用者剛送出訊息、游標還在對話框（不在畫布裡），AI 改畫面外的鏡頭：畫面照樣跟過去', async ({
    page,
    userDataDir,
  }) => {
    const ai = await connectAi(page, userDataDir)
    await ai.callTool({ name: 'create_project', arguments: { name: '對話框焦點' } })
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const ids: string[] = []
    for (let i = 0; i < 7; i++) {
      ids.push(idOf(await ai.callTool({ name: 'create_shot', arguments: {} })))
    }
    const first = `shot:${ids[0] ?? ''}`
    const last = `shot:${ids[ids.length - 1] ?? ''}`
    await expect
      .poll(async () => (await canvasNodes(page)).filter((n) => n.id === last).length)
      .toBe(1)

    // 先把畫面放到第一鏡、最後一鏡在畫面外（之後都不再碰畫布，焦點才會一直留在對話框）
    await centerOn(page, first)
    await viewportSettled(page)
    // 打開對話面板、游標放進輸入框（像剛按下送出、還沒點別的地方）
    await page.getByTestId('chat-launcher').click()
    const input = page.getByTestId('chat-input')
    await expect(input).toBeVisible()
    await viewportSettled(page)
    await expect(page.getByTestId(`node-${last}`)).not.toBeInViewport()
    await input.click()
    await input.pressSequentially('把最後一鏡改一下')
    await expect(input).toBeFocused()
    // 從畫布移走焦點／點對話框之後，「剛離開」的緩衝是 1.5 秒：等它過去，剩下的才是「焦點在對話框」本身
    await page.waitForTimeout(1700)
    await expect(input).toBeFocused()

    await ai.callTool({
      name: 'update_shot',
      arguments: { shotId: ids[ids.length - 1] ?? '', description: '對話框還有游標時 AI 改的' },
    })
    await expect(page.getByTestId(`node-${last}`)).toBeInViewport({ ratio: 0.9 })
    // 輸入框的字沒被動到、游標還在
    await expect(input).toHaveValue('把最後一鏡改一下')
    await expect(input).toBeFocused()
    await ai.close()
  })
})
