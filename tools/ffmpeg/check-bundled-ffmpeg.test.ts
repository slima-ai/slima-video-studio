import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const { checkResources } = createRequire(import.meta.url)('./check-bundled-ffmpeg.cjs') as {
  checkResources: (
    dir: string,
    platform: 'darwin' | 'win32',
    exists: (path: string) => boolean,
  ) => string[]
}

const R = '/App/Contents/Resources'
const withFiles =
  (...files: string[]) =>
  (path: string) =>
    files.includes(path)
const ALL_OWN = [
  join(R, 'ffmpeg', 'ffmpeg'),
  join(R, 'ffmpeg', 'COPYING.GPLv3'),
  join(R, 'ffmpeg', 'SOURCE.txt'),
]

describe('macOS 安裝包的 FFmpeg 檢查（afterPack）', () => {
  it('自己編的 FFmpeg、GPL 全文、原始碼說明都在，也沒有夾帶 ffmpeg-static 的二進位 → 沒有問題', () => {
    expect(checkResources(R, 'darwin', withFiles(...ALL_OWN))).toEqual([])
  })

  it('缺自己編的 FFmpeg（例如沒有 build/ffmpeg/x64）→ 有問題，訊息指向編譯腳本', () => {
    const problems = checkResources(
      R,
      'darwin',
      withFiles(join(R, 'ffmpeg', 'COPYING.GPLv3'), join(R, 'ffmpeg', 'SOURCE.txt')),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('tools/ffmpeg/build-macos.sh')
  })

  it('缺 GPL 全文或原始碼說明 → 各自一條問題', () => {
    expect(checkResources(R, 'darwin', withFiles(ALL_OWN[0] ?? ''))).toHaveLength(2)
  })

  it('夾帶了 ffmpeg-static 的二進位（含 nonfree）→ 有問題', () => {
    const staticBinary = join(R, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg')
    const problems = checkResources(R, 'darwin', withFiles(...ALL_OWN, staticBinary))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('nonfree')
  })
})

describe('Windows 安裝包的 FFmpeg 檢查（afterPack）', () => {
  const W = 'C:\\App\\resources'
  const winFiles = [
    join(W, 'ffmpeg', 'ffmpeg.exe'),
    join(W, 'ffmpeg', 'COPYING.GPLv3'),
    join(W, 'ffmpeg', 'SOURCE.txt'),
  ]

  it('固定來源的 ffmpeg.exe、GPL 全文、來源說明都在，沒有夾帶 ffmpeg-static 的 → 沒有問題', () => {
    expect(checkResources(W, 'win32', withFiles(...winFiles))).toEqual([])
  })

  it('缺 ffmpeg.exe → 有問題，訊息指向 fetch-windows.sh', () => {
    const problems = checkResources(W, 'win32', withFiles(winFiles[1] ?? '', winFiles[2] ?? ''))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('tools/ffmpeg/fetch-windows.sh')
  })

  it('夾帶了 ffmpeg-static 的 ffmpeg.exe → 有問題', () => {
    const staticBinary = join(W, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
    expect(checkResources(W, 'win32', withFiles(...winFiles, staticBinary))).toHaveLength(1)
  })
})

describe('ffmpeg-static 的二進位不分名稱都不能夾帶（Windows 包裡出現過 macOS 的 ffmpeg）', () => {
  const R = '/App/Contents/Resources'
  const W = 'C:\\App\\resources'
  const own = (dir: string, exe: string) => [
    join(dir, 'ffmpeg', exe),
    join(dir, 'ffmpeg', 'COPYING.GPLv3'),
    join(dir, 'ffmpeg', 'SOURCE.txt'),
  ]
  const staticAt = (dir: string, name: string) =>
    join(dir, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', name)

  it('Windows 包裡夾帶沒有 .exe 的 ffmpeg（別的平台的二進位）→ 有問題', () => {
    const problems = checkResources(
      W,
      'win32',
      withFiles(...own(W, 'ffmpeg.exe'), staticAt(W, 'ffmpeg')),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('ffmpeg-static')
  })

  it('macOS 包裡夾帶 ffmpeg.exe → 有問題', () => {
    const problems = checkResources(
      R,
      'darwin',
      withFiles(...own(R, 'ffmpeg'), staticAt(R, 'ffmpeg.exe')),
    )
    expect(problems).toHaveLength(1)
  })
})
