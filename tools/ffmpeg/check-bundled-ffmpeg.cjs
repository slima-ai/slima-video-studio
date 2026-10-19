// electron-builder 的 afterPack 勾子：安裝包一定要有「我們指定來源」的 FFmpeg（macOS 自己編、Windows 固定來源），
// 附 GPL 全文與來源說明，而且不能夾帶 ffmpeg-static 的二進位。
// 原因：electron-builder 對 extraResources 缺來源只會印「file source doesn't exist」警告、照樣打包，
// 沒有這道檢查，缺 build/ffmpeg/<...> 時會悄悄打出一個沒有 FFmpeg（或夾帶 nonfree 的 FFmpeg）的安裝檔。
const { existsSync } = require('node:fs')
const { join } = require('node:path')

/**
 * 回傳問題清單（空陣列＝沒問題）。resourcesDir 是安裝包的 resources 資料夾（macOS 是 .app 的 Contents/Resources）。
 * platform 是 'darwin' 或 'win32'。
 */
function checkResources(resourcesDir, platform, exists = existsSync) {
  const problems = []
  const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const how =
    platform === 'win32'
      ? '請先跑 tools/ffmpeg/fetch-windows.sh，輸出放在 apps/desktop/build/ffmpeg/win-x64/。'
      : '請先跑 tools/ffmpeg/build-macos.sh（Intel 要在 Intel 機器上跑），輸出放在 apps/desktop/build/ffmpeg/<arm64|x64>/。'
  const own = join(resourcesDir, 'ffmpeg', exe)
  if (!exists(own)) problems.push(`缺少指定來源的 FFmpeg：${own}。${how}`)
  for (const license of ['COPYING.GPLv3', 'SOURCE.txt']) {
    if (!exists(join(resourcesDir, 'ffmpeg', license))) {
      problems.push(`缺少隨 FFmpeg 附的 ${license}（GPL 義務：授權全文與原始碼說明）。`)
    }
  }
  // ffmpeg-static 在安裝當下會下載「執行 pnpm install 的那台機器」的平台版本，所以不分名稱（ffmpeg、ffmpeg.exe）都不能夾帶
  for (const name of ['ffmpeg', 'ffmpeg.exe']) {
    const staticBinary = join(
      resourcesDir,
      'app.asar.unpacked',
      'node_modules',
      'ffmpeg-static',
      name,
    )
    if (exists(staticBinary)) {
      problems.push(
        `安裝包夾帶了 ffmpeg-static 的 FFmpeg（來源不是我們指定的，macOS 版還含 nonfree，也可能是別的平台的檔案）：${staticBinary}`,
      )
    }
  }
  return problems
}

/** electron-builder 的 afterPack 進入點。 */
module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName
  if (platform !== 'darwin' && platform !== 'win32') return
  const resources =
    platform === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : join(context.appOutDir, 'resources')
  const problems = checkResources(resources, platform)
  if (problems.length > 0) {
    throw new Error(
      `${platform === 'darwin' ? 'macOS' : 'Windows'} 安裝包的 FFmpeg 檢查沒過（${context.arch}）：\n- ${problems.join('\n- ')}`,
    )
  }
}
module.exports.checkResources = checkResources
