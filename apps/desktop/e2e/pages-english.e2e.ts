import type { Page } from '@playwright/test'

import { canvasNodes, centerOn } from './canvas-helpers'
import { expect, test } from './fixtures'
import { pick } from './pick'

// 英文介面：大綱、分鏡表、角色、場景卡、生成紀錄、檔案、設定、佇列、鏡頭面板的畫面上不能有中文與全形標點。
// 還沒轉的是別支 PR 的範圍：畫風名稱與景別、角度的名稱（schema／workflows 的標籤）、示範驅動拆出來的鏡頭標題與縮圖上的字——轉完就從這裡拿掉。
const NOT_YET = [
  '寫實',
  '故事：',
  '請拆成',
  '個鏡頭',
  // 語言選單上的各語言的名字本來就是用那個語言寫的
  '繁體中文',
  '開場',
  '結尾',
  '段：',
  '示範圖片',
  '示範影片',
  '遠景',
  '全景',
  '中景',
  '近景',
  '特寫',
  '平視',
  '俯拍',
  '仰拍',
  '俯視',
  '過肩',
  '側面',
  '背面',
  '傾斜',
  '大遠景',
  '正上方',
]

const BAD = /[㐀-鿿，。：；（）、！？「」・]/u

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
    // 分鏡表的故事板檢視
    await page.getByRole('button', { name: 'Storyboard', exact: true }).click()
    await page.getByTestId('storyboard-view-board').click()
    await page.waitForTimeout(400)
    expect(await badText(page), '故事板').toBeUndefined()
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
