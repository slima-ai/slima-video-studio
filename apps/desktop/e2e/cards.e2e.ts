/* eslint-disable no-empty-pattern -- Playwright 的 fixture 參數一定要用解構，這個測試不用任何 fixture */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ffmpegPath from 'ffmpeg-static'
import { build } from 'vite'

import { expect, test } from '@playwright/test'

// 文字卡、片名卡、片尾 AI 服務字卡：真的 Electron 離屏視窗、正式的字卡服務與內建字型。
// 用 vite 把 card-runner/main.ts（連同它用到的正式程式）打包成一支 Electron 主程式，啟動它畫卡，再檢查畫出來的 PNG。

const ROOT = join(__dirname, '..')
const FONT = join(ROOT, 'resources', 'fonts', 'NotoSansTC-Bold.otf')

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** 平均亮度（0～255，黑是 16 上下），用 ffmpeg 量。 */
function lumaOf(file: string): number {
  const result = spawnSync(
    ffmpegPath ?? 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-vf',
      'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  )
  const found = /YAVG=([\d.]+)/.exec(result.stdout)
  if (!found) throw new Error(`量不到亮度：${result.stdout}${result.stderr}`)
  return Number(found[1])
}

test.describe('字卡（真的 Electron）', () => {
  test('文字卡、片名卡、片尾 AI 服務字卡：橫式與直式都畫得出來；大小對、不是全黑、同樣的輸入不重畫；字型檔不見時退回系統字型', async ({}, testInfo) => {
    test.setTimeout(180_000)
    const work = join(tmpdir(), `svs-card-e2e-${String(process.pid)}`)
    mkdirSync(work, { recursive: true })
    const bundleDir = join(work, 'bundle')
    await build({
      configFile: false,
      logLevel: 'error',
      root: ROOT,
      ssr: { noExternal: true, external: ['electron'] },
      build: {
        ssr: join(ROOT, 'e2e', 'card-runner', 'main.ts'),
        outDir: bundleDir,
        emptyOutDir: true,
        minify: false,
        target: 'node20',
        rollupOptions: {
          external: ['electron', /^node:/],
          output: { format: 'cjs', entryFileNames: 'main.cjs' },
        },
      },
    })
    const bundle = join(bundleDir, 'main.cjs')
    expect(existsSync(bundle)).toBe(true)

    // 一張有比例的封面（直式 400×600）
    const cover = join(work, 'cover.png')
    execFileSync(ffmpegPath ?? 'ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=400x600:rate=1',
      '-frames:v',
      '1',
      cover,
    ])

    const out = testInfo.outputPath('cards')
    const electronPath = (await import('electron')) as unknown as { default: string }
    const run = spawnSync(electronPath.default, [bundle, out, cover, FONT], {
      encoding: 'utf8',
      timeout: 150_000,
      env: { ...process.env, SVS_QUIET_WINDOWS: '1' },
    })
    expect(
      existsSync(join(out, 'error.txt')) ? readFileSync(join(out, 'error.txt'), 'utf8') : '',
      `stderr: ${run.stderr.slice(-400)}`,
    ).toBe('')
    expect(run.status, run.stderr.slice(-400)).toBe(0)

    const summary = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8')) as {
      results: Record<
        string,
        { againCached: boolean; text: { assetHash: string }; againHash: string }
      >
      logs: string[]
    }
    for (const [tag, expected] of [
      ['wide', { width: 1280, height: 720 }],
      ['tall', { width: 720, height: 1280 }],
    ] as const) {
      for (const name of ['text', 'title', 'long', 'credits']) {
        const file = join(out, `${name}-${tag}.png`)
        expect(existsSync(file), file).toBe(true)
        expect(pngSize(file), `${name}-${tag}`).toEqual(expected)
        // 黑底白字：不是全黑（平均亮度明顯高於黑）
        // 黑底（亮度約 16）上有字就會高一點；全黑就是沒畫出字
        expect(lumaOf(file), `${name}-${tag} 不是全黑`).toBeGreaterThan(
          name === 'credits' ? 17 : 20,
        )
        await testInfo.attach(`${name}-${tag}`, { path: file, contentType: 'image/png' })
      }
      // 同樣的輸入第二次不重畫
      expect(summary.results[tag]?.againCached).toBe(true)
      expect(summary.results[tag]?.againHash).toBe(summary.results[tag]?.text.assetHash)
    }
    // 內建字型：正常時 log 沒有「字型沒載入」；字型檔不見時退回系統字型、仍然畫出來，log 記一筆
    const fontLogs = summary.logs.filter((l) => l.includes('font'))
    expect(fontLogs.filter((l) => !l.startsWith('[no-font]'))).toEqual([])
    expect(fontLogs.some((l) => l.startsWith('[no-font]'))).toBe(true)
    const fallback = join(out, 'text-fallback-font.png')
    expect(pngSize(fallback)).toEqual({ width: 1280, height: 720 })
    expect(lumaOf(fallback)).toBeGreaterThan(17)
  })
})
