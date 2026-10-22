import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const root = join(__dirname, '../..')
const script = join(root, 'tools/ci/apt-install.sh')
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const stepsMatching = (pattern: RegExp): string[] =>
  ci.split(/\n(?=\s+- )/).filter((step) => pattern.test(step))

// 2026-10-22 一天內，azure 的 Ubuntu 鏡像慢到只剩約 40 KB/s，apt 下載不完，把 CI 卡住好幾次（unit 被 20 分鐘上限取消、測試根本沒開始）。
// ffmpeg 這種大包不走 apt（見 ci-ffmpeg.test.ts）；e2e 還要的幾個小套件一律走 tools/ci/apt-install.sh：
// 不裝建議套件、網路逾時、每次嘗試有時間上限、失敗重試一次。
describe('ci.yml：系統套件只走 apt-install.sh，而且那一步有逾時；ffmpeg 不走 apt', () => {
  const steps = stepsMatching(/apt-get|apt-install\.sh/)

  it('有裝系統套件的步驟（e2e-linux 的 xvfb 等小套件）', () => {
    expect(steps.length).toBeGreaterThanOrEqual(1)
  })

  it.each(steps.map((step, i) => [i, step] as const))(
    '第 %s 個步驟：不直接呼叫 apt-get，用 apt-install.sh，單步 timeout-minutes 在 1～15，不裝 ffmpeg',
    (_i, step) => {
      expect(step).not.toMatch(/apt-get/)
      expect(step).toContain('tools/ci/apt-install.sh')
      expect(step).not.toMatch(/ffmpeg/)
      const minutes = Number(/timeout-minutes:\s*(\d+)/.exec(step)?.[1])
      expect(minutes).toBeGreaterThanOrEqual(1)
      expect(minutes).toBeLessThanOrEqual(15)
    },
  )
})

describe('tools/ci/apt-install.sh', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  /**
   * 假的 sudo／timeout／apt-get 放在 PATH 最前面：每次呼叫都記下來。
   * `failInstall` 是「第幾次呼叫 apt-get install 要失敗」、`timeoutCalls` 是「第幾次呼叫 timeout 要當成逾時（回 124）」。
   */
  function run(options: {
    failInstall?: number[]
    timeoutCalls?: number[]
    env?: NodeJS.ProcessEnv
  }) {
    const dir = mkdtempSync(join(tmpdir(), 'svs-apt-'))
    dirs.push(dir)
    const log = join(dir, 'calls.log')
    const counter = join(dir, 'install-count')
    const timeoutCounter = join(dir, 'timeout-count')
    const fake = (name: string, body: string): void => {
      writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`)
      chmodSync(join(dir, name), 0o755)
    }
    fake('sudo', 'exec "$@"')
    fake(
      'timeout',
      `n=$(( $(cat "${timeoutCounter}" 2>/dev/null || echo 0) + 1 )); echo $n > "${timeoutCounter}"
echo "timeout $1" >> "${log}"
case " ${(options.timeoutCalls ?? []).join(' ')} " in *" $n "*) exit 124;; esac
shift; exec "$@"`,
    )
    fake(
      'apt-get',
      `echo "apt-get $*" >> "${log}"
if [ "$1" = install ]; then
  n=$(( $(cat "${counter}" 2>/dev/null || echo 0) + 1 )); echo $n > "${counter}"
  case " ${(options.failInstall ?? []).join(' ')} " in *" $n "*) exit 100;; esac
fi
exit 0`,
    )
    const result = spawnSync('bash', [script, 'xvfb', 'libgbm1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, ...options.env },
    })
    const calls = readFileSync(log, 'utf8').trim().split('\n')
    return { ...result, calls, installs: calls.filter((c) => c.startsWith('apt-get install')) }
  }

  it('第一次就成功：只裝一次，帶 --no-install-recommends 與全部套件，每次呼叫都包在 300 秒的 timeout 裡', () => {
    const r = run({})
    expect(r.status).toBe(0)
    expect(r.installs).toEqual([
      'apt-get install -y --no-install-recommends -o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 xvfb libgbm1',
    ])
    // update 與 install 都帶網路逾時與重連，停住的連線會被切掉重連，不是乾等
    expect(r.calls.find((c) => c.startsWith('apt-get update'))).toContain(
      'Acquire::http::Timeout=20',
    )
    const timeouts = r.calls.filter((c) => c.startsWith('timeout'))
    expect(timeouts).toEqual(['timeout 300', 'timeout 300'])
  })

  it('第一次安裝失敗：重試一次就過（update 與 install 都再做一次）', () => {
    const r = run({ failInstall: [1] })
    expect(r.status).toBe(0)
    expect(r.installs).toHaveLength(2)
    expect(r.calls.filter((c) => c.startsWith('apt-get update'))).toHaveLength(2)
    expect(r.stdout).toContain('::warning::apt 第 1 次失敗或逾時')
  })

  it('第一次逾時（timeout 回 124）：重試一次就過', () => {
    const r = run({ timeoutCalls: [1] })
    expect(r.status).toBe(0)
    expect(r.installs).toHaveLength(1) // 第一次卡在 update 就逾時，沒有走到 install
    expect(r.stdout).toContain('::warning::apt 第 1 次失敗或逾時')
  })

  it('兩次都失敗：步驟失敗，不會無限重試', () => {
    const r = run({ failInstall: [1, 2, 3] })
    expect(r.status).toBe(1)
    expect(r.installs).toHaveLength(2)
    expect(r.stdout).toContain('::error::apt 安裝失敗：xvfb libgbm1')
  })

  it('次數與單次上限可以用環境變數調整', () => {
    const r = run({ failInstall: [1, 2, 3, 4], env: { APT_TRIES: '3', APT_ATTEMPT_SECONDS: '45' } })
    expect(r.status).toBe(1)
    expect(r.installs).toHaveLength(3)
    expect(r.calls.filter((c) => c === 'timeout 45')).toHaveLength(6)
  })
})
