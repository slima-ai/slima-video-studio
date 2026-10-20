import type { Page } from '@playwright/test'

import {
  canvasNodes,
  centerOn,
  generateAndOpenCanvas,
  kindCount,
  viewportSettled,
} from './canvas-helpers'
import { expect, test } from './fixtures'

const fitAll = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const rf = (window as unknown as { __svsCanvas?: { fitView: (o: object) => Promise<boolean> } })
      .__svsCanvas
    await rf?.fitView({
      maxZoom: 1,
      duration: 0,
      padding: { top: '80px', left: '270px', right: '40px', bottom: '48px' },
    })
  })

const invoke = async <T>(page: Page, channel: 'shots.list' | 'sound.get'): Promise<T> => {
  const result = await page.evaluate((name) => window.svs.invoke(name, {}), channel)
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data as T
}

const toast = (page: Page) => page.getByTestId('toast')

test.describe('畫布：每一種節點都刪得掉', () => {
  test('一句話：滑過出現刪除鈕，按下去就刪、提示附「復原」；Delete 鍵、右鍵也能刪，每次都能復原', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await page.getByTestId('empty-add-oneliner').click()
    await expect.poll(() => kindCount(page, 'oneliner')).toBe(1)
    const [oneliner] = (await canvasNodes(page)).filter((n) => n.data.kind === 'oneliner')
    if (!oneliner) throw new Error('沒有一句話')
    const card = page.locator(`.react-flow__node[data-id="${oneliner.id}"]`)
    const button = page.getByTestId(`delete-${oneliner.id}`)
    await viewportSettled(page)

    // 沒選到、沒滑過：藏起來；滑過才出現
    await page.mouse.click(1000, 700)
    await expect(button).toHaveCSS('opacity', '0')
    await card.hover({ position: { x: 60, y: 16 } })
    await expect(button).toHaveCSS('opacity', '1')
    await expect(button).not.toHaveAttribute('aria-disabled', 'true')

    // 1. 按刪除鈕
    await button.click()
    await expect.poll(() => kindCount(page, 'oneliner')).toBe(0)
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await expect(toast(page)).toContainText('已刪除一句話；它生出來的場、鏡頭、圖和影片都留著')
    await page.getByTestId('toast-action').click()
    await expect.poll(() => kindCount(page, 'oneliner')).toBe(1)

    // 2. 選取後按 Delete
    await card.click({ position: { x: 60, y: 16 } })
    await page.keyboard.press('Delete')
    await expect.poll(() => kindCount(page, 'oneliner')).toBe(0)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => kindCount(page, 'oneliner')).toBe(1)

    // 3. 右鍵選單
    await card.click({ button: 'right', position: { x: 60, y: 16 } })
    await page.getByTestId('context-menu').getByRole('menuitem', { name: /^刪除/ }).click()
    await expect.poll(() => kindCount(page, 'oneliner')).toBe(0)
    await page.getByTestId('toast-action').click()
    await expect.poll(() => kindCount(page, 'oneliner')).toBe(1)
  })

  test('每一格都有刪除鈕；刪不掉的（剪輯、步驟、還沒生成的圖）停用並寫原因，按下去也會說明', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    // 新增一個空的鏡頭（它的圖與影片還沒生成）、一個便條，並展開第一鏡的步驟
    await page.getByTestId('palette-shot').click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(4)
    await page.getByTestId('palette-note').click()
    await expect.poll(() => kindCount(page, 'note')).toBe(1)
    const [firstShot] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!firstShot) throw new Error('沒有鏡頭')
    await fitAll(page)
    await viewportSettled(page)
    await page.getByTestId(`steps-toggle-${firstShot.id}`).click()
    await expect.poll(() => kindCount(page, 'step')).toBe(3)
    await fitAll(page)
    await viewportSettled(page)

    const nodes = await canvasNodes(page)
    const disabled = new Map<string, string>()
    for (const node of nodes) {
      const button = page.getByTestId(`delete-${node.id}`)
      await expect(button, `${node.data.kind} ${node.id} 要有刪除鈕`).toHaveCount(1)
      if ((await button.getAttribute('aria-disabled')) === 'true') {
        disabled.set(node.id, (await button.getAttribute('data-tip')) ?? '')
      }
    }
    const kindsOf = (ids: Iterable<string>): string[] =>
      [...new Set([...ids].map((id) => nodes.find((n) => n.id === id)?.data.kind ?? ''))].sort()
    // 只有剪輯、步驟、還沒生成的圖與影片停用
    expect(kindsOf(disabled.keys())).toEqual(['cut', 'image', 'step', 'video'])
    for (const [id, tip] of disabled) {
      const kind = nodes.find((n) => n.id === id)?.data.kind
      if (kind === 'cut')
        expect(tip).toBe('剪輯是由「場」自動長出來的，不能單獨刪；把所有場刪掉，它就會消失')
      if (kind === 'step') expect(tip).toContain('收合步驟')
      if (kind === 'image' || kind === 'video') expect(tip).toContain('還沒生成')
    }

    // 按停用的刪除鈕：什麼都沒刪，提示寫原因
    // 停用的按鈕（aria-disabled）Playwright 不肯點，用 force 當作使用者照樣點下去
    await page.getByTestId('delete-cut').click({ force: true })
    await expect(toast(page)).toContainText('由「場」自動長出來')
    expect(await kindCount(page, 'cut')).toBe(1)
    expect(await kindCount(page, 'shot')).toBe(4)

    // 能刪的照樣刪得掉（以便條為例），不用確認
    const note = nodes.find((n) => n.data.kind === 'note')
    if (!note) throw new Error('沒有便條')
    await page.getByTestId(`node-${note.id}`).hover()
    await page.getByTestId(`delete-${note.id}`).click()
    await expect.poll(() => kindCount(page, 'note')).toBe(0)
    await expect(toast(page)).toContainText('已刪除便條')
  })

  test('線：選到按 Delete 就剪掉（可以復原）；固定的線剪不掉，× 標淡、Delete 說明為什麼', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    // 角色接到第一鏡（資料關係的線，剪得掉）
    const [shot] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!shot) throw new Error('沒有鏡頭')
    await page.evaluate(async (shotKey) => {
      const added = await window.svs.invoke('canvas.add', { kind: 'character' })
      if (!added.ok) throw new Error(added.error.userMessage)
      await window.svs.invoke('canvas.link', {
        source: { key: added.data.key, port: 'char-out' },
        target: { key: shotKey, port: 'shot-ref-char' },
      })
    }, shot.id)
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    await fitAll(page)
    await viewportSettled(page)
    const edges = page.locator('.react-flow__edge')
    const refEdge = edges.filter({ has: page.locator('.svs-edge-ref') })
    await expect(refEdge).toHaveCount(1)
    const before = await edges.count()

    // 固定的線（鏡頭→圖）：選到、按 Delete，什麼都沒剪，提示寫原因
    const fixed = edges.filter({ has: page.locator('.svs-edge-flow') }).first()
    await fixed.locator('.react-flow__edge-interaction').dispatchEvent('click')
    await page.keyboard.press('Delete')
    await expect(toast(page)).toContainText('這條線是固定的')
    expect(await edges.count()).toBe(before)

    // 資料關係的線：選到、按 Delete 就剪掉；復原
    await refEdge.locator('.react-flow__edge-interaction').dispatchEvent('click')
    await page.keyboard.press('Delete')
    await expect(refEdge).toHaveCount(0)
    await expect(toast(page)).toContainText('已剪掉')
    await page.getByTestId('toast-action').click()
    await expect(refEdge).toHaveCount(1)
  })

  test('刪掉有圖、影片、多個版本和聲音的鏡頭再復原：版本、聲音、檔案都在，影片播得出來', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page, '一隻貓在下雨的夜晚找到溫暖的家', { sound: true })
    interface Take {
      id: string
      version: number
      assetHash: string
      adopted: boolean
    }
    interface Shots {
      shots: { id: string; firstFrames: Take[]; videos: Take[] }[]
    }
    interface Sound {
      shots: { shotId: string; narration?: { id: string; version: number; assetHash: string } }[]
    }
    // 一句話勾了旁白：拆鏡就寫了台詞，全部生成之後會自動念成旁白（第 1 版）
    const shots0 = (await invoke<Shots>(page, 'shots.list')).shots
    const first = shots0[0]
    if (!first) throw new Error('沒有鏡頭')
    await expect
      .poll(async () => (await invoke<Sound>(page, 'sound.get')).shots[0]?.narration?.version)
      .toBe(1)
    // 再重做一次影片：這一鏡有 2 個影片版本
    await page.evaluate(
      (key) => window.svs.invoke('canvas.run', { keys: [key] }),
      `shot:${first.id}:video`,
    )
    await expect
      .poll(
        async () =>
          (await invoke<Shots>(page, 'shots.list')).shots.find((s) => s.id === first.id)?.videos
            .length,
        {
          timeout: 60_000,
        },
      )
      .toBe(2)
    const narrationOf = (n: { id: string; version: number; assetHash: string } | undefined) =>
      n ? [n.id, n.version, n.assetHash] : null
    const snapshot = async () => {
      const shots = (await invoke<Shots>(page, 'shots.list')).shots
      const sound = (await invoke<Sound>(page, 'sound.get')).shots
      return shots.map((shot) => ({
        id: shot.id,
        firstFrames: shot.firstFrames.map((t) => [t.id, t.version, t.assetHash, t.adopted]),
        videos: shot.videos.map((t) => [t.id, t.version, t.assetHash, t.adopted]),
        narration: narrationOf(sound.find((s) => s.shotId === shot.id)?.narration),
      }))
    }
    const before = await snapshot()
    const target = before.find((b) => b.id === first.id)
    expect(target?.videos).toHaveLength(2)
    expect(target?.firstFrames.length).toBeGreaterThanOrEqual(1)
    expect(target?.narration).not.toBeNull()
    // 檔案在不在：真的把它載進頁面（圖用 <img>、影片用 <video> 讀到長寬）
    const files = [
      ...(target?.firstFrames ?? []).map((take) => ({ hash: String(take[2]), video: false })),
      ...(target?.videos ?? []).map((take) => ({ hash: String(take[2]), video: true })),
    ]
    const reachable = (file: { hash: string; video: boolean }) =>
      page.evaluate(
        ({ hash, video }) =>
          new Promise<boolean>((resolve) => {
            const url = `svs-asset://asset/${hash}`
            const timer = setTimeout(() => {
              resolve(false)
            }, 10_000)
            const done = (ok: boolean): void => {
              clearTimeout(timer)
              resolve(ok)
            }
            if (video) {
              const el = document.createElement('video')
              el.preload = 'metadata'
              el.onloadedmetadata = () => {
                done(el.videoWidth > 0 && el.duration > 0)
              }
              el.onerror = () => {
                done(false)
              }
              el.src = url
            } else {
              const el = new Image()
              el.onload = () => {
                done(el.naturalWidth > 0)
              }
              el.onerror = () => {
                done(false)
              }
              el.src = url
            }
          }),
        file,
      )

    // 刪掉第一鏡：不跳確認；檔案還在（只是資料表的列拿掉）
    await fitAll(page)
    await viewportSettled(page)
    await page.getByTestId(`rf__node-shot:${first.id}`).click({ position: { x: 60, y: 16 } })
    await page.keyboard.press('Delete')
    await expect.poll(() => kindCount(page, 'shot')).toBe(2)
    await expect(page.getByTestId('delete-confirm')).toHaveCount(0)
    await expect(toast(page)).toContainText('連同它的圖和影片版本')
    for (const file of files) expect(await reachable(file), `刪除後 ${file.hash} 還在`).toBe(true)

    // 復原：版本（編號、檔案、採用中是哪一個）和旁白都跟刪之前一模一樣
    await page.getByTestId('toast-action').click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    expect(await snapshot()).toEqual(before)
    for (const file of files) expect(await reachable(file), `復原後 ${file.hash} 還在`).toBe(true)

    // 復原回來的影片真的播得出來
    await centerOn(page, `shot:${first.id}:video`)
    const video = page.getByTestId(`node-shot:${first.id}:video`).locator('video').first()
    await expect
      .poll(async () =>
        video.evaluate(
          (el: HTMLVideoElement) => el.readyState >= 1 && el.videoWidth > 0 && el.duration > 0,
        ),
      )
      .toBe(true)
  })
})
