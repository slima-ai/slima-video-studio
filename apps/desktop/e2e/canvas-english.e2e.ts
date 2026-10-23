import type { Page } from '@playwright/test'

import { canvasNodes, centerOn, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'
import { pick } from './pick'

// 英文介面：畫布上看得到的字不能有中文與全形標點（使用者自己寫的內容除外：這裡的故事也是英文）
// 還沒轉的是別支 PR 的範圍（畫風名稱在 workflows、復原清單的名字在主行程的 handlers、示範模型的名字在模型卡）：轉完就從這裡拿掉
const NOT_YET = [
  '寫實',
  '修改一句話',
  '一句話生成',
  '執行：',
  '示範文字',
  '示範圖片',
  '示範影片',
  '示範配音',
  '示範配樂',
  // 示範模式的 AI 拆出來的鏡頭標題（providers 的示範驅動）與景別、角度的名稱（schema 的標籤）
  '開場',
  '結尾',
  '段：',
  '遠景',
  '全景',
  '中景',
  '近景',
  '特寫',
  '平視',
  '俯拍',
  '仰拍',
]

const BAD = /[㐀-鿿，。：；（）、！？「」・]/u

async function visibleBadText(page: Page): Promise<string | undefined> {
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
      return left.length === 0 ? undefined : left.join('\n')
    },
    { source: BAD.source, notYet: NOT_YET },
  )
}

test.describe('英文介面的畫布', () => {
  test.use({ appEnv: { SVS_LOCALE: 'en' } })

  test('空畫布、一句話長出分鏡與影片、快捷鍵視窗：畫面上沒有中文', async ({ page }) => {
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    expect(await visibleBadText(page), '空畫布').toBeUndefined()

    await page.getByTestId('empty-add-oneliner').click()
    await page.getByTestId('oneliner-story').fill('A cat finds a warm home on a rainy night')
    await page.getByTestId('oneliner-story').blur()
    await pick(page, 'oneliner-shots', '3')
    await pick(page, 'oneliner-duration', '3')
    expect(await visibleBadText(page), '一句話卡片').toBeUndefined()
    await page.getByTestId('oneliner-generate').click()
    expect(await visibleBadText(page), '執行確認').toBeUndefined()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'true')
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
      timeout: 60_000,
    })
    await expect(
      page.getByTestId('toast').filter({ hasText: 'The film is generated' }),
    ).toBeVisible()
    expect(await kindCount(page, 'shot')).toBe(3)
    expect(await visibleBadText(page), '長完之後').toBeUndefined()

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
    expect(await visibleBadText(page), '展開步驟').toBeUndefined()
    await centerOn(page, first.id)
    await page.locator(`.react-flow__node[data-id="${first.id}"]`).click({
      button: 'right',
      position: { x: 60, y: 16 },
    })
    await expect(page.getByTestId('context-menu')).toBeVisible()
    expect(await visibleBadText(page), '右鍵選單').toBeUndefined()
    await page.getByRole('menuitem', { name: 'Open panel' }).click()
    await expect(page.getByTestId('canvas-panel')).toBeVisible()
    expect(await visibleBadText(page), '鏡頭的面板').toBeUndefined()
    await page.keyboard.press('Escape')
    await centerOn(page, 'cut')
    expect(await visibleBadText(page), '剪輯卡').toBeUndefined()

    await page.getByTestId('help-menu').click()
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
    await expect(page.getByTestId('shortcuts-dialog')).toContainText(
      'On a Mac, use Cmd instead of Ctrl.',
    )
    expect(await visibleBadText(page), '快捷鍵').toBeUndefined()
  })
})
