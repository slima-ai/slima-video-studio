import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runSmoke, summarize, timings } from './run-smoke'

const dirs: string[] = []
const workDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'svs-smoke-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('runSmoke（示範模式）', () => {
  it('跑完快速開始、匯出成品，並回報每一鏡的時間', async () => {
    const lines: string[] = []
    const report = await runSmoke({
      workDir: workDir(),
      demoMode: true,
      pollIntervalMs: 5,
      say: (line) => lines.push(line),
    })
    expect(report.problem).toBeUndefined()
    expect(report.ok).toBe(true)
    expect(report.mode).toBe('demo')
    expect(report.shots).toHaveLength(3)
    expect(report.shots.every((shot) => shot.step === 'done')).toBe(true)
    expect(report.exportedPath).toBeTruthy()
    expect(readFileSync(report.exportedPath ?? '').byteLength).toBeGreaterThan(0)
    expect(lines.some((line) => line.includes('完成'))).toBe(true)
  }, 60_000)

  it('可以選擇多做一次「重新生成第 1 鏡 + 重新接片」', async () => {
    const report = await runSmoke({
      workDir: workDir(),
      demoMode: true,
      regenerate: true,
      pollIntervalMs: 5,
    })
    expect(report.ok).toBe(true)
    expect(report.regenerate?.videoSec).toBeGreaterThanOrEqual(0)
  }, 60_000)

  it('沒有 Key 又不是示範模式時，說清楚缺什麼而不是亂丟錯誤', async () => {
    const report = await runSmoke({ workDir: workDir(), demoMode: false, pollIntervalMs: 5 })
    expect(report.ok).toBe(false)
    expect(report.problem).toBeTruthy()
  }, 60_000)

  it('Key 填錯就在一開始停下來', async () => {
    const report = await runSmoke({
      workDir: workDir(),
      demoMode: false,
      keys: { openrouter: 'bad key' },
      pollIntervalMs: 5,
    })
    expect(report.ok).toBe(false)
    expect(report.problem).toContain('金鑰')
  }, 60_000)
})

describe('summarize / timings', () => {
  it('沒有進度快照時不會壞', () => {
    expect(timings([])).toEqual({ shots: [] })
  })

  it('失敗時摘要有原因', () => {
    const lines = summarize({
      ok: false,
      mode: 'real',
      story: 's',
      models: { llm: 'a' },
      estimatedUsd: 1,
      ledgerUsd: 0,
      shownUsd: 0,
      totalSec: 2,
      shots: [],
      keyChecks: [],
      problem: '等太久了',
    })
    expect(lines[0]).toContain('失敗')
    expect(lines.join('\n')).toContain('等太久了')
  })
})
