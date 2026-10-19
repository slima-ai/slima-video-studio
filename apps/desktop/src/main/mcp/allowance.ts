import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * AI 工具可以花的錢。額度由人在設定頁設定（預設 0），MCP 的工具改不了它。
 * 工具要花錢之前，先用預估金額「預留」：預留的金額只增不減（保守：實際花得比預估少也不退回），
 * 要重新開始算，由人在設定頁按「歸零」。示範模式不花真錢，不預留也不擋。
 */
export interface Allowance {
  status: () => { allowanceUsd: number; committedUsd: number; remainingUsd: number }
  reserve: (amountUsd: number) => ReserveResult
  /** 人按「歸零」。 */
  reset: () => void
}

export type ReserveResult =
  | { ok: true; remainingUsd: number }
  | { ok: false; requestedUsd: number; remainingUsd: number; allowanceUsd: number }

export interface AllowanceDeps {
  /** 存「已預留」金額的檔案。 */
  file: string
  allowanceUsd: () => number
  demoMode: () => boolean
}

const EPSILON = 1e-9

export function createAllowance(deps: AllowanceDeps): Allowance {
  let committed: number | undefined
  const load = (): number => {
    if (committed !== undefined) return committed
    try {
      if (existsSync(deps.file)) {
        const raw: unknown = JSON.parse(readFileSync(deps.file, 'utf8'))
        const value =
          typeof raw === 'object' && raw !== null && 'committedUsd' in raw
            ? Number(raw.committedUsd)
            : 0
        committed = Number.isFinite(value) && value >= 0 ? value : 0
        return committed
      }
    } catch {
      // 檔案壞掉就當作 0（額度是人設定的上限，不是帳本）
    }
    committed = 0
    return 0
  }
  const save = (value: number): void => {
    committed = value
    const tmp = `${deps.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ committedUsd: value }), 'utf8')
    renameSync(tmp, deps.file)
  }
  const status = () => {
    const allowanceUsd = deps.allowanceUsd()
    const committedUsd = load()
    return { allowanceUsd, committedUsd, remainingUsd: Math.max(allowanceUsd - committedUsd, 0) }
  }
  return {
    status,
    reserve: (amountUsd) => {
      const { allowanceUsd, remainingUsd } = status()
      if (deps.demoMode() || amountUsd <= EPSILON) return { ok: true, remainingUsd }
      if (amountUsd > remainingUsd + EPSILON) {
        return { ok: false, requestedUsd: amountUsd, remainingUsd, allowanceUsd }
      }
      save(load() + amountUsd)
      return { ok: true, remainingUsd: status().remainingUsd }
    },
    reset: () => {
      save(0)
    },
  }
}
