import { probe, type MediaTools } from '@svs/media'
import type {
  IpcEventName,
  QuickStartCheck,
  QuickStartProgress,
  QuickStartRequest,
  QuickStyleId,
  ShotStep,
} from '@svs/schema'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { createKeyTester } from '../keys/key-tester'
import { MemoryVault } from '../keys/key-vault'
import { ProjectManager } from '../project-manager'
import { createMemorySettingsStore } from '../settings/settings-store'
import { createStudioApp } from '../studio-app'

export interface SmokeOptions {
  /** 各供應商的 API Key（fal、openrouter）。示範模式不需要。 */
  keys?: Record<string, string>
  /** true = 用假供應商（不連網、不花錢），用來確認腳本本身沒壞。 */
  demoMode?: boolean
  story?: string
  style?: QuickStyleId
  shotCount?: number
  durationSec?: number
  aspectRatio?: '16:9' | '9:16'
  /** 單次執行的花費上限（美元），預設 5。 */
  limitUsd?: number
  /** 快速開始之後，再重新生成第 1 鏡的影片、重新接片一次（會多花錢）。 */
  regenerate?: boolean
  /** 專案與匯出檔放這裡。 */
  workDir: string
  /** FFmpeg 路徑；沒給就找系統的。 */
  tools?: () => MediaTools | undefined
  timeoutMs?: number
  /** 一路回報進度（給人看的白話）。 */
  say?: (line: string) => void
  /** 測試用：讓假供應商輪詢更快。 */
  pollIntervalMs?: number
}

export interface ShotTiming {
  index: number
  imageSec?: number
  videoSec?: number
  step: ShotStep
}

export interface SmokeReport {
  ok: boolean
  mode: 'real' | 'demo'
  story: string
  models: QuickStartCheck['models']
  estimatedUsd: number
  /** 帳本上的實際花費（供應商有回報才有）。 */
  ledgerUsd: number
  /** 畫面顯示的花費（沒回報的步驟用估算補上）。 */
  shownUsd: number
  totalSec: number
  breakdownSec?: number
  joinSec?: number
  shots: ShotTiming[]
  finalVideo?: { durationSec: number; width?: number; height?: number; path: string }
  exportedPath?: string
  regenerate?: { videoSec: number; extraUsd: number; rejoinedDurationSec: number }
  /** 沒成功時的原因（白話）。 */
  problem?: string
  keyChecks: { provider: string; valid: boolean; balanceUsd?: number }[]
}

const DEFAULT_STORY = '一隻流浪貓在下雨的夜晚，找到了一個溫暖的家。'

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * 真實 API 冒煙測試：用跟 App 一模一樣的服務組法，跑一次「快速開始」（預設 3 鏡、每鏡 3 秒），
 * 記錄每一步花了多久、花了多少錢，並把成品匯出。給 `pnpm smoke:real` 用，也可以用示範模式自我檢查。
 */
export async function runSmoke(options: SmokeOptions): Promise<SmokeReport> {
  const say = options.say ?? (() => undefined)
  const demo = options.demoMode ?? false
  const story = options.story ?? DEFAULT_STORY
  const request: QuickStartRequest = {
    story,
    style: options.style ?? 'anime',
    shotCount: options.shotCount ?? 3,
    durationSec: options.durationSec ?? 3,
    aspectRatio: options.aspectRatio ?? '16:9',
    variation: 0,
  }
  const startedAt = Date.now()
  const elapsed = (): number => (Date.now() - startedAt) / 1000

  mkdirSync(options.workDir, { recursive: true })
  const projects = new ProjectManager('smoke')
  const keys = new MemoryVault()
  const settings = createMemorySettingsStore({
    demoMode: demo,
    onboardingDone: true,
    budget: { perRunLimitUsd: options.limitUsd ?? 5 },
  })

  const snapshots: { at: number; progress: QuickStartProgress }[] = []
  const broadcast = (name: IpcEventName, payload: unknown): void => {
    if (name === 'quickstart.progress') {
      snapshots.push({ at: elapsed(), progress: payload as QuickStartProgress })
    }
  }
  const noise = { info: () => undefined, warn: () => undefined, error: () => undefined }
  const studio = createStudioApp({
    projects,
    keys,
    settings,
    broadcast,
    log: noise,
    projectsDir: join(options.workDir, 'projects'),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
  })
  const { quickstart, shots } = studio

  const report: SmokeReport = {
    ok: false,
    mode: demo ? 'demo' : 'real',
    story,
    models: {},
    estimatedUsd: 0,
    ledgerUsd: 0,
    shownUsd: 0,
    totalSec: 0,
    shots: [],
    keyChecks: [],
  }
  const finish = (problem?: string): SmokeReport => {
    report.totalSec = elapsed()
    if (problem) report.problem = problem
    report.ok = problem === undefined
    studio.runtime.dispose()
    projects.close()
    return report
  }

  try {
    for (const [provider, key] of Object.entries(options.keys ?? {})) keys.set(provider, key)
    // 1. Key 先測一次：填錯的 Key 在這裡就說清楚，不要等到生成到一半才失敗
    const tester = createKeyTester({ keys })
    for (const provider of keys.providers()) {
      const result = await tester(provider, AbortSignal.timeout(30_000))
      report.keyChecks.push({
        provider,
        valid: result.valid,
        ...(result.balanceUsd === undefined ? {} : { balanceUsd: result.balanceUsd }),
      })
      say(`測試 ${provider} 的 Key：${result.valid ? '可以用' : '不能用'}`)
      if (!result.valid) return finish(`${provider} 的 API Key 不能用，請確認有沒有貼錯。`)
    }

    // 2. 跟畫面上一樣的「執行前檢查」
    const check = quickstart.check(request)
    report.models = check.models
    report.estimatedUsd = check.estimatedUsd
    say(
      `預估花費約 US$${check.estimatedUsd.toFixed(2)}；模型：${Object.values(check.models).join('、')}`,
    )
    if (!check.ok) return finish(check.issues.map((i) => i.message).join('；'))

    // 3. 開始生成並等它結束
    await quickstart.run(request)
    say('開始生成…')
    const deadline = Date.now() + (options.timeoutMs ?? 20 * 60_000)
    let last: QuickStartProgress | undefined
    while (Date.now() < deadline) {
      last = quickstart.state() ?? undefined
      if (last && last.status !== 'running') break
      await sleep(options.pollIntervalMs ?? 500)
    }
    if (!last || last.status === 'running') {
      quickstart.cancel()
      return finish('等太久了，已經取消。')
    }
    report.shownUsd = last.costUsd
    Object.assign(report, timings(snapshots))
    if (last.status !== 'succeeded') {
      return finish(last.error?.userMessage ?? `這次沒有成功（${last.status}）。`)
    }
    const handle = projects.current()
    if (!handle) return finish('專案沒有開啟。')
    report.ledgerUsd = handle.repos.costs.totalUsd(handle.projectId)
    say(
      `完成：${report.totalSec.toFixed(0)} 秒，實際花費 US$${report.ledgerUsd.toFixed(2)}（畫面顯示 US$${last.costUsd.toFixed(2)}）`,
    )

    const tool = options.tools?.()
    const final = last.finalVideoHash ? handle.assets.find(last.finalVideoHash) : undefined
    if (final && tool) {
      const info = await probe(tool, final.path)
      report.finalVideo = {
        durationSec: info.durationSec,
        ...(info.width ? { width: info.width } : {}),
        ...(info.height ? { height: info.height } : {}),
        path: final.path,
      }
    }
    report.exportedPath = quickstart.export().path
    say(`已匯出：${report.exportedPath}`)

    // 4.（選用）重新生成第 1 鏡的影片，再重新接片
    if (options.regenerate) {
      const first = shots.list().shots[0]
      if (!first) return finish('找不到第 1 鏡。')
      const before = handle.repos.costs.totalUsd(handle.projectId)
      const regenStart = elapsed()
      await shots.regenerate(first.id, 'video')
      while (shots.list().shots[0]?.activity !== undefined) {
        if (Date.now() > deadline) return finish('重新生成等太久了。')
        await sleep(options.pollIntervalMs ?? 500)
      }
      const after = shots.list().shots[0]
      if (after?.error) return finish(`重新生成失敗：${after.error}`)
      const videoSec = elapsed() - regenStart
      const joined = await shots.rejoin()
      const meta = handle.assets.find(joined.videoHash)
      const durationSec = meta && tool ? (await probe(tool, meta.path)).durationSec : 0
      report.regenerate = {
        videoSec,
        extraUsd: handle.repos.costs.totalUsd(handle.projectId) - before,
        rejoinedDurationSec: durationSec,
      }
      say(
        `重新生成第 1 鏡的影片：${videoSec.toFixed(0)} 秒，多花 US$${report.regenerate.extraUsd.toFixed(2)}`,
      )
    }
    return finish()
  } catch (error) {
    const message =
      error instanceof Error && 'userMessage' in error
        ? String((error as { userMessage: unknown }).userMessage)
        : String(error)
    return finish(message)
  }
}

/** 從一路收到的進度快照推算每一步花了多久。 */
export function timings(
  snapshots: readonly { at: number; progress: QuickStartProgress }[],
): Pick<SmokeReport, 'breakdownSec' | 'joinSec' | 'shots'> {
  const first = snapshots[0]?.at ?? 0
  const result: Pick<SmokeReport, 'breakdownSec' | 'joinSec' | 'shots'> = { shots: [] }
  const breakdownDone = snapshots.find((s) => s.progress.shots.length > 0)
  if (breakdownDone) result.breakdownSec = breakdownDone.at - first
  const joinStart = snapshots.find((s) => s.progress.phase === 'join')
  const end = snapshots.at(-1)
  if (joinStart && end) result.joinSec = end.at - joinStart.at

  const count = Math.max(0, ...snapshots.map((s) => s.progress.shots.length))
  for (let index = 0; index < count; index++) {
    const when = (step: ShotStep): number | undefined =>
      snapshots.find((s) => s.progress.shots[index]?.step === step)?.at
    const image = when('image')
    const video = when('video')
    const done = when('done')
    const final = snapshots.at(-1)?.progress.shots[index]?.step ?? 'waiting'
    result.shots.push({
      index,
      step: final,
      ...(image !== undefined && video !== undefined ? { imageSec: video - image } : {}),
      ...(video !== undefined && done !== undefined ? { videoSec: done - video } : {}),
    })
  }
  return result
}

/** 給人看的結果摘要（一行一句）。 */
export function summarize(report: SmokeReport): string[] {
  const lines = [
    `${report.ok ? '✅ 成功' : '❌ 失敗'}（${report.mode === 'real' ? '真實 API' : '示範模式'}）`,
  ]
  if (report.problem) lines.push(`原因：${report.problem}`)
  const models = Object.entries(report.models)
    .map(([kind, name]) => `${kind}=${name}`)
    .join('、')
  if (models) lines.push(`模型：${models}`)
  lines.push(
    `總時間 ${report.totalSec.toFixed(0)} 秒；預估 US$${report.estimatedUsd.toFixed(2)}，帳本 US$${report.ledgerUsd.toFixed(2)}，畫面顯示 US$${report.shownUsd.toFixed(2)}`,
  )
  if (report.breakdownSec !== undefined) lines.push(`拆鏡：${report.breakdownSec.toFixed(1)} 秒`)
  for (const shot of report.shots) {
    const parts = [
      shot.imageSec === undefined ? undefined : `圖片 ${shot.imageSec.toFixed(1)} 秒`,
      shot.videoSec === undefined ? undefined : `影片 ${shot.videoSec.toFixed(1)} 秒`,
    ].filter((part) => part !== undefined)
    lines.push(`第 ${shot.index + 1} 鏡：${parts.join('、') || shot.step}`)
  }
  if (report.joinSec !== undefined) lines.push(`接片：${report.joinSec.toFixed(1)} 秒`)
  if (report.finalVideo) {
    const size = report.finalVideo.width
      ? `，${report.finalVideo.width}x${report.finalVideo.height}`
      : ''
    lines.push(`成品：${report.finalVideo.durationSec.toFixed(1)} 秒${size}`)
  }
  if (report.exportedPath) lines.push(`已匯出：${report.exportedPath}`)
  if (report.regenerate) {
    lines.push(
      `重新生成第 1 鏡：${report.regenerate.videoSec.toFixed(0)} 秒，多花 US$${report.regenerate.extraUsd.toFixed(2)}，重新接片後 ${report.regenerate.rejoinedDurationSec.toFixed(1)} 秒`,
    )
  }
  return lines
}
