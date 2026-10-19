import { probe, runTool, type MediaTools } from '@svs/media'
import { AppError } from '@svs/schema'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectManager } from '../project-manager'

/** 給 AI 看的圖：縮小的 JPEG（base64）。 */
export interface ViewImage {
  data: string
  mimeType: 'image/jpeg'
  width: number
}

export interface AssetViewer {
  /** 把專案裡的一張圖縮成給 AI 看的大小。 */
  image: (hash: string) => Promise<ViewImage>
  /** 從影片均勻抽幾張畫面（檢查有沒有長出多餘的嘴、手腳）。 */
  videoStills: (hash: string, count: number) => Promise<{ atSec: number; image: ViewImage }[]>
}

/** 給 AI 看的圖最寬幾像素：夠看清楚構圖與臉，又不會讓一張圖佔掉太多對話長度。 */
export const VIEW_MAX_WIDTH = 1024
export const MAX_STILLS = 6

const unavailable = (what: string): AppError =>
  new AppError({
    code: 'invalid_request',
    userMessage: `${what}（可能已經被刪掉，或這個專案沒有開著）。`,
  })

export interface AssetViewerDeps {
  projects: Pick<ProjectManager, 'current'>
  tools: () => MediaTools | undefined
}

/** 用內建的 FFmpeg 縮圖與抽格。素材只用內容雜湊找（AI 摸不到路徑），暫存檔用完就刪。 */
export function createAssetViewer(deps: AssetViewerDeps): AssetViewer {
  const need = (hash: string): { path: string; tools: MediaTools } => {
    const handle = deps.projects.current()
    const tools = deps.tools()
    if (!handle || handle.closed) throw unavailable('找不到這個素材')
    const found = handle.assets.find(hash)
    if (!found) throw unavailable('找不到這個素材')
    if (!tools) {
      throw new AppError({
        code: 'internal_error',
        userMessage: '找不到影片處理工具（FFmpeg），沒辦法縮圖。',
      })
    }
    return { path: found.path, tools }
  }

  const render = async (tools: MediaTools, input: string, atSec?: number): Promise<ViewImage> => {
    const dir = mkdtempSync(join(tmpdir(), 'svs-view-'))
    const out = join(dir, 'view.jpg')
    try {
      await runTool(tools.ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        ...(atSec === undefined ? [] : ['-ss', atSec.toFixed(3)]),
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${String(VIEW_MAX_WIDTH)},iw)':-2`,
        '-q:v',
        '4',
        out,
      ])
      const bytes = readFileSync(out)
      return { data: bytes.toString('base64'), mimeType: 'image/jpeg', width: VIEW_MAX_WIDTH }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  return {
    image: async (hash) => {
      const { path, tools } = need(hash)
      return render(tools, path)
    },
    videoStills: async (hash, count) => {
      const { path, tools } = need(hash)
      const n = Math.min(Math.max(Math.floor(count), 1), MAX_STILLS)
      const { durationSec } = await probe(tools, path)
      const stills: { atSec: number; image: ViewImage }[] = []
      for (let i = 0; i < n; i++) {
        // 取每一段的正中間，避開第一格與最後一格（常常是黑的或轉場）
        const atSec = ((i + 0.5) / n) * Math.max(durationSec, 0.1)
        stills.push({ atSec: Number(atSec.toFixed(2)), image: await render(tools, path, atSec) })
      }
      return stills
    },
  }
}
