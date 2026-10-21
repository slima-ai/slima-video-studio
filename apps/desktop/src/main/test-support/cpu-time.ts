/**
 * 測效能的共用小工具（只給測試用）：量「這個行程實際用掉的 CPU 時間」，不是牆鐘時間。
 * 牆鐘時間會被同時跑的別的行程拖慢（整套測試並行、機器忙），比值就亂跳；CPU 時間被搶走的不算。
 * 效能測試一律比「資料量放大 N 倍，時間不超過 M 倍」，不比絕對毫秒數。
 */

/** 這個行程到現在用掉的 CPU 時間（毫秒，user＋system）。 */
export const cpuNowMs = (): number => {
  const used = process.cpuUsage()
  return (used.user + used.system) / 1000
}

/** 一次量測至少要累積這麼多 CPU 毫秒：太短的話，作業系統記 CPU 時間的粒度（Linux 常是 1～10 毫秒）會把比值量歪。 */
const MIN_MEASURE_MS = 40

/**
 * 「資料量放大 N 倍，時間會放大幾倍」：回傳 `large` 對 `small` 的 CPU 時間比。
 * - 先把 `small` 連跑 `reps` 次湊到至少 40 毫秒（`reps` 兩邊一樣）；
 * - 小的、大的交替各量 `runs` 次，各取最小的（機器忙、垃圾回收只會讓某幾次變慢）。
 * 線性大約等於放大倍數（有固定成本時更小），平方大約是放大倍數的平方；門檻放在中間。
 */
export function scalingRatio(
  small: () => void,
  large: () => void,
  runs = 5,
): { ratio: number; smallMs: number; largeMs: number; reps: number } {
  const measure = (fn: () => void, reps: number): number => {
    const start = cpuNowMs()
    for (let i = 0; i < reps; i += 1) fn()
    return cpuNowMs() - start
  }
  large() // 暖機（第一次有冷啟動：JIT、快取）
  let reps = 1
  while (measure(small, reps) < MIN_MEASURE_MS && reps < 1_000_000) reps *= 2
  let smallMs = Infinity
  let largeMs = Infinity
  for (let run = 0; run < runs; run += 1) {
    smallMs = Math.min(smallMs, measure(small, reps))
    largeMs = Math.min(largeMs, measure(large, reps))
  }
  return { ratio: largeMs / Math.max(smallMs, 0.05), smallMs, largeMs, reps }
}

/** 固定的純 JS 工作（建一批物件、排序、轉 JSON 再轉回來）：當作「這台機器現在跑一份 JS 要多久」的尺。 */
function referenceWork(): void {
  const items = Array.from({ length: 1500 }, (_, i) => ({
    id: `n${String(i)}`,
    x: (i * 7) % 1000,
    y: (i * 13) % 1000,
    tags: ['a', 'b'],
  }))
  items.sort((a, b) => a.x - b.x || a.y - b.y)
  JSON.parse(JSON.stringify(items))
}

/**
 * 「`fn` 跑一次的 CPU 時間」除以「固定參考工作跑一次的 CPU 時間」：機器慢兩倍，兩邊一起慢兩倍，比值不變；
 * 但 `fn` 自己變慢一倍（每個東西多做一份工作）比值就變兩倍。給「常數倍的退步」用——
 * 倍數（資料量放大幾倍）看不出來的那一種。門檻要照這台機器量到的比值再放大，不是毫秒數。
 */
export function relativeCost(
  fn: () => void,
  runs = 5,
): { relative: number; fnMs: number; refMs: number } {
  const measure = (work: () => void, reps: number): number => {
    const start = cpuNowMs()
    for (let i = 0; i < reps; i += 1) work()
    return (cpuNowMs() - start) / reps
  }
  const repsFor = (work: () => void): number => {
    let reps = 1
    while (measure(work, reps) * reps < MIN_MEASURE_MS && reps < 1_000_000) reps *= 2
    return reps
  }
  fn() // 暖機
  referenceWork()
  const fnReps = repsFor(fn)
  const refReps = repsFor(referenceWork)
  let fnMs = Infinity
  let refMs = Infinity
  for (let run = 0; run < runs; run += 1) {
    fnMs = Math.min(fnMs, measure(fn, fnReps))
    refMs = Math.min(refMs, measure(referenceWork, refReps))
  }
  return { relative: fnMs / Math.max(refMs, 0.001), fnMs, refMs }
}
