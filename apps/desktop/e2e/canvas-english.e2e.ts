import type { Locator, Page } from '@playwright/test'
import { pseudoLocalize } from '@svs/schema'

import { canvasNodes, centerOn, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'
import { pick } from './pick'

// 英文介面：畫布上看得到的字不能有中文與全形標點（使用者自己寫的內容除外：這裡的故事也是英文）
// 還沒轉的是 PR 7 的範圍：復原清單裡的名字（主行程的 handlers）
const NOT_YET: string[] = []

const BAD = /[㐀-鿿，。：；（）、！？「」・]/u

async function scanBadText(page: Page): Promise<{ bad: string | undefined; length: number }> {
  return page.evaluate(
    ({ source, notYet }) => {
      const bad = new RegExp(source, 'u')
      // 畫布本身、跳出來的對話框、選單與提示；佇列面板與 Claude 對話是別支 PR 的範圍
      const roots = [
        ...document.querySelectorAll(
          '[data-testid="canvas-root"], [role="dialog"], [role="menu"], [data-testid="toast"], [data-testid="shortcuts-dialog"], [data-testid="run-confirm"], [data-testid="context-menu"], [data-testid="final-cut-panel"], [data-testid="trial-tab"], [data-testid="canvas-panel"]',
        ),
      ]
      const copies = roots.map((root) => {
        const copy = root.cloneNode(true) as HTMLElement
        // Claude 對話（chat-*）與鏡頭面板（shot-panel）是別支 PR 的範圍
        for (const el of copy.querySelectorAll(
          'textarea, input, [data-testid^="chat-"], [data-testid="shot-panel"]',
        ))
          el.remove()
        return copy
      })
      const text = copies.map((copy) => copy.textContent || '').join(' | ')
      const attrs = copies
        .flatMap((copy) => [
          ...copy.querySelectorAll('[title], [aria-label], [placeholder], [data-tip]'),
        ])
        .map((el) =>
          ['title', 'aria-label', 'placeholder', 'data-tip']
            .map((name) => el.getAttribute(name) ?? '')
            .join(' '),
        )
        .join(' | ')
      const all = `${text} | ${attrs}`
      const hits = [...all.matchAll(new RegExp(`\\S*${bad.source}+\\S*`, 'gu'))].map((m) => m[0])
      const left = [...new Set(hits)].filter(
        (hit) => hit !== '第' && !hit.endsWith('第') && !notYet.some((word) => hit.includes(word)),
      )
      return { bad: left.length === 0 ? undefined : left.join('\n'), length: text.trim().length }
    },
    { source: BAD.source, notYet: NOT_YET },
  )
}

/** 掃到的字至少要有幾個：實測最短的（一句話卡片）有 1,000 多個字；空的畫面（還沒載好）掃到的是空的，不能當成「沒有中文」。 */
const MIN_SCANNED_TEXT = 500

/**
 * 先等這個畫面一定有的標記元素出現（最多 15 秒，CI 慢也不誤紅），再斷言掃到的字夠多，才掃中文。
 * 不用「等一下再掃」：頁面沒載好時掃到空的會空過。
 */
async function expectCanvasClean(
  page: Page,
  label: string,
  marker: Locator,
  minLength = MIN_SCANNED_TEXT,
): Promise<void> {
  await expect(marker, `${label}：畫面沒有出現`).toBeVisible({ timeout: 15_000 })
  const { bad, length } = await scanBadText(page)
  expect(length, `${label}：掃到的字只有 ${String(length)} 個，畫面沒載好？`).toBeGreaterThan(
    minLength,
  )
  expect(bad, label).toBeUndefined()
}

test.describe('英文介面的畫布', () => {
  test.use({ appEnv: { SVS_LOCALE: 'en' } })

  test('掃描守門：畫布是空的就紅（不會把「沒掃到」當成「沒有中文」）', async ({ page }) => {
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await page.evaluate(() => {
      document.querySelector('[data-testid="canvas-root"]')?.replaceChildren()
    })
    await expect(expectCanvasClean(page, '空的', page.getByTestId('canvas-root'))).rejects.toThrow(
      '掃到的字只有',
    )
    await expect(
      expectCanvasClean(page, '沒有的標記', page.getByTestId('no-such-marker'), 0),
    ).rejects.toThrow('畫面沒有出現')
  })

  test('空畫布、一句話長出分鏡與影片、快捷鍵視窗：畫面上沒有中文', async ({ page }) => {
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await expectCanvasClean(page, '空畫布', page.getByTestId('empty-add-oneliner'))

    await page.getByTestId('empty-add-oneliner').click()
    await page.getByTestId('oneliner-story').fill('A cat finds a warm home on a rainy night')
    await page.getByTestId('oneliner-story').blur()
    await pick(page, 'oneliner-shots', '3')
    await pick(page, 'oneliner-duration', '3')
    await expectCanvasClean(page, '一句話卡片', page.getByTestId('oneliner-story'))
    // 一句話卡片的尺寸固定：英文字再長，故事輸入框也要完整露出來（不被下面那排壓扁、蓋住），整張卡的內容不超出卡片
    const layout = await page.evaluate(() => {
      const rect = (testId: string) =>
        document.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect()
      const story = rect('oneliner-story')
      const rows = ['oneliner-style', 'oneliner-shots', 'oneliner-duration', 'oneliner-aspect'].map(
        (id) => rect(id),
      )
      // 卡片裡每一個有字的元素（含最下面那句說明）的最低點
      const cardEl = document
        .querySelector('[data-testid="oneliner-story"]')
        ?.closest('.react-flow__node')
      let lowest = 0
      for (const el of cardEl?.querySelectorAll('*') ?? []) {
        if (el.children.length === 0 && el.textContent.trim() !== '') {
          lowest = Math.max(lowest, el.getBoundingClientRect().bottom)
        }
      }
      return {
        storyHeight:
          document.querySelector<HTMLElement>('[data-testid="oneliner-story"]')?.offsetHeight ?? 0,
        storyBottom: story?.bottom ?? 0,
        rowTops: rows.map((r) => r?.top ?? 0),
        lastBottom: lowest,
        cardBottom: cardEl?.getBoundingClientRect().bottom ?? 0,
      }
    })
    expect(layout.storyHeight, '故事輸入框被壓扁').toBeGreaterThanOrEqual(60)
    for (const top of layout.rowTops) {
      expect(top, '故事輸入框和下面那排重疊').toBeGreaterThanOrEqual(layout.storyBottom)
    }
    expect(layout.lastBottom, '一句話卡片的內容超出卡片').toBeLessThanOrEqual(layout.cardBottom + 1)
    await page.getByTestId('oneliner-generate').click()
    await expectCanvasClean(page, '執行確認', page.getByTestId('run-confirm'))
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'true')
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
      timeout: 60_000,
    })
    await expect(
      page.getByTestId('toast').filter({ hasText: 'Film ready — narration and music added' }),
    ).toBeVisible()
    expect(await kindCount(page, 'shot')).toBe(3)
    await expectCanvasClean(page, '長完之後', page.getByTestId('toast'))
    // 鏡頭卡上的景別與角度、一句話卡的畫風都是英文名稱（不是只有「沒有中文」）
    await expect(page.getByText(/Eye level/).first()).toBeVisible()
    await expect(page.getByTestId('oneliner-style')).toContainText('Realistic')

    // 卡片尺寸是固定的：「In: … Out: …」那一行在英文下也要放得下（不能被切掉；各作業系統的字體寬度不同，留一成的餘地）
    const cut = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="node-io"]')]
        .map((el) => ({ w: (el as HTMLElement).scrollWidth, c: (el as HTMLElement).clientWidth }))
        .filter((m) => m.w > m.c * 1.1),
    )
    expect(cut, 'In/Out 那一行被切掉').toEqual([])
    // 指定尾幀之後影片格的「吃」多一項（End）：這一行也要放得下
    const listed = await page.evaluate(() => window.svs.invoke('shots.list', {}))
    if (!listed.ok) throw new Error(listed.error.userMessage)
    const withHash = listed.data.shots[0]
    const assetHash = withHash?.firstFrames[0]?.assetHash
    if (!withHash || !assetHash) throw new Error('沒有首幀圖')
    await page.evaluate(
      ({ shotId, hash }) => window.svs.invoke('shots.setEndFrame', { shotId, assetHash: hash }),
      { shotId: withHash.id, hash: assetHash },
    )
    const video = (await canvasNodes(page)).find((n) => n.data.kind === 'video')
    if (!video) throw new Error('沒有影片格')
    await centerOn(page, video.id)
    await expect(page.getByTestId(`node-${video.id}`).getByTestId('io-vid-end')).toBeVisible()
    const cutWithEnd = await page.evaluate((id) => {
      const line = document.querySelector(`[data-testid="node-${id}"] [data-testid="node-io"]`)
      return line instanceof HTMLElement ? { w: line.scrollWidth, c: line.clientWidth } : undefined
    }, video.id)
    expect(cutWithEnd, '有尾幀的影片格').toBeDefined()
    expect(cutWithEnd && cutWithEnd.w > cutWithEnd.c * 1.1, '有尾幀時 In/Out 那一行被切掉').toBe(
      false,
    )
    // 步驟、右鍵選單、剪輯卡、鏡頭的面板
    const shots = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    const [first] = shots
    if (!first) throw new Error('沒有鏡頭')
    await centerOn(page, first.id)
    await page.getByTestId(`steps-toggle-${first.id}`).click()
    await centerOn(page, `${first.id}:step:refs`)
    await expectCanvasClean(
      page,
      '展開步驟',
      page.locator(`.react-flow__node[data-id="${first.id}:step:refs"]`),
    )
    await centerOn(page, first.id)
    await page.locator(`.react-flow__node[data-id="${first.id}"]`).click({
      button: 'right',
      position: { x: 60, y: 16 },
    })
    await expect(page.getByTestId('context-menu')).toBeVisible()
    await expectCanvasClean(page, '右鍵選單', page.getByTestId('context-menu'))
    await page.getByRole('menuitem', { name: 'Open panel' }).click()
    await expect(page.getByTestId('canvas-panel')).toBeVisible()
    await expectCanvasClean(page, '鏡頭的面板', page.getByTestId('canvas-panel'))
    await page.keyboard.press('Escape')
    await centerOn(page, 'cut')
    await expectCanvasClean(page, '剪輯卡', page.getByTestId('node-cut'))

    await page.getByTestId('help-menu').click()
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
    await expect(page.getByTestId('shortcuts-dialog')).toContainText(
      'On a Mac, use Cmd instead of Ctrl.',
    )
    await expectCanvasClean(page, '快捷鍵', page.getByTestId('shortcuts-dialog'))
  })
})

test.describe('假語系（字比英文更長）的畫布', () => {
  test.use({ appEnv: { SVS_LOCALE: 'en-XA' } })

  test('一句話卡片：字再長，故事輸入框也不被下面那排壓扁、蓋住', async ({ page }) => {
    await page
      .getByRole('button', { name: pseudoLocalize('Canvas'), exact: true })
      .first()
      .click()
    await page.getByTestId('empty-add-oneliner').click()
    await page.getByTestId('oneliner-story').fill('A cat finds a warm home on a rainy night')
    await page.getByTestId('oneliner-story').blur()
    const box = async (id: string) => page.getByTestId(id).boundingBox()
    const story = await box('oneliner-story')
    expect(story, '故事輸入框').not.toBeNull()
    // 畫布縮放過的話量到的高度會跟著縮，所以看排版的高度（offsetHeight）
    const layoutHeight = await page
      .getByTestId('oneliner-story')
      .evaluate((el) => (el as HTMLElement).offsetHeight)
    expect(layoutHeight, '故事輸入框被壓扁').toBeGreaterThanOrEqual(60)
    for (const id of ['oneliner-style', 'oneliner-shots', 'oneliner-duration', 'oneliner-aspect']) {
      const row = await box(id)
      expect(row?.y ?? 0, `故事輸入框和 ${id} 重疊`).toBeGreaterThanOrEqual(
        (story?.y ?? 0) + (story?.height ?? 0),
      )
    }
  })
})
