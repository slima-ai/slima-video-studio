import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/** 專案目前實際花了多少（帳本，不含示範模式的假結果）；`dir` 用來確認前後是同一個專案。 */
export interface SpendMark {
  dir: string
  spentUsd: number
}

/**
 * AI 工具可以花的錢。額度由人在設定頁設定（預設 0），MCP 的工具改不了它。
 * 工具要花錢之前，先用預估金額「預留」（預估再乘上保險係數）；生成做完、佇列空了以後，
 * 預留改成「實際花的」：實際比預留少的部分退回（`settle`）。實際比預留多也只算到預留為止
 * （沒辦法分辨多出來的是不是人自己在畫面上按的）。要重新開始算，由人在設定頁按「歸零」。
 * 示範模式不花真錢，不預留也不擋。
 */
export interface Allowance {
  status: () => { allowanceUsd: number; committedUsd: number; remainingUsd: number }
  reserve: (amountUsd: number) => ReserveResult
  /** 還有預留的金額等著改成實際花費。 */
  hasOpen: () => boolean
  /**
   * 佇列空了才呼叫：把還沒結算的預留改成實際花費，多的退回。
   * 專案換了、或預留當下讀不到專案就不退（算不出這一段花了多少）。回傳退回多少。
   */
  settle: () => number
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
  /** 目前專案實際花了多少；沒開專案是 undefined。 */
  spend: () => SpendMark | undefined
}

const EPSILON = 1e-9

/** 已預留、還沒結算的那一段：一起結算，所以只記總預留與最早的起點。 */
interface OpenReservation {
  reservedUsd: number
  /** 起點所在的專案與當時的專案花費；多個專案混在一起就是 undefined（不退）。 */
  from?: SpendMark
}

export function createAllowance(deps: AllowanceDeps): Allowance {
  let committed: number | undefined
  let open: OpenReservation | undefined
  const num = (value: unknown): number | undefined => {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  const parseOpen = (raw: unknown): OpenReservation | undefined => {
    if (typeof raw !== 'object' || raw === null) return undefined
    const o = raw as Record<string, unknown>
    const reservedUsd = num(o.reservedUsd)
    if (reservedUsd === undefined) return undefined
    const spentUsd = num(o.fromSpentUsd)
    const from =
      typeof o.fromDir === 'string' && spentUsd !== undefined
        ? { dir: o.fromDir, spentUsd }
        : undefined
    return { reservedUsd, ...(from === undefined ? {} : { from }) }
  }
  const load = (): number => {
    if (committed !== undefined) return committed
    try {
      if (existsSync(deps.file)) {
        const raw: unknown = JSON.parse(readFileSync(deps.file, 'utf8'))
        const record =
          typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
        committed = num(record.committedUsd) ?? 0
        open = parseOpen(record.open)
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
    const payload = {
      committedUsd: value,
      ...(open === undefined
        ? {}
        : {
            open: {
              reservedUsd: open.reservedUsd,
              ...(open.from === undefined
                ? {}
                : { fromDir: open.from.dir, fromSpentUsd: open.from.spentUsd }),
            },
          }),
    }
    writeFileSync(tmp, JSON.stringify(payload), 'utf8')
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
      const mark = deps.spend()
      const { allowanceUsd, remainingUsd } = status()
      if (deps.demoMode() || amountUsd <= EPSILON) return { ok: true, remainingUsd }
      if (amountUsd > remainingUsd + EPSILON) {
        return { ok: false, requestedUsd: amountUsd, remainingUsd, allowanceUsd }
      }
      // 已經有一段還沒結算：接在後面一起算，起點取最早的；不同專案或沒有起點就不退
      open =
        open === undefined
          ? { reservedUsd: amountUsd, ...(mark === undefined ? {} : { from: mark }) }
          : {
              reservedUsd: open.reservedUsd + amountUsd,
              ...(open.from !== undefined && mark?.dir === open.from.dir
                ? { from: open.from }
                : {}),
            }
      save(load() + amountUsd)
      return { ok: true, remainingUsd: status().remainingUsd }
    },
    hasOpen: () => {
      load()
      return open !== undefined
    },
    settle: () => {
      const current = load()
      const group = open
      if (group === undefined) return 0
      open = undefined
      const { from } = group
      const now = deps.spend()
      // 同一個專案才算得出這一段花了多少
      const actualUsd =
        from !== undefined && now?.dir === from.dir
          ? Math.max(now.spentUsd - from.spentUsd, 0)
          : undefined
      if (actualUsd === undefined) {
        save(current)
        return 0
      }
      const refundUsd = Math.max(group.reservedUsd - actualUsd, 0)
      save(Math.max(current - refundUsd, 0))
      return refundUsd
    },
    reset: () => {
      open = undefined
      save(0)
    },
  }
}
