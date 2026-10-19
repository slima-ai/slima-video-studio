import { canvasNodes, centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { characterNameInput } from './character-name'
import { launchApp } from './launch'
import { expect, test } from './fixtures'

test.describe('角色卡', () => {
  test('新增角色、填欄位、儲存；重開 App 後資料仍在', async ({ page, app, userDataDir }) => {
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await expect(page.getByTestId('character-empty')).toBeVisible()

    await (await characterNameInput(page)).fill('阿鐵')
    await page.getByTestId('character-add').click()
    await expect(page.getByTestId('character-card')).toBeVisible()

    await page.getByTestId('character-age').fill('28')
    await page.getByTestId('character-appearance').fill('短黑髮、琥珀色眼睛、左臉有一道小疤')
    await page.getByTestId('character-personality').fill('嘴硬心軟')
    await page.getByTestId('character-outfit').fill('深藍色工作服')
    await page.getByTestId('character-save').click()
    await expect(page.getByTestId('character-save')).toBeDisabled()

    // 關掉 App 再開一次（同一個 userData）
    await app.close()
    const again = await launchApp({ userDataDir })
    try {
      const next = await again.app.firstWindow()
      await next.waitForLoadState('domcontentloaded')
      await next.getByRole('button', { name: '角色', exact: true }).click()
      await next.getByTestId('character-item-阿鐵').click()
      await expect(next.getByTestId('character-age')).toHaveValue('28')
      await expect(next.getByTestId('character-appearance')).toHaveValue(
        '短黑髮、琥珀色眼睛、左臉有一道小疤',
      )
      await expect(next.getByTestId('character-personality')).toHaveValue('嘴硬心軟')
      await expect(next.getByTestId('character-outfit')).toHaveValue('深藍色工作服')
    } finally {
      await again.app.close().catch(() => undefined)
    }
  })

  test('刪除角色', async ({ page }) => {
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await (await characterNameInput(page)).fill('小雨')
    await page.getByTestId('character-add').click()
    await page.getByTestId('character-delete').click()
    await page.getByTestId('character-delete-confirm').click()
    await expect(page.getByTestId('character-card')).toHaveCount(0)
    await expect(page.getByTestId('character-empty')).toBeVisible()
  })

  test('固定外觀描述：AI 整理 → 修改 → 鎖定；重開 App 後仍是已鎖定', async ({
    page,
    app,
    userDataDir,
  }) => {
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await (await characterNameInput(page)).fill('阿鐵')
    await page.getByTestId('character-add').click()
    await expect(page.getByTestId('character-anchor-status')).toContainText('還沒寫')
    await expect(page.getByTestId('character-anchor-suggest')).toBeDisabled()

    await page.getByTestId('character-appearance').fill('短黑髮、琥珀色眼睛')
    await page.getByTestId('character-save').click()
    await expect(page.getByTestId('character-save')).toBeDisabled()

    // 示範模式：AI 整理會給一段示範文字
    await page.getByTestId('character-anchor-suggest').click()
    await expect(page.getByTestId('character-anchor')).not.toHaveValue('')
    await page.getByTestId('character-anchor').fill('短黑髮、琥珀色眼睛、深藍工作服')
    await page.getByTestId('character-anchor-lock').click()
    await expect(page.getByTestId('character-anchor-status')).toHaveAttribute(
      'data-status',
      'locked',
    )
    await expect(page.getByTestId('character-anchor-status')).toContainText('第 1 版')

    // 改長相 → 退回草稿的第 2 版，要重新鎖定
    await page.getByTestId('character-appearance').fill('剪成平頭、琥珀色眼睛')
    await page.getByTestId('character-save').click()
    await expect(page.getByTestId('character-anchor-status')).toHaveAttribute(
      'data-status',
      'draft',
    )
    await expect(page.getByTestId('character-anchor-status')).toContainText('第 2 版')
    await expect(page.getByTestId('character-anchor-relock')).toBeVisible()
    await page.getByTestId('character-anchor-lock').click()
    await expect(page.getByTestId('character-anchor-status')).toHaveAttribute(
      'data-status',
      'locked',
    )

    await app.close()
    const again = await launchApp({ userDataDir })
    try {
      const next = await again.app.firstWindow()
      await next.waitForLoadState('domcontentloaded')
      await next.getByRole('button', { name: '角色', exact: true }).click()
      await next.getByTestId('character-item-阿鐵').click()
      await expect(next.getByTestId('character-anchor')).toHaveValue(
        '短黑髮、琥珀色眼睛、深藍工作服',
      )
      await expect(next.getByTestId('character-anchor-status')).toHaveAttribute(
        'data-status',
        'locked',
      )
      await expect(next.getByTestId('character-anchor-status')).toContainText('第 2 版')
    } finally {
      await again.app.close().catch(() => undefined)
    }
  })

  test('版本紀錄：鎖定 → 改描述再鎖定 → 看到兩版 → 用第 1 版重新開始', async ({ page }) => {
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await (await characterNameInput(page)).fill('阿鐵')
    await page.getByTestId('character-add').click()
    await expect(page.getByTestId('character-versions')).toHaveCount(0)

    await page.getByTestId('character-anchor').fill('短黑髮')
    await page.getByTestId('character-anchor-lock').click()
    await expect(page.getByTestId('character-item-lock-阿鐵')).toContainText('已鎖定 v1')

    // 鎖定後改描述 → 第 2 版草稿，第 1 版留在紀錄裡
    await page.getByTestId('character-anchor').fill('長白髮')
    await page.getByTestId('character-anchor-save').click()
    await expect(page.getByTestId('character-anchor-status')).toContainText('第 2 版')
    await expect(page.getByTestId('character-version-1')).toHaveAttribute('data-status', 'locked')
    await expect(page.getByTestId('character-version-2')).toHaveAttribute('data-current', 'true')
    await page.getByTestId('character-anchor-lock').click()
    await expect(page.getByTestId('character-item-lock-阿鐵')).toContainText('已鎖定 v2')

    // 用第 1 版重新開始：變成第 3 版草稿，描述回到第 1 版的內容，前兩版都還在
    await page.getByTestId('character-version-restore-1').click()
    await page.getByTestId('character-version-restore-confirm-1').click()
    await expect(page.getByTestId('character-anchor-status')).toContainText('第 3 版')
    await expect(page.getByTestId('character-anchor-status')).toHaveAttribute(
      'data-status',
      'draft',
    )
    await expect(page.getByTestId('character-anchor')).toHaveValue('短黑髮')
    await expect(page.getByTestId('character-version-3')).toHaveAttribute('data-current', 'true')
    await expect(page.getByTestId('character-version-1')).toHaveAttribute('data-status', 'locked')
    await expect(page.getByTestId('character-version-2')).toHaveAttribute('data-status', 'locked')
  })

  test('鎖定角色後用一句話生成：畫布上出場的鏡頭標出「阿鐵 v1」', async ({ page }) => {
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await (await characterNameInput(page)).fill('阿鐵')
    await page.getByTestId('character-add').click()
    await page.getByTestId('character-appearance').fill('短黑髮、琥珀色眼睛')
    await page.getByTestId('character-save').click()
    await page.getByTestId('concept-generate').click()
    const concepts = page.getByTestId('concept-round-1').getByRole('button')
    await expect(concepts).toHaveCount(4, { timeout: 60_000 })
    await concepts.first().click()
    await page.getByTestId('turnaround-generate').click()
    const sheets = page.getByTestId('turnaround-round-1').locator('[data-adopted]')
    await expect(sheets).toHaveCount(4, { timeout: 60_000 })
    await sheets.first().getByRole('button', { name: '採用這組' }).click()
    await expect(page.getByTestId('turnaround-adopted').getByRole('img')).toHaveCount(3)
    await page.getByTestId('character-anchor').fill('短黑髮、琥珀色眼睛、深藍工作服')
    await page.getByTestId('character-anchor-lock').click()
    await expect(page.getByTestId('character-item-lock-阿鐵')).toContainText('已鎖定 v1')

    await generateAndOpenCanvas(page, '阿鐵在下雨的夜晚找到一隻貓')

    // 示範模式的拆鏡會讓已建好的角色出場；每個出場的鏡頭都標出用了哪一版
    const shots = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    expect(shots).toHaveLength(3)
    for (const shot of shots) {
      await centerOn(page, shot.id)
      await expect(
        page.getByTestId(`node-${shot.id}`).getByTestId('shot-character-tag'),
      ).toHaveText('阿鐵 v1')
    }
  })

  test('概念圖：生成 4 張 → 挑一張當主圖 → 整組重跑；重開 App 後主圖還在', async ({
    page,
    app,
    userDataDir,
  }) => {
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await (await characterNameInput(page)).fill('阿鐵')
    await page.getByTestId('character-add').click()
    await page.getByTestId('character-appearance').fill('短黑髮、琥珀色眼睛')
    await page.getByTestId('character-save').click()

    await expect(page.getByTestId('concept-cost')).toContainText('不會花錢')
    await page.getByTestId('concept-generate').click()
    const round1 = page.getByTestId('concept-round-1')
    await expect(round1.getByRole('button')).toHaveCount(4, { timeout: 60_000 })
    await expect(page.getByTestId('concept-generate')).toHaveText('整組重跑（4 張）')
    // 縮圖真的載入了
    await expect
      .poll(() =>
        round1
          .getByRole('img')
          .first()
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0)

    await expect(page.getByTestId('concept-hero')).toHaveCount(0)
    await round1.getByRole('button').nth(1).click()
    await expect(page.getByTestId('concept-hero')).toBeVisible()
    await expect(round1.getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true')

    // 整組重跑：多一輪，原本的主圖仍在
    await page.getByTestId('concept-generate').click()
    await expect(page.getByTestId('concept-round-2').getByRole('button')).toHaveCount(4, {
      timeout: 60_000,
    })
    await expect(page.getByTestId('concept-hero')).toBeVisible()

    await app.close()
    const again = await launchApp({ userDataDir })
    try {
      const next = await again.app.firstWindow()
      await next.waitForLoadState('domcontentloaded')
      await next.getByRole('button', { name: '角色', exact: true }).click()
      await next.getByTestId('character-item-阿鐵').click()
      await expect(next.getByTestId('concept-hero')).toBeVisible()
      await expect(next.getByTestId('concept-round-1').getByRole('button')).toHaveCount(4)
      await expect(next.getByTestId('concept-round-2').getByRole('button')).toHaveCount(4)
      await expect(next.getByTestId('concept-round-1').getByRole('button').nth(1)).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    } finally {
      await again.app.close().catch(() => undefined)
    }
  })

  test('三視圖：要先挑主圖 → 生成 4 組 → 調整切線 → 採用一組；重開 App 後仍在', async ({
    page,
    app,
    userDataDir,
  }) => {
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await (await characterNameInput(page)).fill('阿鐵')
    await page.getByTestId('character-add').click()
    await page.getByTestId('character-appearance').fill('短黑髮、琥珀色眼睛')
    await page.getByTestId('character-save').click()

    // 沒挑主圖：不能生成三視圖
    await expect(page.getByTestId('turnaround-cost')).toContainText('先從概念圖挑一張主圖')
    await expect(page.getByTestId('turnaround-generate')).toBeDisabled()

    await page.getByTestId('concept-generate').click()
    const concepts = page.getByTestId('concept-round-1').getByRole('button')
    await expect(concepts).toHaveCount(4, { timeout: 60_000 })
    await concepts.first().click()
    await expect(page.getByTestId('concept-hero')).toBeVisible()

    await expect(page.getByTestId('turnaround-generate')).toBeEnabled()
    await expect(page.getByTestId('turnaround-cost')).toContainText('不會花錢')
    await page.getByTestId('turnaround-generate').click()
    const round1 = page.getByTestId('turnaround-round-1')
    await expect(round1.locator('[data-adopted]')).toHaveCount(4, {
      timeout: 60_000,
    })
    await expect(round1.getByAltText('正面')).toHaveCount(4)
    await expect(page.getByTestId('turnaround-adopted')).toHaveCount(0)

    // 第一組：調整切線
    const first = round1.locator('[data-adopted]').first()
    await first.getByTestId('turnaround-adjust-open').click()
    await first.getByTestId('turnaround-cut-a').fill('30')
    await first.getByTestId('turnaround-cut-b').fill('70')
    await first.getByTestId('turnaround-reslice').click()
    await expect(first.getByTestId('turnaround-adjust')).toHaveCount(0)

    // 採用第二組：角色卡顯示三張圖
    const second = round1.locator('[data-adopted]').nth(1)
    await second.getByRole('button', { name: '採用這組' }).click()
    await expect(page.getByTestId('turnaround-adopted').getByRole('img')).toHaveCount(3)
    await expect(second).toHaveAttribute('data-adopted', 'true')
    await expect
      .poll(() =>
        page
          .getByTestId('turnaround-adopted')
          .getByRole('img')
          .first()
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0)

    await app.close()
    const again = await launchApp({ userDataDir })
    try {
      const next = await again.app.firstWindow()
      await next.waitForLoadState('domcontentloaded')
      await next.getByRole('button', { name: '角色', exact: true }).click()
      await next.getByTestId('character-item-阿鐵').click()
      await expect(next.getByTestId('turnaround-adopted').getByRole('img')).toHaveCount(3)
      await expect(next.getByTestId('turnaround-round-1').locator('[data-adopted]')).toHaveCount(4)
    } finally {
      await again.app.close().catch(() => undefined)
    }
  })
})
