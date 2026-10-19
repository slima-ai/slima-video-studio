// 錄一段約 50 秒的「分頁外觀統一與專案頁」影片（M6-7d-7，給審查用）：
// 每一頁上方都是和畫布一樣的 56px 列（頁名、一句說明、右邊放這頁的動作），內容有固定的邊界（AB）
// → 生成紀錄與檔案的篩選放在上方列、同一個樣子；清單只顯示中文描述、路徑只留一行（AB）
// → 專案頁：現在開著的、開新專案、其他專案打開就回到它的畫布（AA）。
// 用法：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/pages-look-record.mjs <輸出資料夾>
// 每一段開始的秒數會印出來，填進驗收清單。
import { prepare } from './record-lib.mjs'

const outDir = process.argv[2]
if (!outDir) throw new Error('請給輸出資料夾')
const { page, pause, clickAt, record } = await prepare(outDir)
const stop = await record('pages-look-m6-7d7.mp4')
const started = Date.now()
const mark = (label) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${label}`)
}
const go = (name) => clickAt(page.getByRole('button', { name, exact: true }))

await go('畫布')
await page.getByTestId('canvas-root').waitFor()
await pause(1500)

// 1) AB：每一頁的上方列都和畫布一樣
mark('AB 每一頁的上方列')
for (const name of ['大綱', '分鏡表', '角色', '場景卡']) {
  await go(name)
  await pause(1800)
}

// 2) AB：生成紀錄、檔案的篩選放在上方列；清單只顯示中文描述、路徑一行
mark('AB 生成紀錄的篩選與中文描述')
await go('生成紀錄')
await pause(1500)
await clickAt(page.getByTestId('records-kind-image'))
await pause(1500)
await clickAt(page.getByTestId('records-outcome-succeeded'))
await pause(1500)
await clickAt(page.getByTestId('records-kind-all'))
await pause(1000)
mark('AB 檔案的篩選與一行路徑')
await go('檔案')
await pause(1500)
await clickAt(page.getByTestId('files-filter-video'))
await pause(1800)
await go('設定')
await pause(1800)

// 3) AA：專案頁：現在開著的 → 開新專案（空的畫布）→ 回專案頁打開原本的 → 回到它的畫布
mark('AA 專案頁')
await go('專案')
await pause(2500)
await clickAt(page.getByTestId('project-new'))
await page.getByTestId('canvas-empty').waitFor()
await pause(2200)
await go('專案')
await pause(2200)
await clickAt(page.getByTestId('project-open'))
await page.getByTestId('canvas-root').waitFor()
await pause(3000)
mark('結束')

await stop()
