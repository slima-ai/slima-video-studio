import type { Locator, Page } from '@playwright/test'

import { canvasNodes, centerOn, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'
import { pick } from './pick'

// 英文介面：大綱、分鏡表、角色、場景卡、生成紀錄、檔案、設定、佇列、鏡頭面板的畫面上不能有中文與全形標點。
// 還沒轉的是別支 PR 的範圍：畫風名稱與景別、角度的名稱（schema／workflows 的標籤）、示範驅動拆出來的鏡頭標題與縮圖上的字——轉完就從這裡拿掉。
// 還沒轉的是 PR 7 的範圍：示範 AI 拆鏡的「工作說明」是送給模型的提示詞（故事：…請拆成 N 個鏡頭）
const NOT_YET = [
  // 生成佇列的任務說明直接列出送給模型的提示詞，畫風那一段（styles.ts 的 fragment）目前是中文
  '寫實電影質感',
  '故事：',
  '請拆成',
  '個鏡頭',
  // 語言選單上的各語言的名字本來就是用那個語言寫的
  '繁體中文',
]

const BAD = /[㐀-鿿，。：；（）、！？「」・]/u

/**
 * 下拉選單的字放得下嗎：量文字寬度（用選單自己的字型），跟選單內容區的寬度比。
 * allOptions=true 量每一個選項（欄寬要放得下最長的），否則只量現在選的那個。回傳放不下的字。
 */
async function selectTextTooWide(
  page: Page,
  testId: string,
  allOptions: boolean,
): Promise<string[]> {
  return page.evaluate(
    ({ testId, allOptions }) => {
      const out: string[] = []
      const canvas = document.createElement('canvas').getContext('2d')
      if (!canvas) return ['沒有 canvas']
      const selects = document.querySelectorAll<HTMLSelectElement>(`[data-testid="${testId}"]`)
      if (selects.length === 0) return [`${testId}: 畫面上沒有這個選單（還沒載入？）`]
      for (const el of selects) {
        const style = getComputedStyle(el)
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        // 左右 padding 與右邊的下拉箭頭（約 20px）
        const room =
          el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20
        const labels = allOptions
          ? [...el.options].map((o) => o.text)
          : [el.selectedOptions[0]?.text ?? '']
        for (const label of labels) {
          if (canvas.measureText(label).width > room) out.push(`${testId}: ${label}`)
        }
      }
      return out
    },
    { testId, allOptions },
  )
}

async function badText(page: Page): Promise<string | undefined> {
  return page.evaluate(
    ({ source, notYet }) => {
      const bad = new RegExp(source, 'u')
      const copy = document.body.cloneNode(true) as HTMLElement
      // 使用者自己寫的內容（輸入框）與畫布上節點的內容不算；畫布另外有自己的 e2e
      for (const el of copy.querySelectorAll(
        'textarea, input, .react-flow, [data-testid="canvas-root"]',
      ))
        el.remove()
      const attrs = [
        ...copy.querySelectorAll('[title], [aria-label], [placeholder], [data-tip], img[alt]'),
      ]
        .map((el) =>
          ['title', 'aria-label', 'placeholder', 'data-tip', 'alt']
            .map((n) => el.getAttribute(n) ?? '')
            .join(' '),
        )
        .join(' | ')
      const all = `${copy.textContent || ''} | ${attrs}`
      const hits = [...all.matchAll(new RegExp(`\\S*${bad.source}+\\S*`, 'gu'))].map((m) => m[0])
      const left = [...new Set(hits)].filter(
        (hit) => hit !== '第' && !hit.endsWith('第') && !notYet.some((word) => hit.includes(word)),
      )
      return left.length === 0 ? undefined : left.join('\n')
    },
    { source: BAD.source, notYet: NOT_YET },
  )
}

/** 畫面上看得到的字有多長（掃描有沒有掃到東西）。 */
const pageTextLength = (page: Page): Promise<number> =>
  page.evaluate(() => document.body.innerText.trim().length)

/**
 * 先等「這一頁一定有的標記元素」出現（頁頭的頁名），再掃中文；掃到的字太少就紅：
 * 頁面還沒載好時掃到的是空的，會被當成「沒有中文」而空過。
 */
async function expectPageClean(
  page: Page,
  label: string,
  marker: Locator,
  markerText: string,
  minLength = MIN_PAGE_TEXT,
): Promise<void> {
  await expect(marker, `${label}：頁面沒有載入`).toContainText(markerText)
  const length = await pageTextLength(page)
  expect(length, `${label}：掃到的字只有 ${String(length)} 個，頁面沒載好？`).toBeGreaterThan(
    minLength,
  )
  expect(await badText(page), label).toBeUndefined()
}

/** 一頁（連側邊欄）至少該有的字數：沒有專案時最短的一頁（Locations）也有 380 多個字，空頁（只剩側邊欄）不到 150。 */
const MIN_PAGE_TEXT = 250

const PAGES: readonly { nav: string; header: string }[] = [
  { nav: 'Outline', header: 'Outline' },
  { nav: 'Storyboard', header: 'Storyboard' },
  { nav: 'Characters', header: 'Characters' },
  { nav: 'Locations', header: 'Locations' },
  { nav: 'Records', header: 'Generation records' },
  { nav: 'Files', header: 'Files' },
]

test.describe('英文介面的各頁', () => {
  test.use({ appEnv: { SVS_LOCALE: 'en' } })

  test('沒有專案：每一頁都沒有中文', async ({ page }) => {
    for (const { nav, header } of [...PAGES, { nav: 'Settings', header: 'Settings' }]) {
      await page.getByRole('button', { name: nav, exact: true }).click()
      await expectPageClean(page, `${nav}（沒有專案）`, page.getByTestId('page-header'), header)
    }
  })

  test('掃描守門：頁面是空的就紅（不會把「沒掃到」當成「沒有中文」）', async ({ page }) => {
    await page.getByRole('button', { name: 'Records', exact: true }).click()
    await expect(page.getByTestId('page-header')).toContainText('Generation records')
    await page.evaluate(() => {
      document.body.replaceChildren()
    })
    await expect(expectPageClean(page, '空頁', page.locator('body'), '')).rejects.toThrow(
      '掃到的字只有',
    )
    // 頁頭不是這一頁的（標記不對）也紅
    await page.reload()
    await expect(
      expectPageClean(page, '錯的頁', page.getByTestId('page-header'), 'No such page', 0),
    ).rejects.toThrow('頁面沒有載入')
  })

  test('有專案與內容：大綱、分鏡表（表格與故事板）、紀錄、檔案、佇列、鏡頭面板沒有中文', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 860 })
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await page.getByTestId('empty-add-oneliner').click()
    await page.getByTestId('oneliner-story').fill('A cat finds a warm home on a rainy night')
    await page.getByTestId('oneliner-story').blur()
    await pick(page, 'oneliner-shots', '3')
    await pick(page, 'oneliner-duration', '3')
    await page.getByTestId('oneliner-generate').click()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'true')
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
      timeout: 60_000,
    })

    for (const { nav, header } of PAGES) {
      await page.getByRole('button', { name: nav, exact: true }).click()
      await expectPageClean(page, nav, page.getByTestId('page-header'), header)
    }
    // 分鏡表：景別、角度、運鏡的名稱每一個都要放得下欄寬（英文比中文長）
    await page.getByRole('button', { name: 'Storyboard', exact: true }).click()
    await expect(page.getByTestId('cell-size').first()).toBeVisible()
    for (const testId of ['cell-size', 'cell-angle', 'cell-camera']) {
      expect(await selectTextTooWide(page, testId, true), `分鏡表 ${testId}`).toEqual([])
    }
    // 分鏡表的故事板檢視
    await page.getByTestId('storyboard-view-board').click()
    await expect(page.getByTestId('cell-board-size').first()).toBeVisible()
    await expectPageClean(page, '故事板', page.getByTestId('page-header'), 'Storyboard')
    // 分鏡卡的景別、角度（現在選的那個）放得下，不是「Eye l…」
    for (const testId of ['cell-board-size', 'cell-board-angle']) {
      expect(await selectTextTooWide(page, testId, false), `分鏡卡 ${testId}`).toEqual([])
    }
    // 佇列面板展開
    await page.getByTestId('queue-panel').getByRole('button').first().click()
    await expect(page.getByTestId('queue-toggle')).toHaveAttribute('aria-expanded', 'true')
    await expectPageClean(page, '佇列面板', page.getByTestId('queue-panel'), 'Done')
    // 鏡頭面板（畫布上選一個鏡頭、按 Enter 開）
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    // 畫布節點是切回畫布之後才載入的：等到有鏡頭節點再找（CI 的機器慢，立刻找會是空的）
    await expect
      .poll(async () => await kindCount(page, 'shot'), { timeout: 15_000 })
      .toBeGreaterThan(0)
    const shot = (await canvasNodes(page)).find((n) => n.data.kind === 'shot')
    if (!shot) throw new Error('沒有鏡頭')
    await centerOn(page, shot.id)
    await page
      .locator(`.react-flow__node[data-id="${shot.id}"]`)
      .click({ button: 'right', position: { x: 60, y: 16 } })
    await page.getByRole('menuitem', { name: 'Open panel' }).click()
    await expect(page.getByTestId('canvas-panel')).toBeVisible()
    await expectPageClean(
      page,
      '鏡頭面板',
      page.getByTestId('canvas-panel'),
      'What happens in this shot',
    )
  })
})
