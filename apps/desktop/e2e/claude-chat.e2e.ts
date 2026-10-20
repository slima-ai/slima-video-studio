import type { Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'

// 右下角的 Claude 對話：用假的 claude（e2e/fake-claude/claude.mjs，SVS_CLAUDE_BIN 指過去）走完整條路——
// 主程序起行程、用 --mcp-config 給的轉接去呼叫 App 真的 MCP，畫布真的長出東西。不花錢、不碰這台電腦的 Claude 登入。
const FAKE_CLAUDE = join(__dirname, 'fake-claude/claude.mjs')
test.use({ appEnv: { SVS_CLAUDE_BIN: FAKE_CLAUDE } })

/** 挑一個沒人用的埠給 MCP（幾個 worker 同時跑，不能搶預設埠）。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => {
        resolve(port)
      })
    })
  })
}

async function useFreeMcpPort(page: Page): Promise<void> {
  const port = await freePort()
  await page.evaluate(async (p) => {
    const result = await window.svs.invoke('settings.update', { mcp: { port: p } })
    if (!result.ok) throw new Error(result.error.userMessage)
  }, port)
}

/** 目前專案的復原還能退幾步。 */
async function undoCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const r = await window.svs.invoke('history.state', {})
    if (!r.ok) throw new Error(r.error.userMessage)
    return r.data.undoCount ?? 0
  })
}

/** 打開面板、（AI 工具連線沒開就一鍵打開）、等到輸入框出現。 */
async function openChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: '畫布', exact: true }).click()
  await page.getByTestId('chat-launcher').click()
  const enable = page.getByRole('button', { name: '打開 AI 工具連線' })
  await expect(enable.or(page.getByTestId('chat-input'))).toBeVisible()
  if (await enable.isVisible()) await enable.click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

test.describe('Claude 對話（假的 claude）', () => {
  test('按右下角的按鈕從右邊滑出面板；沒開 AI 工具連線先一鍵打開；說一句話，看得到它用的步驟，畫布真的長出鏡頭', async ({
    page,
  }, testInfo) => {
    await useFreeMcpPort(page)
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    const drawer = page.getByTestId('chat-drawer')
    await expect(drawer).toHaveAttribute('data-open', 'false')
    await page.getByTestId('chat-launcher').click()
    await expect(drawer).toHaveAttribute('data-open', 'true')
    // 面板占自己的位置，畫布還在左邊（看得到它在改什麼）
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    // 滑出要 0.3 秒：等寬度到位再量
    await expect.poll(async () => (await drawer.boundingBox())?.width ?? 0).toBeGreaterThan(300)
    const box = await drawer.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(1000)

    // 面板不能被別的東西蓋住：收起的「詳細面板」用 translateX 移到畫面外，沒被祖先裁掉就會移到抽屜上面，
    // 畫面一片空白，元素卻都「可見」（它是 inert，elementFromPoint 也點不到它，所以只能算裁切後的可見範圍）
    const covered = await page.evaluate(() => {
      const drawer = document.querySelector('[data-testid="chat-drawer"]')?.getBoundingClientRect()
      const panel = document.querySelector('[data-testid="layout-panel"]')
      if (!drawer || !panel) return true
      const r = panel.getBoundingClientRect()
      let box = { l: r.left, t: r.top, r: r.right, b: r.bottom }
      for (let el = panel.parentElement; el; el = el.parentElement) {
        const o = getComputedStyle(el).overflow
        if (o === 'visible') continue
        const c = el.getBoundingClientRect()
        box = {
          l: Math.max(box.l, c.left),
          t: Math.max(box.t, c.top),
          r: Math.min(box.r, c.right),
          b: Math.min(box.b, c.bottom),
        }
      }
      const w = Math.min(box.r, drawer.right) - Math.max(box.l, drawer.left)
      const h = Math.min(box.b, drawer.bottom) - Math.max(box.t, drawer.top)
      return w > 0 && h > 0
    })
    expect(covered).toBe(false)

    // 預設沒開 AI 工具連線：說明卡，一鍵打開
    await expect(page.getByTestId('chat-prereq')).toContainText('先打開「AI 工具連線」')
    await page.getByRole('button', { name: '打開 AI 工具連線' }).click()
    const input = page.getByTestId('chat-input')
    await expect(input).toBeVisible()

    await input.fill('幫我建一個專案，加兩個鏡頭')
    await input.press('Enter')
    await expect(page.getByTestId('chat-message-user')).toHaveText('幫我建一個專案，加兩個鏡頭')
    // 步驟：用的工具換成白話，做完打勾
    const steps = page.getByTestId('chat-step')
    await expect(steps).toHaveCount(3, { timeout: 30_000 })
    await expect(steps.nth(0)).toHaveText('建立專案')
    await expect(steps.nth(1)).toHaveText('建立鏡頭')
    await expect(steps.nth(2)).toHaveText('建立鏡頭')
    await expect(page.locator('[data-testid="chat-step"][data-status="done"]')).toHaveCount(3)
    await expect(page.getByTestId('chat-message-assistant')).toContainText(
      '已經建好專案「Claude 建的短片」，加了兩個鏡頭。',
    )
    await expect(page.getByTestId('chat-message-assistant')).toHaveAttribute('data-state', 'done')
    // 左邊的畫布真的有了兩個鏡頭，專案列是 Claude 建的名字
    await expect.poll(() => kindCount(page, 'shot'), { timeout: 15_000 }).toBe(2)
    await expect(page.getByTestId('project-name')).toHaveText('Claude 建的短片')
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath('claude-chat.png') })
    await drawer.screenshot({ path: testInfo.outputPath('claude-chat-drawer.png') })

    // 收起：面板滑回去，輸入框不能操作
    await page.getByTestId('chat-close').click()
    await expect(drawer).toHaveAttribute('data-open', 'false')
  })

  test('Claude 做事時，停止鈕和 Esc 都能中斷 Claude 現在做的事；中斷後同一個對話還能接著講', async ({
    page,
  }) => {
    await useFreeMcpPort(page)
    await openChat(page)
    const input = page.getByTestId('chat-input')
    await input.fill('做一件要很久的事')
    await input.press('Enter')
    await expect(page.getByTestId('chat-stop')).toBeVisible()
    await expect(page.getByTestId('chat-step')).toHaveText('正在等待生成完成…')
    await page.getByTestId('chat-stop').click()
    await expect(page.getByTestId('chat-stopped')).toBeVisible()
    await expect(page.getByTestId('chat-send')).toBeVisible()

    // 再來一次，這次用 Esc
    await input.fill('再做一件要很久的事')
    await input.press('Enter')
    await expect(page.getByTestId('chat-stop')).toBeVisible()
    await input.press('Escape')
    await expect(page.getByTestId('chat-stopped')).toHaveCount(2)

    // 行程還活著：接著講，照常回答
    await input.fill('你還記得嗎')
    await input.press('Enter')
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText('我記得')
  })

  test('用量到上限：出現「繼續」，按了用新行程接回同一個對話做完；對話沒有斷', async ({ page }) => {
    await useFreeMcpPort(page)
    await openChat(page)
    const input = page.getByTestId('chat-input')
    await input.fill('做很多事，用量會用完')
    await input.press('Enter')
    await expect(page.getByTestId('chat-error')).toContainText('用量到上限')
    await expect(page.getByTestId('chat-continue')).toBeVisible()
    await page.getByTestId('chat-continue').click()
    const reply = page.getByTestId('chat-message-assistant').last()
    await expect(reply).toContainText('只續做被打斷的那一句「做很多事，用量會用完」')
    await expect(reply).toContainText('接回同一個對話')
    // 只做被打斷那一句的事：一個步驟；沒有去做上一輪預告的影片、配樂、匯出
    await expect(reply.getByTestId('chat-step')).toHaveCount(1)
    await expect(reply).not.toContainText('影片')
    await expect(reply).not.toContainText('匯出')
    // 送出的話是「剛才那句「…」被用量上限打斷…不要做那句以外的事」，不是「接著剛才的做下去」
    const sent = page.getByTestId('chat-message-user').last()
    await expect(sent).toContainText('剛才那句「做很多事，用量會用完」被用量上限打斷')
    await expect(sent).toContainText('不要做那句以外的事')
    await expect(sent).not.toContainText('接著剛才')
    // 做完之後按鈕不見；對話還是同一個
    await expect(page.getByTestId('chat-continue')).toHaveCount(0)
    await expect(page.getByTestId('chat-message-user')).toHaveCount(2)
  })

  test('面板開著：空白畫布的三張開始卡都在面板左邊看得到（會換行，不被切掉）；提示往左讓開，不蓋住輸入欄與送出鈕', async ({
    page,
  }, testInfo) => {
    // 筆電常見的寬度：面板（380）一開，畫布只剩不到 850，三張卡排不下一行
    await page.setViewportSize({ width: 1280, height: 800 })
    await useFreeMcpPort(page)
    await openChat(page)
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    const drawer = await page.getByTestId('chat-drawer').boundingBox()
    if (!drawer) throw new Error('沒有面板')
    // 面板滑出的動畫播完（寬度是 380）
    await expect
      .poll(async () => (await page.getByTestId('chat-drawer').boundingBox())?.width)
      .toBe(380)
    const left = (await page.getByTestId('chat-drawer').boundingBox())?.x ?? 0
    // 三張卡（一步一步來、貼一段故事、一句話）每一張都完整在面板左邊
    for (const id of ['empty-manual', 'empty-paste-go', 'empty-add-oneliner']) {
      const card = page.getByTestId(id)
      await card.scrollIntoViewIfNeeded()
      const box = await card.boundingBox()
      expect(box, id).not.toBeNull()
      expect((box?.x ?? 0) + (box?.width ?? 0), `${id} 不被面板切掉`).toBeLessThanOrEqual(left + 1)
      expect(box?.x ?? -1, `${id} 不被左邊切掉`).toBeGreaterThanOrEqual(0)
    }
    // 提示：沒東西可以復原，按 ⌘Z 會跳「沒有可以復原的動作」；它不能蓋在面板上
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    const toast = page.getByTestId('toast').first()
    await expect(toast).toBeVisible()
    await expect
      .poll(async () => {
        const box = await toast.boundingBox()
        return (box?.x ?? 0) + (box?.width ?? 0)
      })
      .toBeLessThanOrEqual(left + 1)
    await page.screenshot({ path: testInfo.outputPath('chat-open-empty-canvas.png') })
    // 面板收起來之後，提示回到右下角
    await page.getByRole('button', { name: '收起 Claude 對話' }).click()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.chatDrawer))
      .toBeUndefined()
  })

  test('Claude 夾了一段對「USD budget」提示的英文碎碎念：畫面上收成一行小字，點了看得到原文；正式的回覆照常', async ({
    page,
  }) => {
    await useFreeMcpPort(page)
    await openChat(page)
    const input = page.getByTestId('chat-input')
    await input.fill('開始，碎碎念測試')
    await input.press('Enter')
    const reply = page.getByTestId('chat-message-assistant').last()
    await expect(reply).toContainText('好的，我開始了。')
    // 回覆文字裡沒有那句英文；收成一行小字，沒展開
    const notes = reply.getByTestId('chat-notes')
    await expect(notes).toContainText('Claude 的工作筆記（已收起）')
    await expect(reply.getByTestId('md')).not.toContainText('USD budget')
    await expect(notes.getByText('Ignore the session USD budget note?')).toBeHidden()
    // 點了展開：原文一個字都不少
    await notes.getByText('Claude 的工作筆記（已收起）').click()
    await expect(
      notes.getByText("Ignore the session USD budget note? It's the agent budget. Let's start."),
    ).toBeVisible()
  })

  test('Claude 回 Markdown：表格、粗體、清單照樣子顯示；裡面夾的 HTML 只是字，不會執行', async ({
    page,
  }, testInfo) => {
    await useFreeMcpPort(page)
    await openChat(page)
    const input = page.getByTestId('chat-input')
    await input.fill('給我一個表格')
    await input.press('Enter')
    const reply = page.getByTestId('chat-message-assistant').last()
    await expect(reply.getByTestId('md-table')).toBeVisible({ timeout: 30_000 })
    await expect(reply.locator('th')).toHaveText(['#', '景別', '秒數'])
    await expect(reply.locator('td strong')).toHaveText('大遠景')
    await expect(reply.locator('li')).toHaveCount(2)
    await expect(reply.locator('code')).toHaveText('角色卡')
    // 沒有原始標記留在畫面上
    await expect(reply).not.toContainText('|---|')
    await expect(reply).not.toContainText('**')
    // HTML 只是字：沒有 img，頁面標題沒被改
    await expect(reply.locator('img')).toHaveCount(0)
    await expect(reply).toContainText('<img src=x onerror=')
    expect(await page.title()).not.toBe('pwned')
    await page.getByTestId('chat-drawer').screenshot({ path: testInfo.outputPath('markdown.png') })
  })

  test('對話紀錄存在專案資料夾；另存為連 chat/ 一起複製，複本裡看得到舊對話、接著講會分出新的 session，原本專案的紀錄沒被動', async ({
    page,
  }) => {
    await useFreeMcpPort(page)
    await openChat(page)
    const input = page.getByTestId('chat-input')
    await input.fill('幫我建一個專案，加兩個鏡頭')
    await input.press('Enter')
    await expect(page.getByTestId('chat-message-assistant').last()).toHaveAttribute(
      'data-state',
      'done',
      { timeout: 30_000 },
    )
    // 紀錄寫在專案資料夾的 chat/（一個對話一個檔，第一行是版本）
    const original = await page.evaluate(async () => {
      const result = await window.svs.invoke('project.status', {})
      if (!result.ok || !result.data) throw new Error('沒有專案')
      return result.data.dir
    })
    const files = readdirSync(join(original, 'chat'))
    expect(files).toHaveLength(1)
    const text = readFileSync(join(original, 'chat', files[0] ?? ''), 'utf8')
    expect(text.split('\n')[0]).toBe('{"v":1}')
    expect(text).toContain('幫我建一個專案，加兩個鏡頭')
    // 不存 token、帳號、思考之類的東西
    expect(text).not.toMatch(/token|api[_-]?key|email|thinking/i)

    // 另存為：切到複本，面板重讀；複本的 chat/ 有同一份，舊對話的字還在
    const copy = await page.evaluate(async () => {
      const result = await window.svs.invoke('project.saveAs', { name: '複本專案' })
      if (!result.ok) throw new Error(result.error.userMessage)
      return result.data.dir
    })
    expect(readdirSync(join(copy, 'chat'))).toEqual(files)
    await expect(page.getByTestId('chat-message-user').first()).toHaveText(
      '幫我建一個專案，加兩個鏡頭',
    )
    await page.getByTestId('chat-input').fill('你還記得嗎')
    await page.getByTestId('chat-input').press('Enter')
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText(
      '分出新的 session',
      { timeout: 30_000 },
    )
    // 原本專案的紀錄還是原樣（沒有多出複本裡才說的話）
    expect(readFileSync(join(original, 'chat', files[0] ?? ''), 'utf8')).not.toContain('你還記得嗎')
    expect(readFileSync(join(copy, 'chat', files[0] ?? ''), 'utf8')).toContain('你還記得嗎')
  })

  test('Claude 一輪的改動合成一步復原：建 2 個鏡頭，按一次復原（或 ⌘Z）全退', async ({ page }) => {
    await useFreeMcpPort(page)
    await openChat(page)
    const input = page.getByTestId('chat-input')
    await input.fill('幫我建一個專案，加兩個鏡頭')
    await input.press('Enter')
    await expect(page.getByTestId('chat-message-assistant').last()).toHaveAttribute(
      'data-state',
      'done',
      { timeout: 30_000 },
    )
    await expect.poll(() => kindCount(page, 'shot'), { timeout: 15_000 }).toBe(2)
    expect(await undoCount(page)).toBe(1)
    await page.mouse.click(600, 600)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => kindCount(page, 'shot')).toBe(0)
    // 重做：整輪一起回來
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(() => kindCount(page, 'shot')).toBe(2)
  })

  test('一輪做到一半被停止：已經做的改動也是一步就能退', async ({ page }) => {
    await useFreeMcpPort(page)
    await openChat(page)
    const input = page.getByTestId('chat-input')
    await input.fill('做一半就停')
    await input.press('Enter')
    await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => kindCount(page, 'shot'), { timeout: 15_000 }).toBe(1)
    await page.getByTestId('chat-stop').click()
    await expect(page.getByTestId('chat-stopped')).toBeVisible()
    expect(await undoCount(page)).toBe(1)
    await page.getByRole('button', { name: /復原/ }).first().click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(0)
  })

  test('Claude 還在做的時候使用者自己動手：他的操作自己一步，復原只退他最後做的那一步；Claude 那一步不被併進去', async ({
    page,
  }) => {
    await useFreeMcpPort(page)
    await openChat(page)
    const input = page.getByTestId('chat-input')
    await input.fill('做一半就停')
    await input.press('Enter')
    await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => kindCount(page, 'shot'), { timeout: 15_000 }).toBe(1)
    // Claude 還在等（沒收尾）：使用者自己加了一個鏡頭
    await page.evaluate(async () => {
      const r = await window.svs.invoke('canvas.add', { kind: 'shot' })
      if (!r.ok) throw new Error(r.error.userMessage)
    })
    await expect.poll(() => kindCount(page, 'shot')).toBe(2)
    expect(await undoCount(page)).toBe(2)
    // 復原：只退使用者自己加的那個，Claude 做的那個還在
    await page.getByRole('button', { name: /復原/ }).first().click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(1)
    await expect(page.getByTestId('chat-stop')).toBeVisible()
  })

  test('Claude 還在做、最上面一步是它的：按復原先不動，說「Claude 正在改」；它做完或被停止之後才能退整輪', async ({
    page,
  }) => {
    await useFreeMcpPort(page)
    await openChat(page)
    const input = page.getByTestId('chat-input')
    await input.fill('做一半就停')
    await input.press('Enter')
    await expect(page.getByTestId('chat-stop')).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => kindCount(page, 'shot'), { timeout: 15_000 }).toBe(1)
    await page.getByRole('button', { name: /復原/ }).first().click()
    await expect(page.getByText('Claude 正在改這個專案')).toBeVisible()
    // 什麼都沒退
    expect(await kindCount(page, 'shot')).toBe(1)
    expect(await undoCount(page)).toBe(1)
    // 按停止之後就能退
    await page.getByTestId('chat-stop').click()
    await expect(page.getByTestId('chat-stopped')).toBeVisible()
    await page.getByRole('button', { name: /復原/ }).first().click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(0)
  })

  test('使用者自己的操作照舊：一個動作一步，按一次復原只退一個', async ({ page }) => {
    await useFreeMcpPort(page)
    await openChat(page)
    // 使用者自己加兩個鏡頭（跟畫布按鈕走同一條路）：兩步
    const addShot = (): Promise<void> =>
      page.evaluate(async () => {
        const r = await window.svs.invoke('canvas.add', { kind: 'shot' })
        if (!r.ok) throw new Error(r.error.userMessage)
      })
    await addShot()
    await addShot()
    await expect.poll(() => kindCount(page, 'shot')).toBe(2)
    expect(await undoCount(page)).toBe(2)
    await page.getByRole('button', { name: /復原/ }).first().click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(1)
    expect(await undoCount(page)).toBe(1)
  })

  test('行程當掉：說明連線中斷（不貼原始錯誤），再講一句會接著上次的對話', async ({ page }) => {
    await useFreeMcpPort(page)
    await openChat(page)
    const input = page.getByTestId('chat-input')
    await input.fill('讓它壞掉')
    await input.press('Enter')
    await expect(page.getByTestId('chat-error')).toContainText('連線中斷')
    await input.fill('你還記得嗎')
    await input.press('Enter')
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText('我記得')
  })
})

test.describe('Claude 對話：還不能用時', () => {
  test.use({ appEnv: { SVS_CLAUDE_BIN: join(__dirname, 'fake-claude/claude-logged-out.mjs') } })

  test('沒登入：說明卡請他先登入，不顯示輸入框', async ({ page }) => {
    await useFreeMcpPort(page)
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await page.getByTestId('chat-launcher').click()
    await page.getByRole('button', { name: '打開 AI 工具連線' }).click()
    await expect(page.getByTestId('chat-prereq')).toContainText('請先登入 Claude Code')
    await expect(page.getByTestId('chat-input')).toHaveCount(0)
  })
})
