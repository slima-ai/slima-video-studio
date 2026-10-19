import { describe, expect, it } from 'vitest'

import { bundledFfmpegPath, locateTools, unpackedPath } from './bundled-tools'

describe('unpackedPath', () => {
  it('打包後的路徑換成 app.asar.unpacked；開發環境的路徑不動', () => {
    expect(
      unpackedPath('/Applications/X.app/Contents/Resources/app.asar/node_modules/f/ffmpeg'),
    ).toBe('/Applications/X.app/Contents/Resources/app.asar.unpacked/node_modules/f/ffmpeg')
    expect(
      unpackedPath('C:\\Program Files\\X\\resources\\app.asar\\node_modules\\f\\ffmpeg.exe'),
    ).toBe('C:\\Program Files\\X\\resources\\app.asar.unpacked\\node_modules\\f\\ffmpeg.exe')
    expect(unpackedPath('/home/me/proj/node_modules/ffmpeg-static/ffmpeg')).toBe(
      '/home/me/proj/node_modules/ffmpeg-static/ffmpeg',
    )
  })
})

describe('locateTools', () => {
  const asar = '/R/app.asar/node_modules/ffmpeg-static/ffmpeg'

  it('內建的 ffmpeg 存在 → 用它，而且不依賴 ffprobe', () => {
    const tools = locateTools(asar, () => true, {})
    expect(tools).toEqual({
      ffmpegPath: '/R/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg',
      ffprobePath: null,
    })
  })

  it('環境變數優先於內建的', () => {
    const tools = locateTools(asar, () => true, { SVS_FFMPEG: '/mine/ffmpeg' })
    expect(tools.ffmpegPath).toBe('/mine/ffmpeg')
  })

  it('內建的不存在（沒下載到、被防毒刪掉）或這個平台沒有 → 退回系統 PATH', () => {
    expect(locateTools(asar, () => false, {})).toEqual({
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
    })
    expect(locateTools(null, () => true, {})).toEqual({
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
    })
  })
})

describe('安裝包內自己編的 FFmpeg（resources/ffmpeg）', () => {
  const asar = '/R/app.asar/node_modules/ffmpeg-static/ffmpeg'

  it('bundledFfmpegPath：macOS／Linux 是 ffmpeg，Windows 是 ffmpeg.exe；沒有 resources 路徑（開發環境）就是 undefined', () => {
    expect(bundledFfmpegPath('/App/Contents/Resources', 'darwin')).toBe(
      '/App/Contents/Resources/ffmpeg/ffmpeg',
    )
    expect(bundledFfmpegPath('/opt/app/resources', 'linux')).toBe(
      '/opt/app/resources/ffmpeg/ffmpeg',
    )
    expect(bundledFfmpegPath('C:\\App\\resources', 'win32')).toMatch(/ffmpeg[\\/]ffmpeg\.exe$/)
    expect(bundledFfmpegPath(undefined, 'darwin')).toBeUndefined()
  })

  it('resources 裡有自己編的 → 優先用它，比 ffmpeg-static 的優先（ffmpeg-static 的 macOS 版含 nonfree，不能散布）', () => {
    const tools = locateTools(asar, () => true, {}, '/App/Contents/Resources', 'darwin')
    expect(tools).toEqual({
      ffmpegPath: '/App/Contents/Resources/ffmpeg/ffmpeg',
      ffprobePath: null,
    })
  })

  it('resources 裡沒有 → 照舊用 ffmpeg-static，再不行才用系統 PATH', () => {
    const onlyStatic = (path: string) => path.includes('ffmpeg-static')
    expect(locateTools(asar, onlyStatic, {}, '/App/Contents/Resources', 'darwin').ffmpegPath).toBe(
      '/R/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg',
    )
    expect(locateTools(asar, () => false, {}, '/App/Contents/Resources', 'darwin')).toEqual({
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
    })
  })

  it('環境變數 SVS_FFMPEG 仍然最優先', () => {
    const tools = locateTools(
      asar,
      () => true,
      { SVS_FFMPEG: '/mine/ffmpeg' },
      '/App/Contents/Resources',
      'darwin',
    )
    expect(tools.ffmpegPath).toBe('/mine/ffmpeg')
  })
})
