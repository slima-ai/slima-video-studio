import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'

const root = join(__dirname, '../..')
const script = join(root, 'tools/ci/install-ffmpeg.sh')
const scriptText = readFileSync(script, 'utf8')
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

// 2026-10-22 azure 的 Ubuntu 鏡像慢到只剩約 40 KB/s，apt 裝 ffmpeg（87 個套件）下載不完，把 CI 卡住好幾次。
// CI 改抓 GitHub release 上固定版號的靜態版，核對 SHA-256；裝好後確認有 libx264 與 aac，缺了就失敗，不退回 apt。
describe('ci.yml：ffmpeg 走 install-ffmpeg.sh（unit 與 e2e-linux），那一步有逾時，unit 完全不用 apt', () => {
  const jobs = ci.split(/\n(?=  [a-z0-9-]+:\n)/)
  const jobOf = (name: string): string => jobs.find((j) => j.startsWith(`  ${name}:`)) ?? ''

  it.each(['unit', 'e2e-linux'])(
    '%s：有一個 install-ffmpeg.sh 的步驟，timeout-minutes 在 1～15',
    (name) => {
      const job = jobOf(name)
      expect(job).not.toBe('')
      const step = job.split(/\n(?=\s+- )/).find((s) => s.includes('tools/ci/install-ffmpeg.sh'))
      expect(step, `${name} 沒有安裝 ffmpeg 的步驟`).toBeDefined()
      const minutes = Number(/timeout-minutes:\s*(\d+)/.exec(step ?? '')?.[1])
      expect(minutes).toBeGreaterThanOrEqual(1)
      expect(minutes).toBeLessThanOrEqual(15)
    },
  )

  it('unit 完全不用 apt（不會再被鏡像拖住）', () => {
    expect(jobOf('unit')).not.toMatch(/apt-get|apt-install/)
  })

  it('任何地方都不用 apt 裝 ffmpeg', () => {
    expect(ci).not.toMatch(/apt-get[^\n]*ffmpeg/)
    expect(ci).not.toMatch(/apt-install\.sh[^\n]*ffmpeg/)
  })
})

describe('tools/ci/install-ffmpeg.sh：固定來源與版號', () => {
  it('只抓 GitHub release 上固定版號的檔（不是 latest），四個 SHA-256 都寫死', () => {
    expect(scriptText).toContain(
      'https://github.com/eugeneware/ffmpeg-static/releases/download/$TAG',
    )
    expect(scriptText).toMatch(/TAG="\$\{FFMPEG_TAG:-b\d+\.\d+\.\d+\}"/)
    expect(scriptText).not.toMatch(/latest/)
    for (const name of [
      'FFMPEG_GZ_SHA256',
      'FFMPEG_SHA256',
      'FFPROBE_GZ_SHA256',
      'FFPROBE_SHA256',
    ]) {
      expect(scriptText, name).toMatch(new RegExp(`${name}="\\$\\{${name}:-[0-9a-f]{64}\\}"`))
    }
  })

  it('不會退回 apt', () => {
    expect(scriptText.replace(/^#.*$/gm, '')).not.toMatch(/apt-get|apt install|\bapt\b/)
  })
})

describe('tools/ci/install-ffmpeg.sh：行為（用假的 ffmpeg 與本機檔案當來源）', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  const fakeFfmpeg = (encoders: string[]): string =>
    `#!/usr/bin/env bash
case "$*" in
  *-version*) echo "ffmpeg version 6.1.1-static Copyright (c) 2000-2023 the FFmpeg developers";;
  *-encoders*) printf '%s\\n' ${encoders.map((e) => `" ${e}"`).join(' ')};;
esac`
  const ENCODERS_OK = [
    'V....D libx264              libx264 H.264',
    'A....D aac                  AAC (Advanced Audio Coding)',
  ]

  interface Options {
    encoders?: string[]
    /** 下載來源裡不放檔案（模擬下載失敗）。 */
    noFiles?: boolean
    wrongGzDigest?: boolean
    wrongBinDigest?: boolean
  }

  function run(options: Options = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'svs-ffmpeg-'))
    dirs.push(dir)
    const source = join(dir, 'release')
    const bin = join(dir, 'bin')
    const dest = join(dir, 'dest')
    mkdirSync(source)
    mkdirSync(bin)
    const ffmpeg = Buffer.from(fakeFfmpeg(options.encoders ?? ENCODERS_OK))
    const ffprobe = Buffer.from('#!/usr/bin/env bash\necho ffprobe\n')
    const ffmpegGz = gzipSync(ffmpeg)
    const ffprobeGz = gzipSync(ffprobe)
    if (options.noFiles !== true) {
      writeFileSync(join(source, 'ffmpeg-linux-x64.gz'), ffmpegGz)
      writeFileSync(join(source, 'ffprobe-linux-x64.gz'), ffprobeGz)
    }
    // 假的 apt-get：只要被呼叫就留下紀錄（腳本絕不能退回 apt）
    const aptLog = join(dir, 'apt.log')
    writeFileSync(join(bin, 'apt-get'), `#!/usr/bin/env bash\necho "apt-get $*" >> "${aptLog}"\n`)
    chmodSync(join(bin, 'apt-get'), 0o755)
    const githubPath = join(dir, 'github-path')
    const result = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FFMPEG_BASE_URL: `file://${source}`,
        FFMPEG_DEST: dest,
        FFMPEG_CURL_RETRY: '0',
        GITHUB_PATH: githubPath,
        FFMPEG_GZ_SHA256: options.wrongGzDigest === true ? '0'.repeat(64) : sha256(ffmpegGz),
        FFMPEG_SHA256: options.wrongBinDigest === true ? '1'.repeat(64) : sha256(ffmpeg),
        FFPROBE_GZ_SHA256: sha256(ffprobeGz),
        FFPROBE_SHA256: sha256(ffprobe),
      },
    })
    return {
      ...result,
      dest,
      githubPath,
      aptCalled: existsSync(aptLog) && readFileSync(aptLog, 'utf8').trim() !== '',
    }
  }

  it('下載、核對、解壓、確認編碼器都過：ffmpeg 與 ffprobe 可執行，放進 GITHUB_PATH，沒碰 apt', () => {
    const r = run()
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('ffmpeg version 6.1.1')
    for (const tool of ['ffmpeg', 'ffprobe']) {
      expect(statSync(join(r.dest, tool)).mode & 0o111, tool).not.toBe(0)
    }
    expect(readFileSync(r.githubPath, 'utf8').trim()).toBe(r.dest)
    expect(r.aptCalled).toBe(false)
  })

  it('壓縮檔的 SHA-256 不符：失敗，不留可執行的 ffmpeg，不退回 apt', () => {
    const r = run({ wrongGzDigest: true })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('::error::ffmpeg 壓縮檔的 SHA-256 不符')
    expect(existsSync(join(r.dest, 'ffmpeg'))).toBe(false)
    expect(r.aptCalled).toBe(false)
  })

  it('解壓後的執行檔 SHA-256 不符：失敗', () => {
    const r = run({ wrongBinDigest: true })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('::error::ffmpeg 執行檔的 SHA-256 不符')
    expect(r.aptCalled).toBe(false)
  })

  it.each(['libx264', 'aac'])('缺 %s 編碼器：失敗並說明，不悄悄退回 apt', (missing) => {
    const r = run({ encoders: ENCODERS_OK.filter((e) => !e.includes(` ${missing} `)) })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`::error::這個 ffmpeg 沒有 ${missing} 編碼器`)
    expect(r.aptCalled).toBe(false)
  })

  it('下載失敗（來源沒有檔案）：重試後失敗並說明，不退回 apt', () => {
    const r = run({ noFiles: true })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('::error::下載 ffmpeg 失敗')
    expect(r.aptCalled).toBe(false)
  })
})
