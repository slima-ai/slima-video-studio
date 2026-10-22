import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const root = join(__dirname, '../..')
const script = join(root, 'tools/ci/apt-install.sh')

// 2026-10-22 一天內兩次，apt 下載太慢把 unit 拖到 20 分鐘上限被取消（測試根本沒開始）。
// CI 裝系統套件一律走 tools/ci/apt-install.sh：不裝建議套件、每次嘗試有時間上限、失敗重試一次。
describe('ci.yml：系統套件只走 apt-install.sh，而且那一步有逾時', () => {
  const steps = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
    .split(/\n(?=\s+- )/)
    .filter((step) => /apt-get|apt-install\.sh/.test(step))

  it('有裝系統套件的步驟（unit、e2e-linux 各一個）', () => {
    expect(steps.length).toBeGreaterThanOrEqual(2)
  })

  it.each(steps.map((step, i) => [i, step] as const))(
    '第 %s 個步驟：不直接呼叫 apt-get，用 apt-install.sh，單步 timeout-minutes 在 1～15',
    (_i, step) => {
      expect(step).not.toMatch(/apt-get/)
      expect(step).toContain('tools/ci/apt-install.sh')
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
   * `failures` 是「第幾次呼叫 apt-get install 要失敗」、`timeouts` 是「第幾次呼叫 timeout 要當成逾時（回 124）」。
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
    const archives = join(dir, 'archives')
    mkdirSync(archives)
    const result = spawnSync('bash', [script, 'xvfb', 'ffmpeg'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        APT_ARCHIVES_DIR: archives,
        ...options.env,
      },
    })
    const calls = readFileSync(log, 'utf8').trim().split('\n')
    return { ...result, calls, installs: calls.filter((c) => c.startsWith('apt-get install')) }
  }

  it('第一次就成功：只裝一次，帶 --no-install-recommends 與全部套件，每次呼叫都包在 300 秒的 timeout 裡', () => {
    const r = run({})
    expect(r.status).toBe(0)
    expect(r.installs).toEqual([
      'apt-get install -y --no-install-recommends -o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 xvfb ffmpeg',
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
    expect(r.stdout).toContain('::error::apt 安裝失敗：xvfb ffmpeg')
  })

  it('次數與單次上限可以用環境變數調整', () => {
    const r = run({ failInstall: [1, 2, 3, 4], env: { APT_TRIES: '3', APT_ATTEMPT_SECONDS: '45' } })
    expect(r.status).toBe(1)
    expect(r.installs).toHaveLength(3)
    expect(r.calls.filter((c) => c === 'timeout 45')).toHaveLength(6)
  })

  it('有 .deb 快取：先放回 apt 的快取資料夾再安裝；裝成功後把新下載的 .deb 存回快取', () => {
    const cache = mkdtempSync(join(tmpdir(), 'svs-apt-cache-'))
    const archives = mkdtempSync(join(tmpdir(), 'svs-apt-archives-'))
    dirs.push(cache, archives)
    writeFileSync(join(cache, 'old_1.0_amd64.deb'), 'old')
    // 假的 apt-get install 不會真的下載，所以先在 archives 放一個「剛下載好」的檔
    writeFileSync(join(archives, 'fresh_2.0_amd64.deb'), 'fresh')
    const r = run({ env: { APT_DEB_CACHE: cache, APT_ARCHIVES_DIR: archives } })
    expect(r.status).toBe(0)
    expect(existsSync(join(archives, 'old_1.0_amd64.deb'))).toBe(true) // 快取放回 archives
    expect(readFileSync(join(cache, 'fresh_2.0_amd64.deb'), 'utf8')).toBe('fresh') // 新的存回快取
    expect(r.stdout).toContain('從快取放回 1 個 .deb')
  })

  it('沒有設 APT_DEB_CACHE：不碰任何快取', () => {
    const r = run({})
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain('從快取放回')
  })

  it('安裝失敗時不會把半套的 .deb 存進快取', () => {
    const cache = mkdtempSync(join(tmpdir(), 'svs-apt-cache-'))
    const archives = mkdtempSync(join(tmpdir(), 'svs-apt-archives-'))
    dirs.push(cache, archives)
    writeFileSync(join(archives, 'partial_1.0_amd64.deb'), 'x')
    const r = run({
      failInstall: [1, 2],
      env: { APT_DEB_CACHE: cache, APT_ARCHIVES_DIR: archives },
    })
    expect(r.status).toBe(1)
    expect(existsSync(join(cache, 'partial_1.0_amd64.deb'))).toBe(false)
  })
})
