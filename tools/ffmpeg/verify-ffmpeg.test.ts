import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// 假 ffmpeg：想找的那一行放在最前面，後面接很長的輸出——跟真的 ffmpeg 一樣會一直寫下去。
// 若檢查寫成 `ffmpeg | grep -q`，grep 找到第一行就結束，假 ffmpeg 繼續寫就被 SIGPIPE 砍掉（結束碼 141），
// 在 pipefail 下整條管線失敗（#258）。
const FAKE = `#!/usr/bin/env bash
pad() { yes '  padding line padding line padding line' | head -n 40000; }
case "$*" in
  *-version*)
    echo "ffmpeg version 6.1.1"
    echo "configuration: --enable-gpl --enable-libx264 \${FAKE_NONFREE:+--enable-nonfree}"
    pad ;;
  *-encoders*)
    echo " V....D \${FAKE_VIDEO_ENCODER-libx264}           H.264 encoder"
    echo " A....D aac                   AAC"
    pad ;;
  *-filters*)
    for f in \${FAKE_FILTERS-fade zoompan}; do echo " T.C $f   V->V  filter"; done
    pad ;;
esac
`

const dir = mkdtempSync(join(tmpdir(), 'svs-verify-ffmpeg-'))
const fake = join(dir, 'ffmpeg')
writeFileSync(fake, FAKE)
chmodSync(fake, 0o755)
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const script = join(import.meta.dirname, 'verify-ffmpeg.sh')
const run = (env: Record<string, string> = {}) =>
  spawnSync('bash', [script, fake], { env: { ...process.env, ...env }, encoding: 'utf8' })

describe('verify-ffmpeg.sh（build-macos.sh 結尾的檢查）', () => {
  it('合格的 ffmpeg（fade 在最前面、後面還有很長的輸出）→ 通過，不會被 SIGPIPE 誤報', () => {
    for (let i = 0; i < 5; i++) {
      const r = run()
      expect(r.stderr).toBe('')
      expect(r.status).toBe(0)
    }
  })

  it('有 nonfree → 一定失敗（輸出很長也一樣，不能因 SIGPIPE 放行）', () => {
    for (let i = 0; i < 5; i++) {
      const r = run({ FAKE_NONFREE: '1' })
      expect(r.stderr).toContain('含 nonfree')
      expect(r.status).toBe(1)
    }
  })

  it('沒有 libx264 → 失敗並說沒有 libx264', () => {
    const r = run({ FAKE_VIDEO_ENCODER: 'mpeg4' })
    expect(r.stderr).toContain('沒有 libx264')
    expect(r.status).toBe(1)
  })

  it('沒有 fade 濾鏡 → 失敗並說沒有 fade', () => {
    const r = run({ FAKE_FILTERS: 'zoompan' })
    expect(r.stderr).toContain('沒有 fade 濾鏡')
    expect(r.status).toBe(1)
  })

  it('沒有 zoompan 濾鏡 → 失敗並說沒有 zoompan', () => {
    const r = run({ FAKE_FILTERS: 'fade' })
    expect(r.stderr).toContain('沒有 zoompan 濾鏡')
    expect(r.status).toBe(1)
  })
})
