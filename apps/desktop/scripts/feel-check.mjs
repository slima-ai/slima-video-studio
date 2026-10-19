/* global window, document, requestAnimationFrame, WheelEvent, DOMMatrix, getComputedStyle */
// 手感自測：量畫布的捲動平移、Ctrl 縮放、拖移鏡頭、拉線時每一格畫面的間隔，順便驗「跟手」：
// 拖移時格子是不是跟著游標、縮放時游標下的那一點是不是不動。再在幾個縮放比例下截圖，看字清不清楚。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/feel-check.mjs <輸出資料夾> [鏡頭數]
// 注意：容器沒有 GPU，數字只能拿來比較前後、找出特別卡的動作；50 fps 要在有 GPU 的機器量。
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const shots = process.argv[3] ?? '12'
const { app, page, pause } = await prepare(outDir, { seed: false })

// 一句話長出 N 鏡
await page.getByRole('button', { name: '畫布', exact: true }).click()
await page.getByTestId('empty-add-oneliner').click()
await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
await page.getByTestId('oneliner-story').blur()
await page.getByTestId('oneliner-shots').click()
await page.getByTestId(`oneliner-shots-option-${shots}`).click()
await page.getByTestId('oneliner-generate').click()
await page.getByTestId('run-confirm-ok').click()
await page.waitForSelector('[data-testid="canvas-root"][data-growing="true"]')
await page.waitForSelector('[data-testid="canvas-root"][data-growing="false"]', {
  timeout: 180_000,
})
await pause(6000) // 等提示收掉

// 每一格畫面的時間
await page.evaluate(() => {
  const ft = { on: false, t: [], z: [] }
  window.__ft = ft
  const loop = (now) => {
    if (ft.on) {
      ft.t.push(now)
      const vp = document.querySelector('.react-flow__viewport')
      ft.z.push(vp ? new DOMMatrix(getComputedStyle(vp).transform).a : 0)
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
})
const startFrames = () =>
  page.evaluate(() => {
    window.__ft.t = []
    window.__ft.z = []
    window.__ft.on = true
  })
const stopFrames = () =>
  page.evaluate(() => {
    window.__ft.on = false
    const t = window.__ft.t
    return t.slice(1).map((v, i) => v - t[i])
  })
const stats = (name, gaps, extra = {}) => {
  const sorted = [...gaps].sort((a, b) => a - b)
  const sum = gaps.reduce((a, b) => a + b, 0)
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  return {
    name,
    frames: gaps.length,
    fps: gaps.length ? +(1000 / (sum / gaps.length)).toFixed(1) : 0,
    p95ms: +at(0.95).toFixed(1),
    maxMs: +(sorted.at(-1) ?? 0).toFixed(1),
    over50ms: gaps.filter((g) => g > 50).length,
    ...extra,
  }
}
const viewport = () => page.evaluate(() => window.__svsCanvas.getViewport())
const setViewport = (v) =>
  page.evaluate((next) => window.__svsCanvas.setViewport(next, { duration: 0 }), v)
const fitAll = () =>
  page.evaluate(() =>
    window.__svsCanvas.fitView({
      maxZoom: 1,
      duration: 0,
      padding: { top: '80px', left: '270px', right: '40px', bottom: '48px' },
    }),
  )
/** 在畫面上送一個滾輪事件（觸控板兩指捲動 / Ctrl 縮放），像真的觸控板一樣一格一格送。 */
const wheel = (x, y, dx, dy, ctrl) =>
  page.evaluate(
    ({ x, y, dx, dy, ctrl }) => {
      const el = document.elementFromPoint(x, y)
      el?.dispatchEvent(
        new WheelEvent('wheel', {
          clientX: x,
          clientY: y,
          deltaX: dx,
          deltaY: dy,
          ctrlKey: ctrl,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    { x, y, dx, dy, ctrl },
  )
const nextFrame = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const results = []
const nodes = () => page.evaluate(() => window.__svsCanvas.getNodes())
const all = await nodes()
const counts = all.reduce((acc, n) => ({ ...acc, [n.data.kind]: (acc[n.data.kind] ?? 0) + 1 }), {})
console.log('格子：', JSON.stringify(counts), '共', all.length)

// 1) 捲動平移（觸控板兩指）
await fitAll()
await setViewport({ ...(await viewport()), zoom: 1 })
await pause(300)
{
  const before = await viewport()
  await startFrames()
  for (let i = 0; i < 90; i++) {
    await wheel(800, 450, i % 30 < 15 ? 6 : -6, 14, false)
    await pause(16)
  }
  const gaps = await stopFrames()
  const after = await viewport()
  results.push(
    stats('捲動平移（縮放 100%）', gaps, {
      moved: { x: +(after.x - before.x).toFixed(1), y: +(after.y - before.y).toFixed(1) },
      zoomStayed: after.zoom === before.zoom,
    }),
  )
}

// 2) Ctrl 縮放：游標下的點要不動（從「全部顯示」與從 70% 各量一次）
for (const from of ['全部顯示', '70%']) {
  await fitAll()
  if (from === '70%') await setViewport({ ...(await viewport()), zoom: 0.7 })
  await pause(300)
  const at = { x: 900, y: 450 }
  const flowAt = () => page.evaluate((p) => window.__svsCanvas.screenToFlowPosition(p), at)
  const anchor = await flowAt()
  const z0 = (await viewport()).zoom
  await startFrames()
  for (let i = 0; i < 40; i++) {
    await wheel(at.x, at.y, 0, -8, true)
    await pause(16)
  }
  const zMid = (await viewport()).zoom
  for (let i = 0; i < 70; i++) {
    await wheel(at.x, at.y, 0, 8, true)
    await pause(16)
  }
  const gaps = await stopFrames()
  const zs = await page.evaluate(() => window.__ft.z)
  const slow = gaps.flatMap((g, i) =>
    g > 40 ? [`${g.toFixed(0)}ms@${zs[i].toFixed(2)}→${zs[i + 1].toFixed(2)}`] : [],
  )
  const z1 = (await viewport()).zoom
  const drift = await flowAt()
  results.push(
    stats(`Ctrl 縮放（從${from}放大再縮小）`, gaps, {
      zoom: `${z0.toFixed(2)} → ${zMid.toFixed(2)} → ${z1.toFixed(2)}`,
      slowFrames: slow,
      anchorDriftPx: +Math.hypot(drift.x - anchor.x, drift.y - anchor.y).toFixed(2),
    }),
  )
}

// 3) 拖移一個鏡頭：格子要跟著游標
for (const alone of [false, true]) {
  await fitAll()
  await setViewport({ ...(await viewport()), zoom: 0.8 })
  await pause(300)
  const shot = (await nodes()).find((n) => n.data.kind === 'shot')
  const el = page.locator(`.react-flow__node[data-id="${shot.id}"]`)
  const box = await el.boundingBox()
  const grab = { x: box.x + 40, y: box.y + 14 } // 標題列
  if (alone) await page.keyboard.down('Alt')
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  const zoom = (await viewport()).zoom
  const tStart = await el.evaluate((n) => {
    const m = new DOMMatrix(getComputedStyle(n).transform)
    return { x: m.m41, y: m.m42 }
  })
  const t0 = { ...tStart, px: grab.x, py: grab.y }
  await startFrames()
  const lags = []
  for (let i = 1; i <= 60; i++) {
    const p = { x: grab.x + i * 4, y: grab.y + Math.sin(i / 6) * 40 + i * 2 }
    await page.mouse.move(p.x, p.y)
    await nextFrame()
    // 用格子自己的位移（transform）算，不用外框：拖移時連接點文字會出現，外框會變大
    const t = await el.evaluate((n) => {
      const m = new DOMMatrix(getComputedStyle(n).transform)
      return { x: m.m41, y: m.m42 }
    })
    lags.push(Math.hypot((t.x - t0.x) * zoom - (p.x - t0.px), (t.y - t0.y) * zoom - (p.y - t0.py)))
  }
  const gaps = await stopFrames()
  await page.mouse.up()
  if (alone) await page.keyboard.up('Alt')
  await pause(400)
  results.push(
    stats(alone ? '拖移鏡頭（按住 Alt 不對齊）' : '拖移鏡頭（縮放 80%，會對齊）', gaps, {
      followLagMaxPx: +Math.max(...lags.slice(2)).toFixed(1),
      followLagMeanPx: +(lags.slice(2).reduce((a, b) => a + b, 0) / (lags.length - 2)).toFixed(1),
    }),
  )
  await page.keyboard.press('Control+z')
  await pause(400)
}

// 4) 拉線：從一句話以外的輸出點拉一條線經過畫面（不放開在格子上，放到空白處後按 Esc）
{
  const shot = (await nodes()).find((n) => n.data.kind === 'shot')
  await page.evaluate(
    (p) => window.__svsCanvas.setCenter(p.x + 300, p.y + 60, { zoom: 0.8, duration: 0 }),
    shot.position,
  )
  await pause(300)
  const port = page.getByTestId(`port-${shot.id}-shot-out`)
  const b = await port.boundingBox()
  const start = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await startFrames()
  const lags = []
  for (let i = 1; i <= 50; i++) {
    const p = { x: start.x + i * 6, y: start.y + Math.cos(i / 5) * 60 }
    await page.mouse.move(p.x, p.y)
    await nextFrame()
    const end = await page.evaluate(() => {
      const dot = document.querySelector('.react-flow__connectionline circle')
      if (!dot) return undefined
      const r = dot.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    if (end) lags.push(Math.hypot(end.x - p.x, end.y - p.y))
  }
  const gaps = await stopFrames()
  await page.mouse.up()
  await pause(300)
  await page.keyboard.press('Escape')
  results.push(
    stats('拉線', gaps, {
      lineSeen: lags.length,
      followLagMaxPx: lags.length ? +Math.max(...lags.slice(2)).toFixed(1) : null,
    }),
  )
}

// 5) 分頁捲動：分鏡表與生成紀錄（滑鼠滾輪）
for (const name of ['分鏡表', '生成紀錄']) {
  await page.getByRole('button', { name, exact: true }).click()
  await pause(800)
  await page.mouse.move(800, 500)
  await startFrames()
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, i < 30 ? 40 : -40)
    await pause(16)
  }
  const gaps = await stopFrames()
  results.push(stats(`${name}捲動`, gaps))
}
await page.getByRole('button', { name: '畫布', exact: true }).click()
await page.getByTestId('canvas-root').waitFor()
await pause(800)

// 6) 看得清楚嗎：幾個縮放比例的截圖（深淺色）
for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
  await fitAll()
  await pause(500)
  await page.screenshot({ path: join(outDir, `feel-${theme}-fit.png`) })
  for (const zoom of [1, 0.7, 0.5, 0.35, 0.2]) {
    await fitAll()
    await page.evaluate((z) => {
      const rf = window.__svsCanvas
      const center = rf.screenToFlowPosition({ x: 820, y: 300 })
      rf.setCenter(center.x, center.y, { zoom: z, duration: 0 })
    }, zoom)
    await pause(500)
    await page.screenshot({
      path: join(outDir, `feel-${theme}-${String(zoom).replace('.', '')}.png`),
    })
  }
}

writeFileSync(join(outDir, 'feel.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
await app.close()
