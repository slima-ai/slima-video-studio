import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'

/** 目標：平移縮放平均 50 fps（uiux-spec §12.13）。 */
const TARGET_FPS = 50
/** 自動平移量幾秒。 */
const PAN_MS = 4000

export interface PanResult {
  fps: number
  /** 最慢的一格畫面花了幾毫秒。 */
  worstMs: number
}

/** 一串畫面時間點 → 平均 fps 與最慢的一格。 */
export function frameStats(times: readonly number[]): PanResult {
  const gaps = times.slice(1).map((t, i) => t - (times[i] ?? t))
  if (gaps.length === 0) return { fps: 0, worstMs: 0 }
  const total = gaps.reduce((a, b) => a + b, 0)
  return {
    fps: Math.round((1000 / (total / gaps.length)) * 10) / 10,
    worstMs: Math.round(Math.max(...gaps)),
  }
}

/**
 * 效能自測（「？」選單裡）：看現在每秒幾格、畫布上有幾格與幾條線、讀一次畫布要多久；
 * 按「自動平移」量一段平移的平均 fps；按「產生 250 鏡示範專案」開一個大專案來測（原本的專案留著）。
 */
export function PerfOverlay({
  counts,
  pan,
  onSeeded,
  onClose,
}: {
  counts: { nodes: number; edges: number }
  /** 自動平移一段時間，回傳這段時間每一格畫面的時間點。 */
  pan: (ms: number) => Promise<number[]>
  /** 示範專案建好了：畫布重新讀、全部顯示。 */
  onSeeded: () => void
  onClose: () => void
}) {
  // 平常的 fps：最近 1 秒畫了幾格
  const [fps, setFps] = useState(0)
  useEffect(() => {
    let frame = 0
    const times: number[] = []
    const tick = (now: number): void => {
      times.push(now)
      while (times.length > 0 && now - (times[0] ?? now) > 1000) times.shift()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const timer = window.setInterval(() => {
      setFps(times.length)
    }, 500)
    return () => {
      cancelAnimationFrame(frame)
      window.clearInterval(timer)
    }
  }, [])

  const [loadMs, setLoadMs] = useState<number>()
  const [panResult, setPanResult] = useState<PanResult>()
  const [busy, setBusy] = useState<'pan' | 'seed' | 'load'>()
  const [message, setMessage] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )

  const measureLoad = (): void => {
    setBusy('load')
    const started = performance.now()
    call('canvas.get', {})
      .then(() => {
        if (alive.current) setLoadMs(Math.round(performance.now() - started))
      })
      .catch((e: unknown) => {
        if (alive.current) setMessage(errorText(e))
      })
      .finally(() => {
        if (alive.current) setBusy(undefined)
      })
  }

  const runPan = (): void => {
    setBusy('pan')
    setPanResult(undefined)
    void pan(PAN_MS)
      .then((times) => {
        if (alive.current) setPanResult(frameStats(times))
      })
      .finally(() => {
        if (alive.current) setBusy(undefined)
      })
  }

  const seed = (): void => {
    setConfirming(false)
    setBusy('seed')
    setMessage('正在產生示範專案…')
    call('dev.seedDemo', { shots: 250 })
      .then((result) => {
        if (!alive.current) return
        setMessage(
          `已開「${result.project.name}」：${String(result.shots)} 個鏡頭（花 ${(result.ms / 1000).toFixed(1)} 秒）`,
        )
        onSeeded()
      })
      .catch((e: unknown) => {
        if (alive.current) setMessage(errorText(e))
      })
      .finally(() => {
        if (alive.current) setBusy(undefined)
      })
  }

  return (
    <section
      aria-label="效能自測"
      data-testid="perf-overlay"
      className="absolute left-[300px] top-[68px] z-30 w-72 space-y-2 rounded-xl border border-border bg-surface-raised p-3 text-sm shadow-panel"
    >
      <header className="flex items-center justify-between">
        <h2 className="font-semibold">效能自測</h2>
        <button
          type="button"
          aria-label="關閉"
          className="flex size-6 items-center justify-center rounded text-fg-muted hover:bg-surface-overlay"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </header>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        <dt className="text-fg-muted">現在每秒</dt>
        <dd data-testid="perf-fps">{fps} 格</dd>
        <dt className="text-fg-muted">畫布上</dt>
        <dd data-testid="perf-counts">
          {counts.nodes} 格、{counts.edges} 條線
        </dd>
        <dt className="text-fg-muted">讀一次畫布</dt>
        <dd data-testid="perf-load">{loadMs === undefined ? '—' : `${String(loadMs)} 毫秒`}</dd>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" data-testid="perf-pan" disabled={busy !== undefined} onClick={runPan}>
          {busy === 'pan' ? '平移中…' : '自動平移 4 秒'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="perf-measure-load"
          disabled={busy !== undefined}
          onClick={measureLoad}
        >
          量讀取時間
        </Button>
      </div>
      {panResult ? (
        <p data-testid="perf-pan-result" className="text-xs">
          平移平均 <b>{panResult.fps}</b> fps，最慢一格 {panResult.worstMs} 毫秒：
          {panResult.fps >= TARGET_FPS ? (
            <span className="text-success">達到 {TARGET_FPS} fps 的目標</span>
          ) : (
            <span className="text-warning">
              還沒到 {TARGET_FPS} fps（沒有獨立顯示卡的電腦數字會比較低）
            </span>
          )}
        </p>
      ) : null}
      {confirming ? (
        <div
          className="space-y-1.5 rounded-lg bg-surface-overlay p-2 text-xs"
          data-testid="perf-seed-confirm"
        >
          <p>
            會開一個新的專案，放 250
            個鏡頭（每鏡都有圖和影片，示範素材、不花錢）。現在的專案會留著，可以從「專案」頁切回來。
          </p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" data-testid="perf-seed-ok" onClick={seed}>
              產生
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirming(false)
              }}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          data-testid="perf-seed"
          disabled={busy !== undefined}
          onClick={() => {
            setConfirming(true)
          }}
        >
          產生 250 鏡示範專案
        </Button>
      )}
      {message ? (
        <p className="text-xs text-fg-muted" data-testid="perf-message">
          {message}
        </p>
      ) : null}
    </section>
  )
}
