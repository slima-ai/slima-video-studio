import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createAppLedger } from './app-ledger'

const dirs: string[] = []
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'svs-ledger-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const entry = (amountUsd: number, provider = 'openrouter') => ({
  provider,
  modelId: 'some/llm',
  amountUsd,
  reason: 'trailer.plan failed in a discarded project',
})

describe('App 層的花費帳本（不跟專案走，刪專案不會受影響）', () => {
  it('記一筆、加總；可以排除示範用的 mock（跟「已花」同一個規則）', () => {
    const ledger = createAppLedger({})
    expect(ledger.totalUsd()).toBe(0)
    ledger.record(entry(0.37))
    ledger.record(entry(0.37))
    ledger.record(entry(5, 'mock'))
    expect(ledger.list()).toHaveLength(3)
    expect(ledger.totalUsd()).toBeCloseTo(5.74, 9)
    expect(ledger.totalUsd({ excludeProviders: ['mock'] })).toBeCloseTo(0.74, 9)
  })

  it('待移的錢：標成已移之後不再算進加總、也不會再被領；已移的紀錄留著當紀錄（重開還在）', () => {
    const file = join(tempDir(), 'spend-ledger.json')
    const ledger = createAppLedger({ file, now: () => new Date('2026-11-12T03:00:00.000Z') })
    const a = ledger.record(entry(0.37))
    const b = ledger.record(entry(0.37))
    expect(ledger.pending().map((e) => e.id)).toEqual([a.id, b.id])
    ledger.markMoved([a.id, b.id], 'project-1')
    expect(ledger.totalUsd()).toBe(0)
    expect(ledger.pending()).toEqual([])
    const c = ledger.record(entry(0.1))
    expect(ledger.totalUsd()).toBeCloseTo(0.1, 9)
    expect(ledger.pending().map((e) => e.id)).toEqual([c.id])
    // 重開：已移的標記還在，紀錄也還在（list 看得到全部）
    const again = createAppLedger({ file })
    expect(again.totalUsd()).toBeCloseTo(0.1, 9)
    expect(again.list()).toHaveLength(3)
    expect(again.list()[0]).toMatchObject({
      movedToProjectId: 'project-1',
      movedAt: '2026-11-12T03:00:00.000Z',
    })
  })

  it('寫進檔案：重開（再建一個）還在，金額與供應商都一樣', () => {
    const file = join(tempDir(), 'spend-ledger.json')
    const first = createAppLedger({ file, now: () => new Date('2026-11-12T03:00:00.000Z') })
    first.record({ ...entry(0.37), jobId: 'job-1' })
    const again = createAppLedger({ file })
    expect(again.totalUsd()).toBeCloseTo(0.37, 9)
    expect(again.list()[0]).toMatchObject({
      provider: 'openrouter',
      modelId: 'some/llm',
      amountUsd: 0.37,
      jobId: 'job-1',
      createdAt: '2026-11-12T03:00:00.000Z',
    })
  })

  it('檔案壞了：改名備份、用空帳繼續（不讓 App 打不開），不會把壞檔蓋掉', () => {
    const dir = tempDir()
    const file = join(dir, 'spend-ledger.json')
    writeFileSync(file, '{壞掉的')
    const warnings: string[] = []
    const ledger = createAppLedger({ file, warn: (message) => warnings.push(message) })
    expect(ledger.totalUsd()).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(readdirSync(dir).some((name) => name.startsWith('spend-ledger.json.broken-'))).toBe(true)
    ledger.record(entry(0.1))
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ entries: [{ amountUsd: 0.1 }] })
  })
})
