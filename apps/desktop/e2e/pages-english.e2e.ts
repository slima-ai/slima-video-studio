import type { Page } from '@playwright/test'

import { canvasNodes, centerOn } from './canvas-helpers'
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
      for (const el of document.querySelectorAll<HTMLSelectElement>(`[data-testid="${testId}"]`)) {
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

test.describe('英文介面的各頁', () => {
  test.use({ appEnv: { SVS_LOCALE: 'en' } })

  test('沒有專案：每一頁都沒有中文', async ({ page }) => {
    for (const name of [
      'Outline',
      'Storyboard',
      'Characters',
      'Locations',
      'Records',
      'Files',
      'Settings',
    ]) {
      await page.getByRole('button', { name, exact: true }).click()
      await page.waitForTimeout(400)
      expect(await badText(page), `${name}（沒有專案）`).toBeUndefined()
    }
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

    for (const name of ['Outline', 'Storyboard', 'Characters', 'Locations', 'Records', 'Files']) {
      await page.getByRole('button', { name, exact: true }).click()
      await page.waitForTimeout(600)
      expect(await badText(page), name).toBeUndefined()
    }
    // 分鏡表：景別、角度、運鏡的名稱每一個都要放得下欄寬（英文比中文長）
    await page.getByRole('button', { name: 'Storyboard', exact: true }).click()
    await page.waitForTimeout(400)
    for (const testId of ['cell-size', 'cell-angle', 'cell-camera']) {
      expect(await selectTextTooWide(page, testId, true), `分鏡表 ${testId}`).toEqual([])
    }
    // 分鏡表的故事板檢視
    await page.getByTestId('storyboard-view-board').click()
    await page.waitForTimeout(400)
    expect(await badText(page), '故事板').toBeUndefined()
    // 分鏡卡的景別、角度（現在選的那個）放得下，不是「Eye l…」
    for (const testId of ['cell-board-size', 'cell-board-angle']) {
      expect(await selectTextTooWide(page, testId, false), `分鏡卡 ${testId}`).toEqual([])
    }
    // 佇列面板展開
    await page.getByTestId('queue-panel').getByRole('button').first().click()
    await page.waitForTimeout(300)
    expect(await badText(page), '佇列面板').toBeUndefined()
    // 鏡頭面板（畫布上選一個鏡頭、按 Enter 開）
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    const shot = (await canvasNodes(page)).find((n) => n.data.kind === 'shot')
    if (!shot) throw new Error('沒有鏡頭')
    await centerOn(page, shot.id)
    await page
      .locator(`.react-flow__node[data-id="${shot.id}"]`)
      .click({ button: 'right', position: { x: 60, y: 16 } })
    await page.getByRole('menuitem', { name: 'Open panel' }).click()
    await expect(page.getByTestId('canvas-panel')).toBeVisible()
    await page.waitForTimeout(600)
    expect(await badText(page), '鏡頭面板').toBeUndefined()
  })
})
